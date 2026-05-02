---
name: frontend-design
description: Legacy UI guidance document. The canonical agent-facing UI skill now lives at skills/ui/SKILL.md.
---

This document now serves as a human-readable companion to the canonical agent-facing skill at [skills/ui/SKILL.md](../skills/ui/SKILL.md).

Agents should inspect the available skills under `skills/**` and choose the relevant one or ones for the task. For GMLoop UI work, that skill is currently [skills/ui/SKILL.md](../skills/ui/SKILL.md). This file provides supporting rationale and broader UI guidance.

## Canonical Skill

- Canonical agent skill: [skills/ui/SKILL.md](../skills/ui/SKILL.md)
- Copilot bridge: [.github/copilot-instructions.md](../.github/copilot-instructions.md)
- Gemini bridge: [GEMINI.md](../GEMINI.md)

## GMLoop UI Contract

The GMLoop UI uses:

- Lit
- TypeScript
- light-DOM rendering only

All component work in `src/ui/**` should follow the repository light-DOM base class at [light-dom-lit-element.ts](/Users/henrykirk/GMLoop/src/ui/src/app/components/light-dom-lit-element.ts:1).

## 1. Purpose

Use this skill when the user asks for:

- A web page, application, frontend component, or dashboard
- Styling, visual refinement, or enhancement of an existing UI

Deliver working code that is:

- Production-grade and maintainable
- Cohesive in visual direction
- Responsive across screen sizes
- Accessible and keyboard-usable
- Refined enough to avoid generic, template-like output
- Idiomatic for the framework being used, especially Lit with light-DOM rendering

## 2. Working Approach

Before coding:

1. Understand the product purpose, user, and constraints.
2. Define the information architecture.
3. Choose a clear visual direction.
4. Decide the responsive behavior.
5. Identify accessibility and interaction requirements.

Then implement the UI with:

- Real working code
- Deliberate visual choices
- Clean component structure
- Minimal, purposeful motion
- Framework-native patterns instead of legacy or workaround patterns

## 3. Core Design Principles

### 3.1 Intentionality

Commit to a clear concept. Bold maximalism and refined minimalism are both acceptable if the execution is coherent.

### 3.2 Typography

- Choose readable fonts with character.
- Avoid generic defaults only when the product needs a stronger visual identity; preserve established typography when the existing UI or design system already depends on it.
- Use type scale, weight, spacing, and line length intentionally.
- Prefer tabular numbers when users compare values.

### 3.3 Color and Theme

- Use a cohesive palette with a dominant direction and controlled accents.
- Define colors through CSS variables or equivalent tokens.
- Avoid timid, evenly distributed palettes with no hierarchy.
- Support both readability and state clarity in all themes.

### 3.4 Layout and Rhythm

- Use a consistent spacing system.
- Keep alignment intentional to a grid, baseline, edge, or optical center.
- Maintain predictable content widths by breakpoint.
- Keep long-form text at a readable measure.
- Respect safe areas, OS chrome, and fixed UI overlap.

### 3.5 Motion

- Use animation only when it improves understanding or delight.
- Keep micro-interactions around 150 to 300 ms with platform-appropriate easing.
- Avoid gratuitous motion, sluggish transitions, and layout-jitter effects.

## 4. Visual System Rules

### 4.1 Icons and Visual Assets

- Use vector-based icons and assets.
- Do not use emoji as structural UI icons.
- Keep icon sizing consistent through design tokens.
- Keep stroke widths consistent within the same visual layer.
- Do not mix outline and filled styles at the same hierarchy level without intent.
- Use official brand assets when brand marks appear.
- Maintain adequate icon contrast in all themes.

### 4.2 Surfaces and Contrast

- Separate cards and surfaces clearly from the background.
- Ensure text contrast remains readable in both light and dark themes.
- Keep borders and dividers visible in every theme.
- Make hover, active, focus, and disabled states clearly distinguishable.
- Set `color-scheme` correctly so browser UI such as scrollbars remains legible.

### 4.3 Interaction Stability

- Provide clear pressed, hovered, and focused states.
- Do not use interaction effects that shift layout bounds or surrounding content.
- Keep interactive targets large enough to feel forgiving.
- Remove dead zones inside controls.

## 5. Interaction Standards

### 5.1 Keyboard and Focus

- All important flows must be keyboard-operable.
- Use visible focus indicators, preferably with `:focus-visible`.
- Use `:focus-within` for grouped controls when helpful.
- Manage focus explicitly for modals, drawers, menus, and other composite patterns.
- Return focus appropriately after dismissing temporary UI.

### 5.2 Navigation and State

- Use real links for navigation so browser behaviors continue to work.
- Deep-link meaningful UI state such as filters, tabs, pagination, and expanded panels when the app is browser-routed or the state should be shareable.
- Preserve scroll position on back and forward navigation when the UI owns navigation history.
- Persist relevant state in the URL when sharing or refresh should preserve context.

