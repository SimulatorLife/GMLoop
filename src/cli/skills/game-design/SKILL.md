---
name: game-design
description: Define and maintain a focused game design, core loop, player verbs, goals, progression, feedback, accessibility, and minimum playable scope. Use when planning or changing the direction of a GameMaker game.
---

# Game Design

Create or update the game's design before making broad implementation changes. Base decisions on the loaded project's existing resources and behavior rather than assuming a blank project.

## Define The Game

Record the smallest useful design contract:

- Core fantasy: what the player should feel they are doing.
- Core loop: the repeated sequence of action, feedback, consequence, and renewed decision.
- Player verbs: the small set of actions the player can intentionally perform.
- Decisions: the tradeoffs, timing, positioning, or resource choices that keep the loop interactive.
- Goals: explicit win, loss, and retry conditions.
- Progression: what changes within a run and, only when needed, between runs.
- Economy: resources, sources, sinks, scarcity, and risk/reward assumptions.
- Feedback: how controls, danger, damage, success, failure, and progression remain readable.
- Accessibility: input alternatives, readable presentation, motion and audio considerations, and difficulty assumptions.

## Bound The Scope

Define a minimum playable slice that proves the core loop from start through success or failure. Prefer one polished representative path over multiple incomplete modes, systems, levels, or content sets.

For each proposed feature, state which core-loop decision it strengthens. Defer or remove features that only add breadth, duplicate an existing verb, obscure feedback, or cannot be verified in the current slice.

## Make The Design Testable

Turn subjective goals into observable acceptance criteria. Include representative examples such as:

- A new player can identify the immediate goal and primary controls.
- Every player action produces timely visual, audio, or state feedback.
- The game can reach both success and failure without manual project editing.
- Progression changes available decisions rather than only increasing numbers.
- A complete attempt fits the intended duration and has no dead-end state.

Record balancing values as assumptions, not facts. Identify the playtest or metric that would confirm or disprove each important assumption.

## Deliverable

Leave a concise design summary in the project's existing design document or task artifact. Include the core fantasy, loop, verbs, goals, scope boundaries, acceptance criteria, open balancing assumptions, and the next smallest playable milestone. Do not create competing design documents when the project already has one.
