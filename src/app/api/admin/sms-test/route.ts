import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";
import { sendSms, SemaphoreError } from "@/lib/sms";

/**
 * POST /api/admin/sms-test — administrator-only SMS test.
 *
 * Sends a FIXED test message to the administrator's own phone number. An
 * optional `phone` in the body overrides the saved number and is persisted to
 * the administrator's account. The Semaphore API key never leaves the server:
 * it is read from `SEMAPHORE_API_KEY` inside `src/lib/sms.ts`.
 *
 * Delivery is never claimed here — the response reports Semaphore's own status
 * ("Queued" | "Pending" | "Sent") verbatim.
 */

// Deliberately does NOT start with "TEST": Semaphore silently drops messages
// that begin with that word.
const TEST_MESSAGE =
  "SPARKServ: your SMS integration is working. This is a test message sent to your administrator account.";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireRole(["admin", "super_admin"]);

    const body = await request.json().catch(() => ({}));
    const submittedPhone = typeof body.phone === "string" ? body.phone.trim() : "";
    const phone = submittedPhone || admin.phone;

    if (!phone) {
      return NextResponse.json(
        { error: "Enter a phone number to send the test message to." },
        { status: 400 }
      );
    }

    // Save the number to the administrator's own account (RLS-scoped), so it
    // becomes their registered phone for future sends.
    if (submittedPhone && submittedPhone !== admin.phone) {
      const supabase = createClient();
      const { error } = await supabase
        .from("users")
        .update({ phone: submittedPhone })
        .eq("id", admin.id);
      if (error) throw error;
    }

    const result = await sendSms({ number: phone, message: TEST_MESSAGE });

    return NextResponse.json({
      ok: true,
      recipient: result.item.recipient ?? phone,
      messageId: result.messageId,
      status: result.status,
      network: result.item.network ?? null,
      note:
        result.status === "Sent"
          ? "Semaphore confirmed delivery to the mobile network."
          : `Semaphore accepted the message (status: ${result.status}). Delivery is not confirmed until Semaphore reports "Sent".`,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SemaphoreError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: statusForSemaphoreError(err) }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Unable to send the test SMS" }, { status: 500 });
  }
}

function statusForSemaphoreError(err: SemaphoreError): number {
  switch (err.code) {
    case "invalid_number":
      return 400;
    case "not_configured":
      return 500;
    default:
      // Provider, network, insufficient-credits, and API-key problems.
      return 502;
  }
}
