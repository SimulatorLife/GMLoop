---
name: ui
description: Use this skill when building or modifying the GMLoop UI under src/ui. The UI stack is Lit + TypeScript with light-DOM rendering only.
---

# UI Skill

## Purpose

Use this skill when an agent is:

- editing files under `src/ui/**`
- creating new Lit UI components for this repository
- changing UI behavior, layout, accessibility, styling, or interaction patterns in the web app

Deliver working code that is:

- production-grade and maintainable
- cohesive in visual direction
- responsive across screen sizes
- accessible and keyboard-usable
- refined enough to avoid generic, template-like output
- idiomatic for Lit with light-DOM rendering

This skill is specific to GMLoop's UI architecture. It is not a generic frontend style guide.

## Stack Contract

The UI stack for this repository is:

- Lit
- TypeScript
- light DOM rendering only

All Lit UI components in this repository must follow the existing light-DOM pattern defined by [light-dom-lit-element.ts](../../../src/ui/src/app/components/light-dom-lit-element.ts).

## Working Approach

Before coding:

1. Understand the product purpose, user, and constraints.
2. Define the information architecture.
3. Choose a clear visual direction.
4. Decide the responsive behavior.
5. Identify accessibility and interaction requirements.

Then implement the UI with:

- real working code
- deliberate visual choices
- clean component structure
- minimal, purposeful motion
- framework-native patterns instead of legacy or workaround patterns

## Core Design Principles

### Intentionality

- Commit to a clear concept.
- Favor coherent execution over generic defaults.

### Typography

- Choose readable fonts with character.
- Avoid generic defaults only when the product needs a stronger visual identity; preserve established typography when the existing UI or design system already depends on it.
- Use type scale, weight, spacing, and line length intentionally.
- Prefer tabular numbers when users compare values.

### Color and Theme

- Use a cohesive palette with a dominant direction and controlled accents.
- Define colors through CSS variables or equivalent tokens.
- Avoid timid, evenly distributed palettes with no hierarchy.
- Support both readability and state clarity in all themes.

### Layout and Rhythm

- Use a consistent spacing system.
- Keep alignment intentional to a grid, baseline, edge, or optical center.
- Maintain predictable content widths by breakpoint.
- Keep long-form text at a readable measure.
- Respect safe areas, browser chrome, and fixed UI overlap.

### Motion

- Use animation only when it improves understanding or delight.
- Keep micro-interactions around 150 to 300 ms with appropriate easing.
- Avoid gratuitous motion, sluggish transitions, and layout-jitter effects.

## Visual System Rules

### Icons and Visual Assets

- Use vector-based icons and assets.
- Do not use emoji as structural UI icons.
- Keep icon sizing consistent through design tokens.
- Keep stroke widths consistent within the same visual layer.
- Do not mix outline and filled styles at the same hierarchy level without intent.
- Use official brand assets when brand marks appear.
- Maintain adequate icon contrast in all themes.

### Surfaces and Contrast

- Separate cards and surfaces clearly from the background.
- Ensure text contrast remains readable in both light and dark themes.
- Keep borders and dividers visible in every theme.
- Make hover, active, focus, and disabled states clearly distinguishable.
- Set `color-scheme` correctly so browser UI such as scrollbars remains legible.

### Interaction Stability

- Provide clear pressed, hovered, and focused states.
- Do not use interaction effects that shift layout bounds or surrounding content.
- Keep interactive targets large enough to feel forgiving.
- Remove dead zones inside controls.

## Interaction Standards

### Keyboard and Focus

- All important flows must be keyboard-operable.
- Use visible focus styles, preferably with `:focus-visible`.
- Use `:focus-within` for grouped controls when helpful.
- Manage focus explicitly for modals, drawers, menus, and other composite patterns.
- Return focus appropriately after dismissing temporary UI.

### Navigation and State

- Use real links for navigation so browser behaviors continue to work.
- Deep-link meaningful UI state such as filters, tabs, pagination, and expanded panels when the app is browser-routed or the state should be shareable.
- Preserve scroll position on back and forward navigation when the UI owns navigation history.
- Persist relevant state in the URL when sharing or refresh should preserve context.

### Touch and Pointer Behavior

- Keep minimum interactive targets at least 44 by 44 px on mobile.
- Use `touch-action: manipulation` when appropriate to prevent accidental double-tap zoom on controls.
- Set `-webkit-tap-highlight-color` intentionally.
- Avoid nested or conflicting gestures.
- Disable text selection and apply `inert` as needed during drag interactions.

### Async and Feedback

- Loading buttons must keep their original label and add a loading indicator.
- Add a short display delay and minimum visible duration for transient loading states to avoid flicker.
- Use optimistic updates when success is likely, then reconcile on response.
- Confirm destructive actions or provide a clear undo path.
- Announce async updates with polite live regions when needed.
- When a Lit state change must be reflected in the DOM before focus, measurement, or scrolling, wait for `updateComplete`.

