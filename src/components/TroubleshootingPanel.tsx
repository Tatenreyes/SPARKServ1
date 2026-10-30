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
 *
 * Two rules keep it from becoming a second form:
 *   * it owns **no issue list** — the chips in the wizard are the one place a fault is
 *     chosen, so the catalogue is never rendered twice, and
 *   * every state speaks through `AssistantBubble`, so the panel has one voice.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Lightbulb, ShieldCheck } from "lucide-react";
import { getIssueLabel } from "@/lib/appliance-issues";
import type { IssueMatchResult, TroubleshootingOutcome } from "@/lib/issue-matching";
import {
  NO_GUIDE_MESSAGE,
  TROUBLESHOOTING_DISCLAIMER,
  type TroubleshootingStep,
} from "@/lib/troubleshooting";

export interface TroubleshootingPanelProps {
  applianceType: string;
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

  /**
   * Which checks the customer has ticked off.
   *
   * Deliberately local and deliberately not persisted: it is reading progress, not a
   * record of anything. It resets when the identified issue changes, because a different
   * fault means a different checklist — and carrying "2 of 3 done" across that boundary
   * would be a lie about work the customer never did.
   */
  const [doneSteps, setDoneSteps] = useState<string[]>([]);

  useEffect(() => {
    setDoneSteps([]);
  }, [identifiedIssueId]);

  function toggleStep(title: string) {
    setDoneSteps((current) =>
      current.includes(title) ? current.filter((item) => item !== title) : [...current, title]
    );
  }

  // ---- 1. An issue is identified: show ITS guide, never another one's --------
  if (identifiedIssueId && identifiedLabel) {
    const stepCount = guide?.length ?? 0;
    const doneCount = guide ? doneSteps.filter((title) => guide.some((step) => step.title === title)).length : 0;

    return (
      <AssistantBubble label={`Troubleshooting for ${identifiedLabel}`} onSkip={onSkip}>
        <p className="text-sm leading-relaxed text-ink">
          That sounds like{" "}
          <span className="font-semibold">{identifiedLabel}</span>. Most faults like this
          are one of the checks below — worth a minute before you book a visit.
        </p>

        {stepCount > 0 && (
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {doneCount} of {stepCount} done
          </p>
        )}

        {guide?.length ? (
          <ol className="mt-3 space-y-3">
            {guide.map((step, index) => {
              const done = doneSteps.includes(step.title);
              return (
                <li key={step.title} className="flex gap-3">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      done ? "bg-signal-500 text-white" : "bg-brand-soft text-brand-ink"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold ${done ? "text-muted line-through" : "text-ink"}`}>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleStep(step.title)}
                    aria-pressed={done}
                    aria-label={`${done ? "Undo" : "Mark"} step ${index + 1}: ${step.title}`}
                    className={`inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border px-2.5 text-[11px] font-semibold transition duration-200 ${
                      done
                        ? "border-signal-500/30 bg-signal-soft/60 text-signal-ink"
                        : "border-line bg-surface text-ink/70 hover:bg-soft"
                    }`}
                  >
                    {done ? "Done" : "Mark done"}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-4 rounded-xl border border-line bg-soft/60 px-3.5 py-3 text-xs leading-relaxed text-muted">
            {NO_GUIDE_MESSAGE}
          </p>
        )}

        <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <ShieldCheck
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-ink"
            aria-hidden="true"
          />
          {TROUBLESHOOTING_DISCLAIMER}
        </p>
        {/* ---- The one question, inside the same bubble: the assistant asks once, and
            "Skip" stays the header control. Offering the same decision twice made it look
            like two different ones. ---- */}
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink">
            Did that fix it?{" "}
            <span className="font-normal text-muted">(optional, but it helps your technician)</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <OutcomeButton
              active={outcome === "resolved"}
              onClick={() => onOutcomeChange("resolved")}
              label="Yes, it's working"
            />
            <OutcomeButton
              active={outcome === "unresolved"}
              onClick={() => onOutcomeChange("unresolved")}
              label="No, still broken"
            />
          </div>

          {/* No `resolved` note here: a resolved outcome replaces this entire form with its
              own screen (see RequestRepairWizard), so that copy could never render. */}
          {outcome === "unresolved" && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn-soft/60 px-3 py-2.5 text-xs leading-relaxed text-warn-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Noted — the problem remains. Continue below and a qualified technician will
              take it from here, with these checks already ruled out.
            </p>
          )}
          {outcome === "skipped" && (
            <p className="mt-3 rounded-xl bg-soft/70 px-3 py-2.5 text-xs leading-relaxed text-muted">
              Troubleshooting skipped — no outcome is required. Continue whenever you are
              ready.
            </p>
          )}
        </div>
      </AssistantBubble>
    );
  }

  // ---- 2. A supported issue was recognised: ask before showing anything -----
  if (!awaitingDescription && !suggestionDismissed && match.kind === "match") {
    const label = getIssueLabel(applianceType, match.issueId);
    if (label) {
      return (
        <AssistantBubble label="Confirm the detected problem">
          <p className="text-sm leading-relaxed text-ink">
            That sounds like <span className="font-semibold">{label}</span>. Is that right?
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
              Yes, that&apos;s it
            </button>
            <button
              type="button"
              onClick={onRejectSuggestion}
              className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-xs font-semibold text-ink/75 transition duration-200 hover:bg-soft"
            >
              No, let me pick
            </button>
          </div>
        </AssistantBubble>
      );
    }
  }

  // ---- 3. Several equally specific issues: the customer chooses -------------
  if (!awaitingDescription && !suggestionDismissed && match.kind === "ambiguous") {
    return (
      <AssistantBubble label="Choose the problem">
        <p className="text-sm leading-relaxed text-ink">
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
      </AssistantBubble>
    );
  }

  // ---- 4. Nothing identified: say so once, and point at the chips above -----
  //
  // Nothing at all until the customer has said something. An empty card under an
  // untouched textarea is noise, and the issue chips are already on screen above.
  if (awaitingDescription) return null;

  return (
    <AssistantBubble label="Troubleshooting unavailable">
      <p className="text-xs leading-relaxed text-muted">
        {suggestionDismissed
          ? "No problem — pick the closest issue from the list above and its checks will appear here."
          : "We couldn't identify the exact problem from your description. Pick the closest issue from the list above and its checks will appear here — or continue without troubleshooting: your request can still be submitted, and a technician will diagnose it on site."}
      </p>
      <ContinueWithout onClick={onSkip} />
    </AssistantBubble>
  );
}

/**
 * The assistant's identity row and its bubble.
 *
 * ONE definition for every state, so the panel speaks with a single voice: whichever
 * branch renders, the customer sees the same avatar, the same name, and the reply in the
 * same shell. A bubble carries all of its content at once — never one turn at a time
 * (see branch 1, where every check is visible on arrival).
 */
function AssistantBubble({
  label,
  onSkip,
  children,
}: {
  /** What this bubble is, for assistive technology. */
  label: string;
  /** Only where the bubble is long enough that leaving it needs its own control. */
  onSkip?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-5">
      {/* The assistant's identity: this is a conversation, not another form section. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-xs font-semibold text-ink">SPARKServ assistant</p>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-line bg-soft px-3 text-xs font-semibold text-ink/70 transition duration-200 hover:bg-brand-soft"
          >
            Skip troubleshooting
          </button>
        )}
      </div>

      <div
        aria-label={label}
        className="mt-2 rounded-2xl rounded-tl-sm border border-line bg-surface p-4 sm:p-5"
      >
        {children}
      </div>
    </div>
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
