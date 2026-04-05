"""
TALON Phase 29 — AgentScope Swarm Orchestrator
backend/app/swarm/orchestrator.py

Three-agent pipeline:
  Agent 1 — The Filter (Flash):   Fast/cheap Gemini screening
  Agent 2 — The Scout (Brave):    Brave Search hiring context enrichment
  Agent 3 — The Architect (Pro):  Synthesizes final report

PinchTab context-window reduction: compresses long job descriptions
to ~1/10th token cost before sending to the Pro model.

Output is a JSON object compatible with talon-mailer.mjs.
"""

from __future__ import annotations

import json
import logging
import os
import re
import textwrap
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/swarm", tags=["swarm"])

# ── Environment ────────────────────────────────────────────────────────────────
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

# ── Request / Response schemas ─────────────────────────────────────────────────
class SwarmRequest(BaseModel):
    job: dict          # {title, company, location, description, url, score, source}
    candidate: dict    # candidate profile (profile.json shape)
    to_email: str | None = None   # if set, mailer payload is returned


class SwarmReport(BaseModel):
    """
    Output shape — compatible with talon-mailer.mjs sendTalonResearchEmail(toEmail, jobData, analysis).
    jobData  = { title, company, location, url, score, source }
    analysis = HTML string (rendered by talon-mailer into the email body)
    """
    job_data: dict          # mirror of SwarmRequest.job — passed as jobData to mailer
    analysis_html: str      # full HTML report string for email body
    match_score:  int       # 0-100
    match_label:  str       # "Strong" | "Moderate" | "Weak" | "Filtered Out"
    recommendation: str     # "Apply" | "Tailor" | "Skip"
    summary:      str       # one-sentence summary
    strengths:    list[str]
    gaps:         list[str]
    hiring_context: str     # Scout result
    agent_trace:  list[str] # log of which agents ran


# ── PinchTab Context Compression ───────────────────────────────────────────────
# Reduces token count to ~1/10th by extracting only signal-dense sentences.
# Named after the PinchTab API pattern for context-window reduction.

_SIGNAL_KEYWORDS = [
    "require", "must", "experience", "skill", "qualification", "responsibilit",
    "degree", "year", "agile", "scrum", "python", "sql", "manager", "analyst",
    "sponsor", "citizen", "clearance", "visa", "opt", "cpt", "intern", "remote",
    "hybrid", "salary", "benefit", "401k", "location", "prefer", "ideal",
    "bachelor", "master", "certification", "proficien", "familiar",
]

def pinchtab_compress(text: str, max_chars: int = 800) -> str:
    """
    PinchTab context-window reducer:
    - Splits description into sentences
    - Scores each sentence by signal-keyword density
    - Returns top sentences up to max_chars (~1/10th of a 3000-char desc → 300 tokens)
    """
    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+|\n+', text.strip())
    sentences = [s.strip() for s in sentences if len(s.strip()) > 15]

    def score(s: str) -> int:
        lower = s.lower()
        return sum(1 for kw in _SIGNAL_KEYWORDS if kw in lower)

    ranked = sorted(sentences, key=score, reverse=True)

    result, total = [], 0
    for s in ranked:
        if total + len(s) > max_chars:
            break
        result.append(s)
        total += len(s) + 1

    # Re-order by original position for readability
    original_order = [s for s in sentences if s in result]
    compressed = " ".join(original_order)
    logger.info("[PinchTab] %d chars → %d chars (%.0f%% reduction)",
                len(text), len(compressed), (1 - len(compressed) / max(len(text), 1)) * 100)
    return compressed


# ── Gemini helpers ─────────────────────────────────────────────────────────────
async def _call_proxy(model: str, prompt: str, max_tokens: int = 1200) -> str:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.2
    }
    url = "http://127.0.0.1:4000/v1/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()

    data = resp.json()
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not text:
        raise ValueError(f"Empty proxy response: {data}")
    return text.strip()