## Accessibility Requirements

- Use semantic HTML before ARIA.
- Give every interactive control an accessible name.
- Hide decorative content from assistive technology.
- Ensure screen-reader focus order matches visual order.
- Do not rely on hover-only interactions.
- Do not rely on color alone for status communication.
- Use accessible color palettes and strong contrast.
- Add a skip link and maintain proper heading hierarchy where the page structure calls for it.
- Ensure custom interactive elements delegate or manage focus appropriately.
- Verify accessible output in the accessibility tree, not just visually.
- For custom interactive Lit components, implement the correct role, keyboard behavior, and `aria-*` state mapping instead of relying on click handlers alone.
- Respect author ownership of global attributes such as `role`, `tabindex`, `hidden`, and `aria-*`; do not overwrite values the page author has already set.

## Content and Information Design

### Content Structure

- Prefer inline help over tooltip-only explanations.
- Avoid walls of text by breaking content into smaller sections.
- Group related controls and concepts together.
- Ensure every screen has a next step, recovery path, or call to action.
- Design empty, sparse, dense, and error states intentionally.

### Content Quality

- Use accurate page titles.
- Shield brand names, code tokens, and technical identifiers with `translate="no"` when needed.
- Make layouts resilient to short, average, and very long content.
- Format dates, times, numbers, and currencies for the user's locale.
- Prefer language detection over geographic assumptions.

### Helpful Empty States

- Empty states should explain what is missing and what the user should do next.
- Prefer actionable empty-state copy over short dead-end notices.

## Forms

### Form Behavior

- When a single primary text input is present, Enter should submit.
- In textareas, Enter inserts a new line and `Cmd/Ctrl+Enter` submits.
- Keep submit enabled until submission begins, then disable while the request is in flight.
- Include idempotency protection for repeated submits when relevant.
- Allow incomplete submission so validation can teach the user what to fix.

### Labels and Inputs

- Every control needs a label or equivalent accessible association.
- Clicking a label should focus or toggle its control.
- Use the correct `type`, `inputmode`, `name`, and `autocomplete`.
- Use meaningful placeholder examples, and end placeholders with an ellipsis when they imply further input.
- Keep mobile input font size large enough to prevent iOS zoom.
- Do not block paste.
- Ensure password managers and one-time-code flows work correctly.

### Validation and Errors

- Do not block typing aggressively, even for constrained fields.
- Trim input only where input methods commonly introduce accidental trailing whitespace.
- Show validation errors near the relevant fields.
- On failed submit, focus the first error.
- Warn before navigation if unsaved changes would be lost.

## Code and Component Quality

### Required Patterns

- Extend `LightDomLitElement` for Lit UI components in `src/ui/src/app/components/**`.
- Keep `render()` pure. Do not mutate state, dispatch events, log, access storage, or do async work inside `render()`.
- Use semantic HTML before ARIA.
- Keep important flows keyboard operable.
- Use strict TypeScript types. Do not introduce `any` to bypass typing.
- Keep component responsibilities narrow and readable.
- Use light-DOM-friendly styling through rendered elements, class names, and shared stylesheet assets.
- Use typed custom-event detail payloads when an event carries data.
- Use `bubbles: true` for component events that parent components handle.
- Use `updateComplete` before focus, measurement, or scroll work that depends on a recent Lit update.
- Clean up listeners, subscriptions, observers, and timers in `disconnectedCallback()`.
- Preserve existing UI composition patterns and naming conventions already used in `src/ui`.
- Favor CSS layout systems over measuring layout in JavaScript.
- Avoid unnecessary complexity in state, styling, or animation.

### Lit Component API Design

- Use TypeScript decorators for Lit component declarations and reactive fields when the component follows that style.
- Use `@property()` for public API and `@state()` for internal reactive state when decorators are used.
- Do not expose internal implementation details as public reactive properties.
- Provide default values for every reactive property to avoid undefined template behavior.
- Reflect properties sparingly.
- Reflect only when the value must participate in CSS selectors, host state, or meaningful HTML serialization.
- Do not reflect objects, arrays, or frequently changing values.
- Accept primitive public configuration through attributes and properties when practical.
- Keep primitive public attributes and properties in sync when the component API exposes both forms.
- Accept rich data such as objects and arrays through properties rather than attributes.
- Prefer clear public API names and stable event contracts over implicit coupling.
- Do not self-apply CSS classes to express component state when attributes or clearer DOM state markers are more appropriate.

### Lit Rendering Rules

