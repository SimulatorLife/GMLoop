# Autonomous Game Development Guidance

Develop this GameMaker project as a playable product through small, evidence-driven iterations. Make progress autonomously according to the project's design goals / target state. Do not confuse activity with progress: every iteration must improve a player-visible outcome, remove a verified blocker, or reduce a concrete project risk.

## Project Ground Truth

- Treat the directory containing the active `.yyp` file as the project root.
- Inspect existing code, resources, rooms, conventions, project guidance, and current behavior before proposing new structure.
- Reuse established ownership and naming patterns unless evidence shows they are causing the problem.
- Prefer structured GameMaker project tooling over editing `.yyp`, `.yy`, room, object, or resource metadata as unstructured text.
- Keep game-specific decisions in the project's existing design, task, or status artifacts. Do not create competing sources of truth.

## Autonomous Iteration Loop

Repeat this loop until the requested milestone is complete or a genuine external decision blocks progress:

1. **Orient:** Establish the current playable state, read concept documents/designs and active target instructions, check available GMLoop and official `gm-cli` / ResourceTool MCP tools, relevant skills, known failures, and the shortest way to build or run the game. Use `gmloop project inspect --json` when available to summarize readiness.
2. **Choose the next outcome:** Select the smallest player-visible improvement or highest-risk blocker that advances the core loop. Find the target feature, issue, or defect in the codebase using semantic search or resource inspection, and state observable acceptance criteria before implementation.
3. **Plan the slice:** Identify the minimum code, resources, tests, and runtime checks needed. Defer unrelated content, abstraction, polish, and speculative systems.
4. **Implement coherently:** Make the change at the owning source. Keep simulation, presentation, resource metadata, and tooling responsibilities clear. Integrate with existing systems instead of creating parallel paths.
5. **Validate continuously:** Run the narrowest relevant checks while working. Add or update deterministic tests for logic and regressions, validate resource relationships, and build the intended target. Use `gmloop project validate --json` to collect GMLoop-owned evidence before claiming the iteration is proven.
6. **Play and evaluate:** Exercise the changed behavior in its real room and lifecycle when runtime access is available. Check controls, feedback, success, failure, retry, pause, transitions, persistence, and cleanup as applicable.
7. **Respond to evidence:** Fix root causes. If an assumption fails, revise the plan and acceptance criteria explicitly rather than layering patches over the symptom.
8. **Close the iteration:** Record what changed, evidence collected, known limitations, and the next highest-value outcome. Leave the project buildable and its working state understandable to the next agent or developer.

## Decision Principles

- Protect the core loop first. Prefer one complete, readable experience over several incomplete systems.
- Prioritize correctness and playability, then clarity, then measured performance, then polish.
- Introduce an abstraction only when current duplication or variation justifies it.
- Keep gameplay state transitions explicit and deterministic. Avoid hidden dependencies on Draw events, instance order, timing, or unrelated globals.
- Treat balancing values as hypotheses. Change them from playtest evidence or stated design intent, not arbitrary preference.
- Preserve player readability. Actions, danger, damage, goals, success, and failure need timely, accessible feedback.
- Avoid irreversible or destructive changes when a smaller reversible experiment can answer the same question.

## Validation And Completion

Use the lowest validation layer that proves each claim:

- Unit tests for calculations, state transitions, scoring, progression, and deterministic selection.
- Resource or project validation for scripts, objects, events, rooms, instances, references, and metadata.
- Runtime checks for engine lifecycle, input, collisions, drawing, audio, room flow, persistence, and asynchronous behavior.
- Target builds for syntax, packaging, launchability, and platform integration.

A milestone is complete only when its acceptance criteria are met, relevant tests and validation pass, the intended target builds, and the representative gameplay path works without manual project repair. Never weaken checks, rewrite expected artifacts, or hide failures to declare completion. Report anything not run or not reproduced.

For implementation iterations, validate in increasing-cost order:

1. Parse each changed GML file. If parsing fails, inspect the diagnostic and use the available GML syntax-recovery or recovery-capable codemod workflow before making broader changes.
2. Apply relevant semantic renames or configured codemods, then lint fixes and formatting. Reparse after transformations.
3. Run focused unit and resource tests, fix failures at their owning source, and repeat until the relevant suite passes.
4. Compile the intended GameMaker target with the configured build capability. Prefer the official `gm-cli` flow when it is available; fix compile diagnostics and rebuild until clean.
5. Launch the game using the intended runtime target. For browser-facing changes, build and run the HTML5 target and exercise the affected path with available browser automation, preferring a configured Playwright MCP integration when present. Test the layout, visual elements, controls, and player-visible feedback to confirm correctness.
6. Verify the observable acceptance criteria in play, including relevant input, feedback, state transitions, failure paths, restart, room flow, and cleanup. Capture evidence and repeat the loop for any defect found.

Do not treat parsing, formatting, unit tests, compilation, launch, and gameplay verification as interchangeable evidence. If a layer is unavailable, report it explicitly and complete every lower-cost layer that remains available.

## Failure And Escalation

When work fails, capture the shortest reproduction and identify whether the owning layer is design, GML syntax, gameplay state, resource structure, room setup, tooling, build, or runtime. Test one falsifiable hypothesis at a time and keep regression coverage for confirmed defects.

Continue autonomously through ordinary implementation choices and recoverable failures. Ask for input only when progress requires unavailable product intent, credentials, external assets, a destructive decision, or a choice with materially different player outcomes that the project cannot resolve. Explain the blocking decision and the evidence already gathered.
