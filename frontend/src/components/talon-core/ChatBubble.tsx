"use client";

/**
 * ChatBubble.tsx — TALON Phase 28
 * Floating chat widget connected to TalonFlow /api/portfolio/chat on port 8000.
 * Supports Quick Action buttons for PM/BA interview prep flows.
 */

import { useState, useRef, useEffect, useCallback } from "react";

const TALONFLOW_URL =
  process.env.NEXT_PUBLIC_TALONFLOW_URL ?? "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────
type Role = "user" | "assistant" | "system";

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  isPredefined?: boolean;
  categories?: Record<string, unknown>;
}

interface QuickAction {
  label: string;
  icon: string;
  message: string;
}

// ── Quick actions ─────────────────────────────────────────────────────────
const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "PM Interview Prep",
    icon: "🎯",
    message: "Give me PM interview prep questions and answers",
  },
  {
    label: "BA Interview Prep",
    icon: "📊",
    message: "Give me BA behavioral interview questions and answers",
  },
  {
    label: "Resume Tips",
    icon: "📝",
    message: "Give me tips on how to optimize my resume for PM and BA roles",
  },
  {
    label: "Mock Interview",
    icon: "🎤",
    message: "Start a mock interview practice session for project manager roles",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2);
}

async function sendToPortfolioChat(message: string): Promise<{
  type: string;
  data: unknown;
  thread_id: string;
}> {
  const res = await fetch(`${TALONFLOW_URL}/api/portfolio/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`TalonFlow responded ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{ type: string; data: unknown; thread_id: string }>;
}

/** Flatten a predefined Q&A response into a readable markdown string */
function formatPredefinedResponse(data: unknown): string {
  const d = data as { meta?: Record<string, string>; categories?: Record<string, unknown> };
  const categories = d?.categories ?? {};
  const lines: string[] = ["**📋 Interview Prep Pack**\n"];

  for (const [, cat] of Object.entries(categories)) {
    const c = cat as {
      label?: string;
      questions?: Array<{ q: string; a: string; tags?: string[] }>;
      tips?: string[];
    };
    if (!c) continue;
    lines.push(`### ${c.label ?? "Category"}`);

    if (c.questions) {
      c.questions.forEach((item, i) => {
        lines.push(`\n**Q${i + 1}: ${item.q}**`);
        lines.push(`> ${item.a}`);
        if (item.tags?.length) lines.push(`*Tags: ${item.tags.join(", ")}*`);
      });
    }

    if (c.tips) {
      lines.push("\n**💡 Tips:**");
      c.tips.forEach((tip, i) => lines.push(`${i + 1}. ${tip}`));
    }
  }

  return lines.join("\n");
}

// ── Message bubble ─────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          background: isUser
            ? "linear-gradient(135deg, #6366f1, #818cf8)"
            : msg.isPredefined
              ? "linear-gradient(135deg, #0f2027, #1a3a4a)"
              : "#1e293b",
          color: "#f1f5f9",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          boxShadow: isUser
            ? "0 2px 12px rgba(99,102,241,0.35)"
            : "0 2px 8px rgba(0,0,0,0.3)",
          border: msg.isPredefined ? "1px solid rgba(56,189,248,0.2)" : "none",
        }}
      >
        {msg.content}
      </div>
      <span style={{ fontSize: 10, color: "#64748b", marginTop: 3, paddingInline: 4 }}>
        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {msg.isPredefined && " · Predefined Q&A"}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ChatBubble() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "👋 Hi! I'm your TALON career assistant.\n\nAsk me anything about your job search, or use the quick actions below for interview prep.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await sendToPortfolioChat(trimmed);

      let content = "";
      let isPredefined = false;

      if (res.type === "predefined") {
        content      = formatPredefinedResponse(res.data);
        isPredefined = true;
      } else {
        const d = res.data as { response?: string };
        content = d?.response ?? "I received your message but got an unexpected response format.";
      }

      const botMsg: Message = {
        id: uid(),
        role: "assistant",
        content,
        timestamp: new Date(),
        isPredefined,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: uid(),
        role: "system",
        content: `⚠️ Error: ${(err as Error).message}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <>
      {/* ── Floating toggle button ─────────────────────────── */}
      <button
        id="talon-chat-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle TALON chat"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #38bdf8)",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          boxShadow: "0 4px 20px rgba(99,102,241,0.5)",
          zIndex: 9999,
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            "0 6px 26px rgba(99,102,241,0.7)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            "0 4px 20px rgba(99,102,241,0.5)";
        }}
      >
        {open ? "✕" : "🦅"}
      </button>

      {/* ── Chat panel ─────────────────────────────────────── */}
      {open && (
        <div
          id="talon-chat-panel"
          style={{
            position: "fixed",
            bottom: 92,
            right: 24,
            width: 380,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            background: "#0f172a",
            borderRadius: 16,
            border: "1px solid rgba(99,102,241,0.25)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1)",
            zIndex: 9998,
            overflow: "hidden",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            animation: "talon-slide-up 0.22s ease",
          }}
        >
          {/* ── Header ─────────────── */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(99,102,241,0.2)",
              background: "linear-gradient(90deg, #1e1b4b, #0f172a)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🦅</span>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>
                TALON Career Assistant
              </div>
              <div style={{ color: "#94a3b8", fontSize: 11 }}>
                Powered by TalonFlow · Phase 28
              </div>
            </div>
            <div
              style={{
                marginLeft: "auto",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 6px #22c55e",
              }}
            />
          </div>

          {/* ── Messages ───────────── */}
          <div
            id="talon-message-thread"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              scrollbarWidth: "thin",
              scrollbarColor: "#334155 transparent",
            }}
          >
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} />
            ))}
            {loading && (
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>
                🦅 Thinking
                <span className="talon-dots">...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Quick Actions ──────── */}
          <div
            id="talon-quick-actions"
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 12px",
              borderTop: "1px solid rgba(99,102,241,0.15)",
              flexWrap: "wrap",
              background: "#0a1120",
            }}
          >
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.label}
                id={`talon-qa-${qa.label.replace(/\s+/g, "-").toLowerCase()}`}
                onClick={() => void sendMessage(qa.message)}
                disabled={loading}
                style={{
                  padding: "5px 10px",
                  borderRadius: 20,
                  border: "1px solid rgba(99,102,241,0.3)",
                  background: "rgba(99,102,241,0.08)",
                  color: "#a5b4fc",
                  fontSize: 11,
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!loading)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(99,102,241,0.2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(99,102,241,0.08)";
                }}
              >
                {qa.icon} {qa.label}
              </button>
            ))}
          </div>

          {/* ── Input row ─────────── */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 12px",
              borderTop: "1px solid rgba(99,102,241,0.15)",
              background: "#0f172a",
            }}
          >
            <textarea
              id="talon-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything… (Enter to send)"
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                background: "#1e293b",
                border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: 10,
                color: "#f1f5f9",
                padding: "8px 12px",
                fontSize: 13,
                resize: "none",
                outline: "none",
                lineHeight: 1.5,
              }}
            />
            <button
              id="talon-chat-send"
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                padding: "0 14px",
                borderRadius: 10,
                border: "none",
                background:
                  loading || !input.trim()
                    ? "#1e293b"
                    : "linear-gradient(135deg, #6366f1, #818cf8)",
                color: loading || !input.trim() ? "#475569" : "#fff",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                fontSize: 16,
                transition: "all 0.15s ease",
              }}
            >
              {loading ? "⏳" : "↑"}
            </button>
          </div>
        </div>
      )}

      {/* ── Keyframe animation injected once ─────────────────── */}
      <style>{`
        @keyframes talon-slide-up {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
    </>
  );
}