async def _brave_search(query: str, count: int = 3) -> list[dict]:
    api_key = os.environ.get("BRAVE_API_KEY", "")
    if not api_key:
        logger.warning("[Scout] BRAVE_API_KEY not set — skipping web search")
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                BRAVE_SEARCH_URL,
                params={"q": query, "count": count},
                headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            )
            resp.raise_for_status()
        results = resp.json().get("web", {}).get("results", [])
        return [{"title": r.get("title", ""), "snippet": r.get("description", ""), "url": r.get("url", "")}
                for r in results[:count]]
    except Exception as exc:
        logger.error("[Scout] Brave search failed: %s", exc)
        return []


# ── Agent 1 — The Filter (Flash) ───────────────────────────────────────────────
async def agent_filter(job: dict, candidate: dict) -> dict:
    """
    Low-cost Gemini Flash screening pass.
    Returns { pass: bool, quick_score: int, reason: str }
    """
    logger.info("[Agent 1: Filter] Screening %s @ %s", job.get("title"), job.get("company"))

    # Use PinchTab on the description before sending to the model
    compressed_desc = pinchtab_compress(job.get("description", ""), max_chars=600)

    prompt = textwrap.dedent(f"""
        You are a strict pre-screener. Output ONLY valid JSON on one line. Do NOT output markdown.

        CANDIDATE:
        - Name: {candidate.get('name', 'Thousifuddin Shaik')}
        - Visa: F-1 (CPT/OPT eligible, cannot do clearance roles)
        - Target: PM Intern, BA, Product Manager, Operations Analyst

        JOB:
        Title: {job.get('title')}
        Company: {job.get('company')}
        Key Requirements (compressed): {compressed_desc}

        RULES:
        - quick_score: 1-10 integer (skills alignment only)
        - pass: true if quick_score >= 6 AND no clearance/citizenship-only requirement
        - reason: max 15 words

        OUTPUT: {{"pass": true/false, "quick_score": <int>, "reason": "<str>"}}
    """).strip()

    try:
        raw = await _call_proxy("gemma-local", prompt, max_tokens=120)
        # 🛠️ Bulletproof extraction: Find everything between first { and last }
        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        clean = json_match.group(0) if json_match else raw
        
        result = json.loads(clean)
        logger.info("[Agent 1: Filter] %s — score %s, pass=%s", job.get("company"), result.get("quick_score"), result.get("pass"))
        return result
    except Exception as exc:
        logger.error("[Agent 1: Filter] Failed: %s", exc)
        return {"pass": True, "quick_score": 6, "reason": "Filter parse error — defaulting pass"}


# ── Agent 2 — The Scout (Brave) ────────────────────────────────────────────────
async def agent_scout(job: dict) -> str:
    """
    Uses Brave Search to find real hiring context:
    - Recent news about the company
    - Glassdoor/LinkedIn signals about the team
    - Any known hiring freezes or expansion news

    Returns a formatted markdown string of findings.
    """
    logger.info("[Agent 2: Scout] Searching hiring context for %s", job.get("company"))
    company  = job.get("company", "")
    title    = job.get("title", "")

    queries = [
        f'"{company}" hiring {title} 2025 2026',
        f'"{company}" company culture intern review',
        f'"{company}" layoffs OR expansion OR hiring freeze 2025',
    ]

    all_results = []
    for q in queries:
        results = await _brave_search(q, count=2)
        all_results.extend(results)

    if not all_results:
        return f"No public hiring context found for {company}."

    lines = [f"**Hiring context for {company}:**"]
    for r in all_results[:5]:
        lines.append(f"- **{r['title']}**: {r['snippet'][:200]}")
        if r["url"]:
            lines.append(f"  Source: {r['url']}")

    context = "\n".join(lines)
    logger.info("[Agent 2: Scout] Found %d context results", len(all_results))
    return context


