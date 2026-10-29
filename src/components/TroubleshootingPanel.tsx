"use client";

/**
 * The inline troubleshooting block for the "Problem description" section.
 *
 * It replaces the permanent side-panel card, which rendered steps as soon as an
 * appliance was chosen. Nothing is shown here until an issue has been
 * **identified**: either the customer picked one from the list, or they confirmed
 * a suggestion produced by `matchIssue()`.
 *
 * All matching and selection logic lives in `src/lib/issue-matching.ts`; this
 * component only presents the result and reports the customer's choices upward.
 */

import { AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, ShieldCheck } from "lucide-react";
import { getIssueLabel, type ApplianceIssue } from "@/lib/appliance-issues";
import type { IssueMatchResult, TroubleshootingOutcome } from "@/lib/issue-matching";
import {
  NO_GUIDE_MESSAGE,
  TROUBLESHOOTING_DISCLAIMER,
  type TroubleshootingStep,
} from "@/lib/troubleshooting";

export interface TroubleshootingPanelProps {
  applianceType: string;
  /** The appliance's own issue list, for the "choose an issue" shortcuts. */
  issues: ApplianceIssue[];
  /** What the matcher found for the current description. */
  match: IssueMatchResult;
  /** The identified issue: explicitly selected or a confirmed suggestion. */
  identifiedIssueId: string | null;
  /** The guide for the identified issue (null = none exists). */
  guide: TroubleshootingStep[] | null;
  outcome: TroubleshootingOutcome | null;
  /** The customer confirmed the suggested issue. */
  onConfirmSuggestion: (issueId: string) => void;
  /** The customer said the suggestion is wrong. */
  onRejectSuggestion: () => void;
  /** The customer picked an issue from a list. */
  onChooseIssue: (issueId: string) => void;
  onOutcomeChange: (outcome: TroubleshootingOutcome) => void;
  /** "Skip troubleshooting" / "Continue without troubleshooting". */
  onSkip: () => void;
  /** A suggestion was already rejected for the current description. */
  suggestionDismissed: boolean;
  /** The customer has not described anything yet. */
  awaitingDescription: boolean;
}