### 5.3 Touch and Pointer Behavior

- Keep minimum interactive targets at least 44 by 44 px on mobile.
- Use `touch-action: manipulation` when appropriate to prevent accidental double-tap zoom on controls.
- Set `-webkit-tap-highlight-color` intentionally.
- Avoid nested or conflicting gestures.
- Disable text selection and apply `inert` as needed during drag interactions.

### 5.4 Async and Feedback

- Loading buttons must keep their original label and add a loading indicator.
- Add a short display delay and minimum visible duration for transient loading states to avoid flicker.
- Use optimistic updates when success is likely, then reconcile on response.
- Confirm destructive actions or provide a clear undo path.
- Announce async updates with polite live regions when needed.
- When a Lit state change must be reflected in the DOM before focus, measurement, or scrolling, wait for `updateComplete`.

## 6. Accessibility Requirements

- Prefer semantic HTML before ARIA.
- Give every interactive control an accessible name.
- Hide decorative content from assistive technology.
- Ensure screen-reader focus order matches visual order.
- Do not rely on hover-only interactions.
- Do not rely on color alone for status communication.
- Use accessible color palettes and strong contrast.
- Add a skip link and maintain proper heading hierarchy.
- Ensure custom interactive elements delegate or manage focus appropriately.
- Verify accessible output in the accessibility tree, not just visually.
- For custom interactive Lit components, implement the correct role, keyboard behavior, and `aria-*` state mapping instead of relying on click handlers alone.
- Respect author ownership of global attributes such as `role`, `tabindex`, `hidden`, and `aria-*`; do not overwrite values the page author has already set.

## 7. Content and Information Design

### 7.1 Content Structure

- Prefer inline help over tooltip-only explanations.
- Avoid walls of text by breaking content into smaller sections.
- Group related controls and concepts together.
- Ensure every screen has a next step, recovery path, or call to action.
- Design empty, sparse, dense, and error states intentionally.

### 7.2 Content Quality

- Use accurate page titles.
- Shield brand names, code tokens, and technical identifiers with `translate="no"` when needed.
- Make layouts resilient to short, average, and very long content.
- Format dates, times, numbers, and currencies for the user’s locale.
- Prefer language detection over geographic assumptions.

### 7.3 Helpful Empty States

Empty states should explain what is missing and what the user should do next.

- Weak: "No deployments yet."
- Better: "You have no deployments. Deploy your project to see it here."

## 8. Forms

### 8.1 Form Behavior

- When a single primary text input is present, Enter should submit.
- In textareas, Enter inserts a new line and `Cmd/Ctrl+Enter` submits.
- Keep submit enabled until submission begins, then disable while the request is in flight.
- Include idempotency protection for repeated submits when relevant.
- Allow incomplete submission so validation can teach the user what to fix.

### 8.2 Labels and Inputs

- Every control needs a label or equivalent accessible association.
- Clicking a label should focus or toggle its control.
- Use the correct `type`, `inputmode`, `name`, and `autocomplete`.
- Use meaningful placeholder examples, and end placeholders with an ellipsis when they imply further input.
- Keep mobile input font size large enough to prevent iOS zoom.
- Do not block paste.
- Ensure password managers and one-time-code flows work correctly.

### 8.3 Validation and Errors

- Do not block typing aggressively, even for constrained fields.
- Trim input only where input methods commonly introduce accidental trailing whitespace.
- Show validation errors near the relevant fields.
- On failed submit, focus the first error.
- Warn before navigation if unsaved changes would be lost.

## 9. Code and Component Quality

- Break UI into reusable components with clear responsibilities.
- Keep component structure consistent and readable.
- Prefer semantic elements such as `button`, `nav`, `header`, `main`, and `footer`.
- Use strict TypeScript types and avoid `any`.
- Favor CSS layout systems over measuring layout in JavaScript.
- Avoid unnecessary complexity in state, styling, or animation.

### 9.1 Lit Component API Design

- Use TypeScript decorators for Lit component declarations and reactive fields.
- Use `@property()` for public API and `@state()` for internal reactive state.
- Do not expose internal implementation details as public reactive properties.
- Provide default values for every reactive property to avoid undefined template behavior.
- Reflect properties sparingly.
- Reflect only when the value must participate in CSS selectors, host state, or meaningful HTML serialization.
- Do not reflect objects, arrays, or frequently changing values.
- Accept primitive public configuration through attributes and properties when practical.
- Keep primitive public attributes and properties in sync when the component API exposes both forms.
- Accept rich data such as objects and arrays through properties rather than attributes.
- Prefer clear public API names and stable event contracts over implicit coupling.
- Do not self-apply CSS classes to express component state; represent state with attributes and host selectors instead.

### 9.2 Lit Rendering Rules