# ── Agent 3 — The Architect (Pro) ──────────────────────────────────────────────
async def agent_architect(job: dict, candidate: dict, filter_result: dict, hiring_context: str) -> dict:
    """
    Gemini Pro synthesis — final deep analysis.
    PinchTab compresses the description before Pro sees it.
    Returns structured dict matching SwarmReport fields.
    """
    logger.info("[Agent 3: Architect] Synthesizing final report for %s @ %s",
                job.get("title"), job.get("company"))

    compressed_desc = pinchtab_compress(job.get("description", ""), max_chars=1200)

    candidate_summary = f"""
Candidate: {candidate.get('name', 'Thousifuddin Shaik')}
Education: {candidate.get('education', {}).get('degree', 'MS CS')} @ IU Indianapolis
Visa: F-1 (CPT/OPT eligible)
Certifications: {', '.join(candidate.get('certifications', ['CSM', 'CSPO']))}
Target Roles: {', '.join(candidate.get('target_roles', ['PM Intern', 'BA', 'Operations Analyst']))}
Experience highlights:
{chr(10).join(f'- {h}' for h in candidate.get('experience_highlights', [])[:4])}
""".strip()

    prompt = textwrap.dedent(f"""
        You are a senior career strategist. Analyze this job match deeply and return ONLY a JSON object.

        CANDIDATE:
        {candidate_summary}

        JOB:
        Title: {job.get('title')}
        Company: {job.get('company')} | Location: {job.get('location', 'N/A')}
        URL: {job.get('url', 'N/A')}
        Pre-screen score: {filter_result.get('quick_score', 'N/A')}/10
        Description (compressed): {compressed_desc}

        HIRING CONTEXT (Scout research):
        {hiring_context[:800]}

        OUTPUT — Return ONLY raw JSON without any markdown formatting (do not use ```json blocks):
        {{
          "match_score": <0-100>,
          "match_label": "Strong" | "Moderate" | "Weak",
          "recommendation": "Apply" | "Tailor" | "Skip",
          "summary": "<1 sentence — why this is or isn't a good fit>",
          "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
          "gaps": ["<gap 1>", "<gap 2>"],
          "email_opening": "<personalized 2-sentence cold email opening for Thousif>",
          "apply_tips": ["<tip 1>", "<tip 2>"]
        }}
    """).strip()

    try:
        raw = await _call_proxy("claude-opus-4-6", prompt, max_tokens=1200)
        # 🛠️ Bulletproof extraction: Find everything between first { and last }
        json_match = re.search(r'\{.*\}', raw, re.DOTALL)
        clean = json_match.group(0) if json_match else raw
        
        result = json.loads(clean)
        logger.info("[Agent 3: Architect] Match=%s (%s), Rec=%s",
                    result.get("match_score"), result.get("match_label"), result.get("recommendation"))
        return result
    except Exception as exc:
        logger.error("[Agent 3: Architect] Failed: %s", exc)
        return {
            "match_score": filter_result.get("quick_score", 5) * 10,
            "match_label": "Moderate",
            "recommendation": "Tailor",
            "summary": "Architect synthesis failed — using filter score as fallback.",
            "strengths": ["PM background", "Agile certifications"],
            "gaps": ["Verify role requirements manually"],
            "email_opening": f"I came across the {job.get('title')} role at {job.get('company')} and believe my PM/BA background is a strong fit.",
            "apply_tips": ["Tailor resume to job description", "Apply within 48 hours"],
        }


