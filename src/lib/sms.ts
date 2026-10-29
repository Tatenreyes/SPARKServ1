/**
 * Semaphore SMS — SERVER-ONLY utility. Reads credentials from server-side env
 * vars and POSTs to the official Semaphore v4 endpoint. Never import from a
 * Client Component — it reads `process.env` and would leak the API key.
 * Provider docs: https://api.semaphore.co/docs (POST .../api/v4/messages).
 */

const SEMAPHORE_ENDPOINT = "https://api.semaphore.co/api/v4/messages";
const REQUEST_TIMEOUT_MS = 15_000;

/** Delivery states Semaphore reports for an accepted message. */
export type SemaphoreSendStatus = "Queued" | "Pending" | "Sent";

export interface SemaphoreMessage {
  message_id?: number | null;
  recipient?: string | null;
  message?: string | null;
  sender_name?: string | null;
  network?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface SendSmsResult {
  item: SemaphoreMessage;
  status: SemaphoreSendStatus;
  messageId: number | null;
}

/** A provider/config failure. `code` is machine-readable; `message` is admin-safe. */
export class SemaphoreError extends Error {
  code:
    | "not_configured"
    | "invalid_number"
    | "network_error"
    | "http_error"
    | "unexpected_response"
    | "invalid_api_key"
    | "insufficient_credits"
    | "provider_error";
  providerStatus: string | null;

  constructor(
    message: string,
    code: SemaphoreError["code"],
    providerStatus: string | null = null
  ) {
    super(message);
    this.name = "SemaphoreError";
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

/**
 * Sends one SMS via Semaphore. Throws `SemaphoreError` on provider rejection,
 * network failure, or misconfiguration. Returns the provider's own status
 * verbatim — it never claims delivery: only "Sent" means handed to the network.
 */
export async function sendSms(options: {
  number: string;
  message: string;
}): Promise<SendSmsResult> {
  const { number, message } = options;

  const apiKey = process.env.SEMAPHORE_API_KEY?.trim();
  const senderName = process.env.SEMAPHORE_SENDER_NAME?.trim();

  if (!apiKey) {
    throw new SemaphoreError("SEMAPHORE_API_KEY is not set on the server.", "not_configured");
  }

  const recipient = normalizePhilippineMobile(number);
  if (!recipient) {
    throw new SemaphoreError(
      "The phone number on the account is missing or invalid.",
      "invalid_number"
    );
  }

  const body = new URLSearchParams({ apikey: apiKey, number: recipient, message });
  if (senderName) body.set("sendername", senderName);

  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(SEMAPHORE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new SemaphoreError("Could not reach the Semaphore SMS provider.", "network_error");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SemaphoreError(
      `Semaphore returned HTTP ${response.status}${text ? `: ${text}` : ""}.`,
      "http_error"
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new SemaphoreError("Semaphore returned a non-JSON response.", "unexpected_response");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new SemaphoreError(
      "Semaphore returned an unexpected response shape.",
      "unexpected_response"
    );
  }

  const first = parsed[0] as SemaphoreMessage;
  const status = String(first.status ?? "").toLowerCase();

  // "Error" = provider rejection (bad API key, insufficient credits, etc.).
  if (status === "error") {
    const providerMessage = first.message ?? "Semaphore rejected the request.";
    throw new SemaphoreError(
      providerMessage,
      classifyProviderError(providerMessage),
      String(first.status)
    );
  }

  // The network rejected or refunded the message — it was not delivered.
  if (status === "failed" || status === "refunded") {
    throw new SemaphoreError(
      `Semaphore reported the message as ${String(first.status)}.`,
      "provider_error",
      String(first.status)
    );
  }

  if (!["queued", "pending", "sent"].includes(status)) {
    throw new SemaphoreError(
      `Semaphore returned an unknown status: ${String(first.status ?? "unknown")}.`,
      "unexpected_response",
      first.status ?? null
    );
  }

  return {
    item: first,
    status: first.status as SemaphoreSendStatus,
    messageId: typeof first.message_id === "number" ? first.message_id : null,
  };
}

function classifyProviderError(message: string): SemaphoreError["code"] {
  const lower = message.toLowerCase();
  if (lower.includes("api key") || lower.includes("apikey")) return "invalid_api_key";
  if (lower.includes("credit")) return "insufficient_credits";
  return "provider_error";
}

/** Normalises PH mobile numbers to 63xxxxxxxxxx; unknown shapes pass through. */
function normalizePhilippineMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("63") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `63${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `63${digits}`;
  return digits;
}
