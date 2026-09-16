"use client";

import { useState } from "react";
import type { ChatbotSuggestion } from "@/types";
import type { IssueCategory } from "@/types";

interface ChatMessage {
  role: "user" | "bot";
  text: string;
  tips?: string[];
  suggestion?: ChatbotSuggestion;
}

interface ChatbotProps {
  onFirstMessage?: () => void;
}

export default function Chatbot({ onFirstMessage }: ChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "bot",
      text: "Hi! Describe the problem with your appliance and I'll suggest a few quick things to check before booking a technician.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applianceType, setApplianceType] = useState("refrigerator");
  const [resolved, setResolved] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;

    const userText = input.trim();
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setInput("");
    setSending(true);
    onFirstMessage?.();

    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, applianceType }),
      });
      const json = await res.json();
      const suggestion: ChatbotSuggestion = json.data;

      setMessages((prev) => [
        ...prev,
        { role: "bot", text: suggestion.message, tips: suggestion.tips, suggestion },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "Sorry, something went wrong. You can still submit a service request." },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleCategoryChoice(issueCategory: IssueCategory) {
    setSending(true);
    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "", applianceType, issueCategory }),
      });
      const json = await res.json();
      const suggestion: ChatbotSuggestion = json.data;
      setMessages((prev) => [...prev, { role: "bot", text: suggestion.message, tips: suggestion.tips, suggestion }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-card border border-ink/8">
      <div className="border-b border-ink/8 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Troubleshooting assistant</h2>
        <p className="text-xs text-ink/50">Rule-based — instant, no AI call needed</p>
        <select value={applianceType} onChange={(e) => setApplianceType(e.target.value)} className="mt-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm">
          <option value="refrigerator">Refrigerator</option>
          <option value="aircon">Air Conditioner</option>
          <option value="washing_machine">Washing Machine</option>
          <option value="tv">Television</option>
          <option value="electric_fan">Electric Fan</option>
        </select>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" style={{ maxHeight: 360 }}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-brand-600 text-white" : "bg-ink/5 text-ink"
              }`}
            >
              <p>{m.text}</p>
              {m.tips && m.tips.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                  {m.tips.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              )}
              {m.suggestion?.needsClarification && m.suggestion.issueOptions && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.suggestion.issueOptions.map((option) => (
                    <button key={option.value} onClick={() => handleCategoryChoice(option.value)} className="rounded-md border border-brand-200 bg-white px-2 py-1 text-xs font-medium text-brand-700">
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {m.suggestion?.matched && !m.suggestion.needsClarification && !m.suggestion.safetyWarning && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setResolved(true)} className="rounded-md bg-signal-500 px-2 py-1 text-xs font-semibold text-white">Yes, it worked</button>
                  <a href="/customer/inquiry" className="rounded-md border border-brand-200 bg-white px-2 py-1 text-xs font-semibold text-brand-700">No, I still need help</a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-ink/8 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="e.g. fridge is not cooling"
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded-lg bg-ink px-3 py-2 text-sm text-white hover:bg-ink/80 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {resolved && <p className="border-t border-signal-100 bg-signal-50 px-4 py-2 text-xs font-medium text-signal-600">Troubleshooting session marked as resolved.</p>}
    </div>
  );
}