# ── HTML Report Builder ────────────────────────────────────────────────────────
def build_html_report(job: dict, filter_result: dict, hiring_context: str, arch: dict) -> str:
    """
    Produces HTML compatible with talon-mailer.mjs utf8Body injection.
    """
    score_color = "#22c55e" if arch["match_score"] >= 70 else "#f59e0b" if arch["match_score"] >= 45 else "#ef4444"
    rec_emoji   = {"Apply": "✅", "Tailor": "🎯", "Skip": "⛔"}.get(arch["recommendation"], "")
    strengths   = "".join(f"<li>{s}</li>" for s in arch.get("strengths", []))
    gaps        = "".join(f"<li>{g}</li>" for g in arch.get("gaps", []))
    tips        = "".join(f"<li>{t}</li>" for t in arch.get("apply_tips", []))

    scout_section = hiring_context.replace("\n", "<br>").replace("**", "")

    return f"""
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; color: #1e293b;">
  <h1 style="color: #6366f1;">🦅 TALON AgentScope Report</h1>
  <h2>{job.get('title')} @ {job.get('company')}</h2>
  <p>📍 {job.get('location', 'N/A')} &nbsp;|&nbsp; Source: {job.get('source', 'N/A').upper()} &nbsp;|&nbsp; Score: {job.get('score', 'N/A')}/10</p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr>
      <td style="padding: 12px; background: {score_color}; color: #fff; border-radius: 8px 0 0 8px; text-align: center; font-size: 28px; font-weight: 700; width: 80px;">
        {arch['match_score']}
      </td>
      <td style="padding: 12px; background: #f8fafc; border-radius: 0 8px 8px 0;">
        <strong>{arch['match_label']} Match</strong> — {rec_emoji} {arch['recommendation']}<br>
        <em>{arch['summary']}</em>
      </td>
    </tr>
  </table>

  <h3>💪 Strengths</h3>
  <ul>{strengths}</ul>

  <h3>📌 Skill Gaps</h3>
  <ul>{gaps}</ul>

  <h3>🔍 Hiring Context (Scout)</h3>
  <p style="background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 13px;">{scout_section}</p>

  <h3>✉️ Suggested Email Opening</h3>
  <blockquote style="border-left: 4px solid #6366f1; padding: 8px 16px; color: #475569;">
    {arch.get('email_opening', '')}
  </blockquote>

  <h3>🎯 Apply Tips</h3>
  <ul>{tips}</ul>

  <hr style="margin: 24px 0;">
  <p style="font-size: 12px; color: #94a3b8;">
    Filter Agent (Flash): Pre-screen score {filter_result.get('quick_score', 'N/A')}/10 — {filter_result.get('reason', '')}<br>
    Generated by TALON AgentScope Phase 29
  </p>
  <p><a href="{job.get('url', '#')}" style="color: #6366f1;">→ View Full Job Posting</a></p>
</div>
""".strip()


# ── Swarm Endpoint ─────────────────────────────────────────────────────────────
@router.post("/analyze", summary="Run 3-Agent Swarm on a Job")
async def run_swarm(body: SwarmRequest) -> JSONResponse:
    """
    Runs the full AgentScope pipeline:
    Filter (Flash) → Scout (Brave) → Architect (Pro)

    Returns SwarmReport JSON compatible with talon-mailer.mjs.
    """
    job       = body.job
    candidate = body.candidate
    trace     = []

    # ── Agent 1: Filter ──────────────
    t0 = time.monotonic()
    filter_result = await agent_filter(job, candidate)
    trace.append(f"[{time.monotonic()-t0:.1f}s] Filter: score={filter_result.get('quick_score')}, pass={filter_result.get('pass')}")

    # Short-circuit if Filter hard-rejects
    if not filter_result.get("pass", True):
        return JSONResponse(content={
            "job_data":       job,
            "analysis_html":  f"<p>⚡ Pre-screened out by Filter Agent: {filter_result.get('reason')}</p>",
            "match_score":    filter_result.get("quick_score", 0) * 10,
            "match_label":    "Filtered Out",
            "recommendation": "Skip",
            "summary":        filter_result.get("reason", "Pre-screened out."),
            "strengths":      [],
            "gaps":           ["Did not pass initial screening"],
            "hiring_context": "",
            "agent_trace":    trace,
        })

    # ── Agent 2: Scout ───────────────
    t1 = time.monotonic()
    hiring_context = await agent_scout(job)
    trace.append(f"[{time.monotonic()-t1:.1f}s] Scout: collected hiring context ({len(hiring_context)} chars)")

    # ── Agent 3: Architect ───────────
    t2 = time.monotonic()
    arch = await agent_architect(job, candidate, filter_result, hiring_context)
    trace.append(f"[{time.monotonic()-t2:.1f}s] Architect: {arch.get('match_label')} ({arch.get('match_score')}/100)")

    # ── Build HTML report for mailer ─
    html_report = build_html_report(job, filter_result, hiring_context, arch)

    report = {
        "job_data":       job,
        "analysis_html":  html_report,
        "match_score":    arch.get("match_score", 50),
        "match_label":    arch.get("match_label", "Moderate"),
        "recommendation": arch.get("recommendation", "Tailor"),
        "summary":        arch.get("summary", ""),
        "strengths":      arch.get("strengths", []),
        "gaps":           arch.get("gaps", []),
        "hiring_context": hiring_context,
        "agent_trace":    trace,
    }

    logger.info("[Swarm] Complete for %s @ %s — %s (%s/100)",
                job.get("title"), job.get("company"),
                report["match_label"], report["match_score"])

    return JSONResponse(content=report)
