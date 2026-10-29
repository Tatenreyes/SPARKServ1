import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import type { Database } from "@/types/database";

/** The structured result of `reject_payment()`. */
interface RejectionOutcome {
  outcome?: string;
  reason?: string;
  payment_id?: string;
  payment?: Record<string, unknown>;
  payment_status?: string;
  rejection_reason?: string;
  rejected_at?: string;
  booking_id?: string;
  booking_status?: string;
  customer_id?: string;
  max_length?: number;
}

// PATCH /api/payments/:id — admin confirms or rejects a submitted payment reference.
//
// Confirmation runs through `confirm_payment()`: ONE transaction that verifies the
// payment AND closes the repair (booking → completed, service_history archived,
// request closed, technician slot freed).
//
// Rejection runs through `reject_payment()` (Batch 3): ONE transaction that records
// the decision on its own columns and touches nothing else. The repair stays where
// it is — normally the payment step — so the customer can submit a new reference.
// Before Batch 3 this branch was a raw service-role `update` that wrote
// `confirmed_by`/`confirmed_at`, so a rejection was recorded as a verification and
// nothing in the database enforced that only an administrator may reject.
//
// Neither decision is enforced by this route alone: the database re-reads the
// actor's role, holds the row lock, and owns the transition. The service-role
// client is used because there is no RLS update policy for payments (customers can
// only insert, never edit after submitting — that is intentional, and the insert
// policy pins the row to 'pending_verification' with no decision metadata).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "admin" && user.role !== "super_admin") {
      throw new AuthError("Only admins can verify payments", 403);
    }

    const body = await request.json();
    const { status } = body;
    if (status !== "confirmed" && status !== "rejected") {
      return NextResponse.json(
        { error: "status must be 'confirmed' or 'rejected'" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id, status")
      .eq("id", params.id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (existing.status !== "pending_verification") {
      return NextResponse.json({ error: "Payment has already been processed" }, { status: 409 });
    }

    if (status === "confirmed") {
      const { data, error } = await supabase.rpc("confirm_payment", {
        p_payment_id: params.id,
        p_actor: user.id,
      });

      if (error) {
        // Deployment ahead of database: confirm_payment() arrives with
        // migration_rls_workflow_enforcement.sql. Say which file is missing instead
        // of a bare 500 — and never fall back to confirming the payment alone, which
        // would record a verified payment against a repair that can no longer be
        // completed.
        const code = (error as { code?: string }).code;
        const message = (error as { message?: string }).message ?? "";
        if (code === "PGRST202" || /confirm_payment/.test(message)) {
          return NextResponse.json(
            {
              error:
                "Payment verification is not installed on this database yet. Apply supabase/migration_rls_workflow_enforcement.sql, then try again.",
              code: "PAYMENT_SETUP_REQUIRED",
            },
            { status: 503 }
          );
        }
        throw error;
      }

      const outcome = data as unknown as {
        outcome?: string;
        payment_id?: string;
        payment_status?: string;
        booking_status?: string;
        completed_now?: boolean;
      };

      const { data: payment } = await supabase
        .from("payments")
        .select("*")
        .eq("id", params.id)
        .single();

      // A payment already verified by a concurrent click changes nothing.
      if (outcome?.outcome === "not_pending") {
        return NextResponse.json(
          { error: "Payment has already been processed", data: payment, outcome },
          { status: 409 }
        );
      }

      // The appointment was cancelled while this reference was waiting: there is no
      // repair left to close. The payment is still pending, so the administrator can
      // reject it and the customer can book again.
      if (outcome?.outcome === "booking_cancelled") {
        return NextResponse.json(
          {
            error:
              "This appointment was cancelled, so the payment cannot complete it. Reject the payment, or ask the customer to book again.",
            data: payment,
            outcome,
          },
          { status: 409 }
        );
      }

      if (payment) {
        await notify(supabase, {
          userId: payment.customer_id,
          type: "payment_confirmed",
          title: "Payment confirmed",
          body: outcome?.completed_now
            ? `Your payment of ₱${payment.amount.toFixed(2)} has been verified and your repair is complete.`
            : `Your payment of ₱${payment.amount.toFixed(2)} has been verified.`,
          link: `/customer/bookings/${payment.booking_id}`,
        });
      }

      return NextResponse.json({ data: payment, outcome });
    }

    // ---- Rejection ------------------------------------------------------------
    // The reason is customer-facing text, so it is required and bounded. Validated
    // here for a fast, readable error, and again inside the function — the database
    // is the boundary, not this check.
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json(
        { error: "A rejection reason is required — the customer is told why." },
        { status: 400 }
      );
    }
    if (reason.length > 500) {
      return NextResponse.json(
        { error: "The rejection reason must be 500 characters or fewer." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("reject_payment", {
      p_payment_id: params.id,
      p_actor: user.id,
      p_reason: reason,
    });

    if (error) {
      // Deployment ahead of database: reject_payment() arrives with
      // migration_reject_payment.sql. Say which file is missing instead of a bare
      // 500 — and never fall back to writing the decision by hand, which is exactly
      // what recorded a rejection as a verification.
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      if (code === "PGRST202" || /reject_payment/.test(message)) {
        return NextResponse.json(
          {
            error:
              "Payment rejection is not installed on this database yet. Apply supabase/migration_reject_payment.sql, then try again.",
            code: "PAYMENT_SETUP_REQUIRED",
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return await mapRejectionOutcome((data ?? {}) as RejectionOutcome, supabase, params.id);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Translate the function's outcome into the API's status codes.
 *
 * 200 rejected · 409 for a decision that already happened · 404 for a reference that
 * no longer exists · 403 for an actor the database refused · 400 for a missing or
 * oversized reason. Every one of those is an outcome, never a raised error, so a
 * lost race reads as a conflict instead of a 500. An unrecognised outcome is never
 * reported as success.
 */
async function mapRejectionOutcome(
  outcome: RejectionOutcome,
  supabase: SupabaseClient<Database>,
  paymentId: string
) {
  switch (outcome.outcome) {
    case "rejected": {
      // AFTER the transaction has committed: tell the customer why, which is what
      // makes the resubmission this administrator was promised actually happen. A
      // failed notification must not turn a recorded decision into an error.
      if (outcome.customer_id && outcome.booking_id) {
        const amount = Number((outcome.payment as { amount?: unknown } | undefined)?.amount);
        await notify(supabase, {
          userId: outcome.customer_id,
          type: "payment_rejected",
          title: "Payment reference rejected",
          body: Number.isFinite(amount)
            ? `${outcome.rejection_reason} You can submit a new reference for ₱${amount.toFixed(2)}.`
            : `${outcome.rejection_reason} You can submit a new reference from your booking page.`,
          link: `/customer/bookings/${outcome.booking_id}`,
        });
      }

      return NextResponse.json({ data: outcome.payment, outcome });
    }

    case "not_pending":
      return NextResponse.json(
        {
          error: "Payment has already been processed",
          data: null,
          outcome,
        },
        { status: 409 }
      );

    case "not_found":
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    case "forbidden":
      return NextResponse.json(
        { error: "Only an administrator can reject a payment", outcome },
        { status: 403 }
      );

    case "invalid_input":
      return NextResponse.json(
        {
          error:
            outcome.reason === "reason_too_long"
              ? `The rejection reason must be ${outcome.max_length ?? 500} characters or fewer.`
              : "A rejection reason is required — the customer is told why.",
          outcome,
        },
        { status: 400 }
      );

    default:
      // An outcome this route does not know means the function changed underneath
      // it. Say so in the log instead of pretending the rejection worked.
      console.error("reject_payment returned an unrecognised outcome", outcome, paymentId);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