- Use `nothing` for intentionally empty conditional content instead of empty strings, `null`, or `undefined`.
- Use `repeat()` with stable keys for dynamic lists that can reorder, insert, or remove items.
- Use `cache()` for conditional subtrees when preserving DOM state or avoiding expensive subtree recreation matters.
- Keep expensive computation out of templates.
- Compute derived state before render rather than rebuilding it repeatedly inside template expressions.
- Use light DOM for Lit components in this codebase. Do not introduce shadow DOM. Compose children directly in the rendered DOM structure instead of relying on shadow-root slotting patterns.

### Lit Lifecycle Rules

- Follow correct `super` call order in lifecycle methods.
- In `connectedCallback()`, call `super` first.
- In `disconnectedCallback()`, clean up your own resources before calling `super`.
- Use `firstUpdated()` for DOM-dependent work such as measurement, focus, observer setup, and element wiring.
- Use `willUpdate()` for derived state that depends on reactive inputs.
- Use `updated()` for post-render side effects only.
- Treat updates triggered from `updated()` as exceptional because they cause an extra render cycle.
- Prefer `@query` and similar Lit helpers for internal element references instead of repetitive untyped selectors when that pattern is already in use.

### Lit Events and Cleanup

- Custom events emitted from Lit components should usually use `bubbles: true`.
- Do not add `composed: true` unless a concrete integration requirement outside this light-DOM architecture demands it.
- Name custom events in lowercase kebab-case.
- Use past tense for state-change notifications such as `value-changed` or `item-selected`.
- Avoid names that collide with native events unless you intentionally mirror native semantics.
- Document public custom events where the component API matters.
- Dispatch events for internal activity or completed state changes, not merely because host code assigned a property.
- Avoid emitting events for downward data flow because it is redundant and can create binding loops.
- If a listener must be removable, keep a stable function reference rather than recreating it inline.

### Lit Styling Rules

- Use `static styles` for component styles when styles live with the component.
- Do not place `<style>` tags inside Lit templates.
- In this codebase's light-DOM architecture, style rendered elements and component-owned classes directly instead of introducing shadow-DOM-only selectors such as `:host`.
- Give the rendered root element an explicit default display unless inline behavior is intentionally desired.
- Ensure display rules respect the `hidden` attribute.
- Represent component-owned states consistently through attributes, classes, or host selectors as appropriate for the chosen rendering mode.
- Expose CSS custom properties for supported theming hooks, with sensible defaults.

## Performance Expectations

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

## Copywriting Standards

- Use active voice.
- Write in second person when it improves clarity.
- Keep nouns and terminology consistent.
- Use clear, action-oriented labels.
- Prefer concise language over filler.
- Use numerals for counts.
- Separate numbers and units with a space.
- Keep currency formatting consistent within the same context.
- Default to positive, problem-solving language.
- Error messages should explain both the problem and the next action.
- In product UI, headings and buttons use Title Case. On marketing pages, use sentence case.

## Repo-Specific Guidance

- The canonical base class is [light-dom-lit-element.ts](../../../src/ui/src/app/components/light-dom-lit-element.ts).
- The app-shell composition pattern lives in [gm-app-shell.ts](../../../src/ui/src/app/components/gm-app-shell.ts).
- Toolbar interaction and event emission patterns live in [gm-graph-toolbar.ts](../../../src/ui/src/app/components/gm-graph-toolbar.ts).
- Existing custom events currently use `bubbles: true` and may also use `composed: true`; do not add new shadow-DOM-oriented rationale around that. Match the repo's integration needs rather than generic custom-element advice.

## Implementation Checklist

Before finishing a UI change, verify:

1. The component still uses the repository light-DOM architecture.
2. No shadow-DOM-only APIs or selectors were introduced.
3. Keyboard, focus, and accessible naming still work.
4. Loading, empty, and error states are intentional where relevant.
5. The component API and event payload types are explicit and typed.
6. The change matches the existing `src/ui` composition and state-management patterns.
7. Performance remains reasonable and the change avoids obvious layout thrash or unnecessary rerenders.
8. Tests were added or updated when behavior changed.

## Prohibited Patterns

- Do not introduce shadow DOM.
- Do not override the repository light-DOM rendering model with a shadow-root implementation.
- Do not use shadow-DOM-only patterns such as `:host`, `::part`, `slot`, or `delegatesFocus`.
- Do not add inline `<style>` tags inside Lit templates.
- Do not introduce React-, Vue-, or Svelte-specific patterns into Lit components.
- Do not dispatch events from `render()`.
- Do not add generic compatibility wrappers or transitional UI abstractions.
- Do not add framework-level state complexity when local component state or the existing store patterns are sufficient.

## Agent Output Expectations

When using this skill, the agent should:

- preserve the light-DOM Lit architecture
- avoid generic framework advice that conflicts with the repository patterns
- cite the canonical UI files when explaining architectural choices
- note any unavoidable deviation explicitly
