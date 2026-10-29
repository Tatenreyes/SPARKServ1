/**
 * The phone shape of a statistic row: two columns, equal tiles.
 *
 * Two is the number of half-width tiles a 360px screen can carry without either
 * one looking empty, and it is the shape that keeps four figures on one
 * screenful. Any count that does not divide by two simply leaves its last row
 * half full — which is why the grid is `grid-cols-2` rather than a two-column
 * flex, so the remaining tile stays the same width as the ones above it instead
 * of stretching.
 *
 * `sm:hidden` is the whole hand-off: this component renders only on a phone,
 * and `DashboardStatGroup` renders the desktop cards from `sm` up. Keeping both
 * halves in the group means the two presentations are guaranteed to be built
 * from one array of the same numbers.
 */
export default function MobileStatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:hidden">{children}</div>;
}