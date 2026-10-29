"use client";

import { ChevronDown } from "lucide-react";

/**
 * One collapsible group of a long form.
 *
 * Collapsing is a *reading* aid, never a way to hide work: every section starts
 * open, and both the submit button and the form's own invalid handler re-expand
 * everything before validation runs (see `RequestRepairWizard`). That matters —
 * a browser cannot focus or scroll to an invalid `required` control inside a
 * collapsed container, so it abandons the submit with no message at all and the
 * form silently does nothing. Staying open on approach removes that failure mode
 * entirely rather than hoping the customer re-expands the right section.
 *
 * Controlled by the parent so the form can open everything at once. The header
 * is a real `<button>` with `aria-expanded` / `aria-controls`, and the panel is
 * a labelled `region`, so a screen reader can still reach collapsed content.
 */
export default function CollapsibleSection({
  id,
  step,
  title,
  hint,
  open,
  onToggle,
  className,
  children,
}: {
  /** Also the DOM id of the panel, for `aria-controls`. */
  id: string;
  /** Order number shown in the badge. */
  step: number;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  /** Extra classes on the outer card — e.g. `xl:hidden` to drop it on desktop. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-line/90 bg-surface shadow-[0_2px_8px_rgba(16,38,74,0.06)] ${
        className ?? ""
      }`}
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition duration-200 hover:bg-soft/70 sm:px-5"
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
              open ? "bg-brand-500 text-white" : "bg-soft text-muted"
            }`}
          >
            {step}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block font-display text-[15px] font-semibold text-ink">
              {title}
            </span>
            {hint && (
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {hint}
              </span>
            )}
          </span>

          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-muted/80 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </h2>

      <div id={id} role="region" aria-label={title} hidden={!open} className="border-t border-line/80 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </div>
    </section>
  );
}
