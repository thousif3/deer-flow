# TALON Phase 28 — Portfolio Hybrid Chat Router
# Routes interview/prep queries to static Q&A; everything else -> lead_agent swarm

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

# ── Constants ─────────────────────────────────────────────────────────────────
QUESTIONS_FILE = Path(__file__).parent.parent.parent.parent / "predefined_questions.json"

INTERVIEW_KEYWORDS = {"interview", "questions", "prep", "practice", "mock", "behavioral", "q&a"}

# Internal LangGraph / DeerFlow base URL (same process — gateway calls langgraph server)
LANGGRAPH_URL = os.environ.get("LANGGRAPH_API_URL", "http://localhost:2024")


# ── Request / Response models ─────────────────────────────────────────────────
class PortfolioChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    stream: bool = False
    category: str | None = None   # optional: "pm_behavioral" | "ba_behavioral" | "technical_pm"


class PortfolioChatResponse(BaseModel):
    type: str         # "predefined" | "agent"
    message: str      # echo of the user's input
    data: Any         # structured Q&A payload OR agent text response


# ── Helpers ───────────────────────────────────────────────────────────────────
def _load_questions() -> dict:
    """Load predefined_questions.json; returns empty dict on failure."""
    try:
        return json.loads(QUESTIONS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error("Failed to load predefined_questions.json: %s", exc)
        return {}


def _is_interview_query(message: str) -> bool:
    """Returns True if the message contains any interview-related keyword."""
    lower = message.lower()
    return any(kw in lower for kw in INTERVIEW_KEYWORDS)


def _select_category(message: str, requested: str | None, questions: dict) -> dict | None:
    """
    Pick the right Q&A category.
    Priority: explicit `category` param > keyword hints in message > return all categories.
    """
    categories: dict = questions.get("categories", {})
    if not categories:
        return None

    # Honour explicit category override
    if requested and requested in categories:
        return {requested: categories[requested]}

    # Keyword-based auto-routing
    lower = message.lower()
    if "ba" in lower or "business analyst" in lower:
        return {"ba_behavioral": categories.get("ba_behavioral", {})}
    if "technical" in lower or "engineering" in lower:
        return {"technical_pm": categories.get("technical_pm", {})}
    if "pm" in lower or "product manager" in lower or "project manager" in lower:
        return {"pm_behavioral": categories.get("pm_behavioral", {})}

    # Default: return all categories
    return categories


async def _forward_to_agent(message: str, thread_id: str, stream: bool) -> Any:
    """
    Forward message to DeerFlow lead_agent via the LangGraph run endpoint.
    Returns parsed JSON body or raises HTTPException.
    """
    payload = {
        "assistant_id": "agent",
        "input": {"messages": [{"role": "user", "content": message}]},
        "config": {"configurable": {"thread_id": thread_id}},
        "stream_mode": ["values"] if stream else [],
    }

    url = f"{LANGGRAPH_URL}/threads/{thread_id}/runs/stream" if stream else f"{LANGGRAPH_URL}/threads/{thread_id}/runs/wait"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("LangGraph agent error: %s — %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail=f"Agent error: {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        logger.error("LangGraph connection error: %s", exc)
        raise HTTPException(status_code=503, detail="Agent unavailable — LangGraph not reachable") from exc


# ── Endpoint ──────────────────────────────────────────────────────────────────
@router.post("/chat", response_model=None, summary="Portfolio Hybrid Chat Router")
async def portfolio_chat(body: PortfolioChatRequest) -> JSONResponse:
    """
    Hybrid router:
    - Message contains interview/prep keywords → returns static Q&A from predefined_questions.json
    - All other messages → forwarded to the lead_agent LangGraph swarm
    """
    message   = body.message.strip()
    thread_id = body.thread_id or str(uuid.uuid4())

    if not message:
        raise HTTPException(status_code=422, detail="message must not be empty")

    # ── Branch A: Interview / Prep query ─────────────────────────────────────
    if _is_interview_query(message):
        logger.info("[PortfolioRouter] Interview keyword detected — serving predefined Q&A")
        questions = _load_questions()
        selected  = _select_category(message, body.category, questions)

        return JSONResponse(content={
            "type":      "predefined",
            "message":   message,
            "thread_id": thread_id,
            "data": {
                "meta":       questions.get("meta", {}),
                "categories": selected or {},
            },
        })

    # ── Branch B: General query → lead_agent swarm ───────────────────────────
    logger.info("[PortfolioRouter] Forwarding to lead_agent swarm (thread=%s)", thread_id)
    agent_result = await _forward_to_agent(message, thread_id, body.stream)

    # Extract the last assistant message text from LangGraph response
    agent_text = ""
    try:
        msgs = agent_result.get("messages") or agent_result.get("output", {}).get("messages", [])
        for m in reversed(msgs):
            role = m.get("role") or m.get("type", "")
            if role in ("assistant", "ai"):
                agent_text = m.get("content", "")
                break
    except Exception:
        agent_text = str(agent_result)

    return JSONResponse(content={
        "type":      "agent",
        "message":   message,
        "thread_id": thread_id,
        "data": {
            "response": agent_text,
            "raw":      agent_result,
        },
    })
