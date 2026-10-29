"use client";

import { useState } from "react";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import type { MessageRow } from "@/types/database";

/**
 * The conversation itself.
 *
 * Rendered ONLY by the two Messages conversation pages. The booking and job pages link
 * to it instead of embedding it, so a conversation is read in one place, in one
 * layout — not buried under a payment card and a rating card.
 */
interface MessageThreadProps {
  bookingId: string;
  currentUserId: string;
  otherUserId: string;
  initialMessages: MessageRow[];
}

export default function MessageThread({
  bookingId,
  currentUserId,
  otherUserId,
  initialMessages,
}: MessageThreadProps) {
  const messages = useRealtimeMessages(bookingId, initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bookingId,
          receiver_id: otherUserId,
          content: input.trim(),
        }),
      });
      setInput("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[420px] flex-col rounded-card border border-ink/8">
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-ink/35">No messages yet — say hello!</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.sender_id === currentUserId ? "text-right" : "text-left"}>
            <span
              className={`inline-block max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.sender_id === currentUserId
                  ? "bg-brand-600 text-white"
                  : "bg-ink/5 text-ink"
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-ink/8 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          className="flex-1 rounded-lg border border-ink/15 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/60 outline-none"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