- Keep `render()` pure.
- Do not mutate state, dispatch events, log, access storage, or perform async work in `render()`.
- Use `nothing` for intentionally empty conditional content instead of empty strings, `null`, or `undefined`.
- Use `repeat()` with stable keys for dynamic lists that can reorder, insert, or remove items.
- Use `cache()` for conditional subtrees when preserving DOM state or avoiding expensive subtree recreation matters.
- Keep expensive computation out of templates.
- Compute derived state before render rather than rebuilding it repeatedly inside template expressions.
- Use light DOM for Lit components in this codebase. Do not introduce shadow DOM. Compose children directly in the rendered DOM structure instead of relying on shadow-root slotting patterns.

### 9.3 Lit Lifecycle Rules

- Follow correct `super` call order in lifecycle methods.
- In `connectedCallback()`, call `super` first.
- In `disconnectedCallback()`, clean up your own resources before calling `super`.
- Use `firstUpdated()` for DOM-dependent work such as measurement, focus, observer setup, and element wiring.
- Use `willUpdate()` for derived state that depends on reactive inputs.
- Use `updated()` for post-render side effects only.
- Treat updates triggered from `updated()` as exceptional because they cause an extra render cycle.
- Use `updateComplete` before reading DOM that depends on a recent state change.
- Prefer `@query` and similar Lit helpers for internal element references instead of repetitive untyped selectors.

### 9.4 Lit Events and Cleanup

- Custom events emitted from Lit components should usually use `bubbles: true`. Do not add `composed: true` unless a concrete integration requirement outside this light-DOM architecture demands it.
- Name custom events in lowercase kebab-case.
- Use past tense for state-change notifications such as `value-changed` or `item-selected`.
- Avoid names that collide with native events unless you intentionally mirror native semantics.
- Document public custom events where the component API matters.
- Dispatch events for internal activity or completed state changes, not merely because host code assigned a property.
- Avoid emitting events for downward data flow because it is redundant and can create binding loops.
- Clean up listeners, observers, subscriptions, timers, and other external resources in `disconnectedCallback()`.
- If a listener must be removable, keep a stable function reference rather than recreating it inline.

### 9.5 Lit Styling Rules

- Use `static styles` for component styles.
- Do not place `<style>` tags inside Lit templates.
- In this codebase's light-DOM architecture, style rendered elements and component-owned classes directly instead of introducing shadow-DOM-only selectors such as `:host`.
- Give the rendered root element an explicit default display unless inline behavior is intentionally desired.
- Ensure display rules respect the `hidden` attribute.
- Represent component-owned states consistently through attributes, classes, or host selectors as appropriate for the chosen rendering mode.
- Expose CSS custom properties for supported theming hooks, with sensible defaults.

## 10. Performance Expectations

- Preload only above-the-fold assets that materially affect perceived load.
- Lazy-load non-critical images and content.
- Batch related state updates where possible.
- In Lit, rely on synchronous grouped property sets to coalesce updates into a single render cycle.
- Use memoization patterns only when they solve a real rendering problem.
- When Lit properties hold complex objects or arrays, consider custom `hasChanged` logic if referential churn would otherwise cause redundant updates.
- Lazy-load heavy dependencies only when the relevant UI path is actually needed.
- Prefer framework-native lazy patterns over eager imports for rarely used heavy features.
- Use `willUpdate()` or memoized computation for expensive derived collections instead of recomputing them every render.
- Avoid layout thrash by letting CSS handle sizing, wrapping, and alignment.

## 11. Copywriting Standards

- Use active voice.
- Write in second person.
- Keep nouns and terminology consistent.
- Use clear, action-oriented labels.
- Prefer concise language over filler.
- Use numerals for counts.
- Separate numbers and units with a space.
- Keep currency formatting consistent within the same context.
- Default to positive, problem-solving language.
- Error messages should explain both the problem and the next action.
- In product UI, headings and buttons use Title Case. On marketing pages, use sentence case.

Examples:

- Instead of "The CLI will be installed," write "Install the CLI."
- Instead of "Continue," write "Save API Key."
- Instead of "Invalid API key," write "Your API key is incorrect or expired. Generate a new key in your account settings."

## 12. Review Checklist

After implementation:

1. Run a responsive review across mobile, laptop, and ultra-wide layouts.
2. Run an accessibility review for keyboard, labels, focus, semantics, and contrast.
3. Run a readability and hierarchy review for scanning, grouping, and visual rhythm.
4. Fix the highest-impact issues before finalizing.

## 13. References

- [Lit Documentation](https://lit.dev/docs/)
- [artmsilva/lit-best-practices rules](https://github.com/artmsilva/lit-best-practices/tree/main/rules)
- [web.dev Custom Elements Best Practices](https://web.dev/articles/custom-elements-best-practices)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/)
- [MDN: `inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)
- [MDN: Safe area env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- [APCA Contrast](https://apcacontrast.com/)
- [WCAG Contrast Checker Guidance](https://webaim.org/resources/contrastchecker/)
