---
name: animation
description: "Design and implement purposeful web animation for React and Next.js interfaces. Use for page transitions, entrance reveals, hover and press states, loading motion, scroll-linked effects, microinteractions, GSAP timelines, Framer Motion or Motion components, Lottie/Rive assets, and animation reviews. Prioritize accessibility, reduced motion, performance, responsive behavior, and visual verification."
argument-hint: "[interaction or component] [context]"
user-invocable: true
---

# Web Animation

Create animation that clarifies state, hierarchy, and feedback without competing with the task. This skill is for React and Next.js UI as well as CSS animation and motion-system reviews.

## When to Use

- Add or review page transitions and entrance sequences
- Animate hover, focus, pressed, selected, expanded, loading, or success states
- Build scroll reveals or scroll-linked effects
- Add motion with Framer Motion, Motion, GSAP, Lottie, or Rive
- Diagnose jank, layout shifts, animation bugs, or inaccessible motion
- Establish reusable timing, easing, and choreography rules

## Workflow

### 1. Inspect the local surface

1. Find the component that owns the state or interaction. Follow forwarded props and event handlers until the code that decides visibility, layout, or state.
2. Check the existing design tokens, CSS utilities, motion helpers, and installed packages before introducing a new dependency.
3. Identify the rendering boundary. In Next.js, keep animation-only browser logic in a Client Component and avoid moving data fetching or static layout into the client without a reason.
4. Record the states that need motion: initial, entering, active, exiting, disabled, error, success, and loading where applicable.

### 2. Choose the smallest appropriate technique

| Need | Preferred technique |
|------|---------------------|
| Hover, focus, press, color, opacity, or simple reveal | CSS transitions/keyframes |
| React presence, variants, layout transitions, or coordinated UI states | Existing Framer Motion/Motion pattern |
| Complex imperative sequence or timeline | GSAP, only when a timeline is genuinely needed |
| Authored illustration or brand animation | Existing Lottie or Rive asset |
| Continuous scroll-linked movement | CSS scroll-driven animation when supported; otherwise a measured, throttled controller |

Do not combine animation libraries in one component unless an existing boundary requires it. Do not add animation to every element; choose one focal movement and supporting motion.

### 3. Design the motion

1. Define the user cause and visible result in one sentence, for example: "Selecting a request reveals its details so the user understands the new context."
2. Animate `transform` and `opacity` where possible. Avoid animating layout properties such as `width`, `height`, `top`, `left`, `margin`, or `box-shadow` when a composited alternative works.
3. Use the shortest duration that communicates the change. Typical starting points are 120-180ms for microinteractions, 200-350ms for component transitions, and 400-700ms for a deliberate page-level reveal.
4. Use easing that matches intent: ease-out for entering, ease-in for leaving, and a restrained spring for direct manipulation. Avoid perpetual motion unless it communicates activity or status.
5. Stagger related items sparingly. Keep the first meaningful content visible quickly and avoid delaying interaction behind a decorative sequence.
6. Preserve stable dimensions so animation does not cause layout shifts, overflow, or text collisions at mobile widths.

### 4. Implement accessibly

- Respect `prefers-reduced-motion: reduce` in CSS and JavaScript. Replace travel and parallax with opacity or an immediate state change; do not merely slow a motion that remains distracting.
- Ensure keyboard focus, `:focus-visible`, hover, touch, and reduced-motion states all remain usable.
- Never hide essential content only because an animation failed to run.
- Do not use flashing or rapid repetitive motion. Avoid autoplaying motion that cannot be paused when it is not essential.
- Keep loading indicators informative and ensure success/error feedback is available to screen readers through the existing semantic status pattern.
- Avoid animating height from `0` when it causes content to be inaccessible or creates a large layout jump; use an established disclosure pattern when available.

### 5. Validate the result

1. Run the narrowest available typecheck, lint, or component test for the changed slice.
2. Exercise the interaction with keyboard and pointer input, including enter, exit, repeat, and interrupted transitions.
3. Check mobile and desktop widths for clipping, overlap, layout shift, and touch-target stability.
4. Verify reduced motion with browser emulation or an OS setting. Confirm content and state changes still work without travel animation.
5. Inspect performance for long lists, scroll effects, and repeated renders. Remove unnecessary listeners, timelines, and animation state.
6. Capture a screenshot or short recording when visual timing or composition is part of the acceptance criteria.

## Implementation Patterns

### CSS state transition

```css
.control {
  transform: translateY(0);
  transition: transform 160ms ease-out, background-color 160ms ease-out;
}

.control:hover,
.control:focus-visible {
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .control {
    transition: none;
  }
}
```

### React presence

Use the motion library already used by neighboring components. Keep variants close to the component and make the non-animated state the source of truth.

```tsx
const variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};
```

Pair this with a reduced-motion preference so the same state transition becomes immediate rather than disappearing.

## Review Checklist

- The animation has a clear user purpose.
- The owning component and state boundary are correct.
- The chosen technique matches the complexity and existing repository patterns.
- Transform/opacity are preferred over layout-affecting properties.
- Enter, exit, interruption, and repeated interaction behave correctly.
- Keyboard, focus, touch, and reduced-motion behavior are usable.
- No content is hidden or made dependent on animation completion.
- No layout shift, clipping, overlap, or avoidable long-task regression appears on mobile or desktop.
- A focused validation command and visual check have been completed.

## Scope Boundaries

This skill does not replace product interaction design, video editing, 3D scene development, or asset creation. For those tasks, use the relevant design, frontend, or media workflow and apply this skill only to the interface motion layer.