export default function TroubleshootingPanel({
  applianceType,
  issues,
  match,
  identifiedIssueId,
  guide,
  outcome,
  onConfirmSuggestion,
  onRejectSuggestion,
  onChooseIssue,
  onOutcomeChange,
  onSkip,
  suggestionDismissed,
  awaitingDescription,
}: TroubleshootingPanelProps) {
  const identifiedLabel = getIssueLabel(applianceType, identifiedIssueId);
  const choosableIssues = issues.filter((issue) => issue.id !== "other").slice(0, 6);

  // ---- 1. An issue is identified: show ITS guide, never another one's --------
  if (identifiedIssueId && identifiedLabel) {
    return (
      <section
        aria-label={`Troubleshooting for ${identifiedLabel}`}
        className="mt-5 rounded-2xl border border-line bg-surface p-4 sm:p-5"
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-brand-ink" aria-hidden="true" />
              Troubleshooting
            </p>
            <h3 className="mt-1 font-display text-sm font-semibold text-ink">
              Preliminary checks for: {identifiedLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-line bg-soft px-3 text-xs font-semibold text-ink/70 transition duration-200 hover:bg-brand-soft"
          >
            Skip troubleshooting
          </button>
        </header>

        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <ShieldCheck
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-ink"
            aria-hidden="true"
          />
          {TROUBLESHOOTING_DISCLAIMER}
        </p>

        {guide?.length ? (
          <ol className="mt-4 space-y-3">
            {guide.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 rounded-xl border border-line bg-soft/60 px-3.5 py-3 text-xs leading-relaxed text-muted">
            {NO_GUIDE_MESSAGE}
          </p>
        )}
        {/* ---- Outcome: optional, and only ever what the customer reports ---- */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink">
            After trying these, what happened?{" "}
            <span className="font-normal text-muted">(optional)</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <OutcomeButton
              active={outcome === "resolved"}
              onClick={() => onOutcomeChange("resolved")}
              label="Yes, it worked"
            />
            <OutcomeButton
              active={outcome === "unresolved"}
              onClick={() => onOutcomeChange("unresolved")}
              label="No, the problem remains"
            />
            <OutcomeButton
              active={outcome === "skipped"}
              onClick={() => onOutcomeChange("skipped")}
              label="Skip troubleshooting"
            />
          </div>

          {outcome === "resolved" && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-signal-soft/60 px-3 py-2.5 text-xs leading-relaxed text-signal-ink">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Thanks — recorded as resolved by you. That is your report, not a
              verified repair, and nothing is closed on your appliance. You can
              still submit this request if you would like a technician to check it.
            </p>
          )}
          {outcome === "unresolved" && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn-soft/60 px-3 py-2.5 text-xs leading-relaxed text-warn-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Noted — the problem remains. Continue to the next step and a
              qualified technician will take it from here.
            </p>
          )}
          {outcome === "skipped" && (
            <p className="mt-3 rounded-xl bg-soft/70 px-3 py-2.5 text-xs leading-relaxed text-muted">
              Troubleshooting skipped — no outcome is required. Continue whenever
              you are ready.
            </p>
          )}
        </div>
      </section>
    );
  }

  // ---- 2. A supported issue was recognised: ask before showing anything -----
  if (!awaitingDescription && !suggestionDismissed && match.kind === "match") {
    const label = getIssueLabel(applianceType, match.issueId);
    if (label) {
      return (
        <section
          aria-label="Confirm the detected problem"
          className="mt-5 rounded-2xl border border-brand-200 bg-brand-soft/60 p-4 sm:p-5"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-ink">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Possible match
          </p>
          <p className="mt-2 text-sm text-ink">
            The problem may be: <span className="font-semibold">{label}</span>. Is this
            correct?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            We recognised “{match.matchedPhrase}” in your description. Nothing is assumed
            — your description stays exactly as you wrote it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onConfirmSuggestion(match.issueId)}
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600"
            >
              Yes, this is correct
            </button>
            <button
              type="button"
              onClick={onRejectSuggestion}
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-xs font-semibold text-ink/75 transition duration-200 hover:bg-soft"
            >
              No, choose an issue
            </button>
          </div>
        </section>
      );
    }
  }

  // ---- 3. Several equally specific issues: the customer chooses -------------
  if (!awaitingDescription && !suggestionDismissed && match.kind === "ambiguous") {
    return (
      <section
        aria-label="Choose the problem"
        className="mt-5 rounded-2xl border border-line bg-surface p-4 sm:p-5"
      >
        <p className="text-sm font-medium text-ink">
          Your description could match more than one problem. Which is closest?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {match.candidates.map((candidate) => (
            <IssueChip
              key={candidate.issueId}
              label={getIssueLabel(applianceType, candidate.issueId) ?? candidate.issueId}
              onClick={() => onChooseIssue(candidate.issueId)}
            />
          ))}
        </div>
        <ContinueWithout onClick={onSkip} />
      </section>
    );
  }

  // ---- 4. Nothing identified (yet): offer the list, never a guess ----------
  return (
    <section
      aria-label="Troubleshooting unavailable"
      className="mt-5 rounded-2xl border border-line bg-soft/50 p-4 sm:p-5"
    >
      {!awaitingDescription && (
        <p className="text-xs leading-relaxed text-muted">
          {suggestionDismissed
            ? "Pick the closest issue from the list above, or continue without troubleshooting."
            : "We couldn't identify the exact problem from your description. Please select the closest issue from the list, or continue without troubleshooting — your request can still be submitted and a technician will diagnose it on site."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {choosableIssues.map((issue) => (
          <IssueChip
            key={issue.id}
            label={issue.label}
            onClick={() => onChooseIssue(issue.id)}
          />
        ))}
      </div>
      <ContinueWithout onClick={onSkip} />
    </section>
  );
}

function ContinueWithout({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex min-h-[36px] cursor-pointer items-center text-xs font-semibold text-brand-ink underline-offset-2 hover:underline"
    >
      Continue without troubleshooting
    </button>
  );
}

function OutcomeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border px-3.5 text-xs font-semibold transition duration-200 ${
        active
          ? "border-brand-300 bg-brand-soft text-brand-ink"
          : "border-line bg-surface text-ink/75 hover:bg-soft"
      }`}
    >
      {label}
    </button>
  );
}

function IssueChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] cursor-pointer items-center rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink/80 transition duration-200 hover:border-brand-300 hover:bg-brand-soft"
    >
      {label}
    </button>
  );
}
