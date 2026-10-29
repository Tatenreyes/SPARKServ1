"use client";

import { useState } from "react";
import { Phone, Send } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | {
      kind: "success";
      recipient: string;
      status: string;
      messageId: number | null;
      network: string | null;
      note: string;
    }
  | { kind: "error"; message: string };

/**
 * Administrator-only SMS test control.
 *
 * Talks to `POST /api/admin/sms-test`, which enforces the admin role server-side
 * and sends a fixed test message to the administrator's own phone number. This
 * component never sees the Semaphore API key — it is read from the server env.
 */
export default function AdminSmsTest({ phone }: { phone: string | null }) {
  const [phoneInput, setPhoneInput] = useState(phone ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function runTest() {
    const number = phoneInput.trim();
    if (!number) return;
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/admin/sms-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: number }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: payload.error ?? "The test SMS could not be sent." });
        return;
      }
      setState({
        kind: "success",
        recipient: payload.recipient ?? number,
        status: payload.status ?? "",
        messageId: payload.messageId ?? null,
        network: payload.network ?? null,
        note: payload.note ?? "",
      });
    } catch {
      setState({ kind: "error", message: "The test SMS could not be sent." });
    }
  }

  return (
    <div>
      <label htmlFor="admin-sms-phone" className="mb-1 block text-xs font-semibold text-ink/80">
        Phone number
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted/80">
            <Phone className="h-4 w-4" />
          </span>
          <input
            id="admin-sms-phone"
            type="tel"
            inputMode="tel"
            value={phoneInput}
            onChange={(event) => setPhoneInput(event.target.value)}
            placeholder="e.g. 09171234567"
            className="w-full rounded-lg border border-line bg-soft py-2.5 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-line"
          />
        </div>
        <button
          onClick={runTest}
          disabled={state.kind === "busy" || !phoneInput.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {state.kind === "busy" ? "Sending…" : "Send test SMS"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Saved to your account and used for the test message.
      </p>

      {state.kind === "success" && (
        <p className="mt-3 text-xs leading-relaxed text-signal-ink" role="status">
          Sent to <span className="font-semibold">{state.recipient}</span>
          {state.network ? ` (${state.network})` : ""} — Semaphore status:{" "}
          <span className="font-semibold">{state.status}</span>
          {state.messageId ? ` · message ${state.messageId}` : ""}. {state.note}
        </p>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-xs leading-relaxed text-alert-ink" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
