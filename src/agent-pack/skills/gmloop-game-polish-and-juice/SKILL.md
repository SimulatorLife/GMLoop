---
name: gmloop-game-polish-and-juice
description: Improve game feel through readable feedback, animation, audio, timing, camera, particles, transitions, and accessibility without obscuring the core loop. Use after gameplay behavior is stable.
---

# Game Polish And Juice

Polish only after the underlying gameplay transition is correct and reproducible. Establish the intended player information before adding effects.

## Feedback Hierarchy

Prioritize feedback in this order:

1. Control response and immediate action confirmation.
2. Danger, damage, invulnerability, and failure readability.
3. Goal progress, rewards, success, and transitions.
4. Character, atmosphere, and secondary delight.

Combine animation, timing, camera, particles, audio, UI, and transitions only when each channel contributes useful information. Use restrained anticipation, impact, recovery, and cooldown timing so effects reinforce gameplay state.

## Guardrails

- Keep simulation rules outside Draw and cosmetic effects.
- Do not let screenshake, flashes, particles, or audio obscure hazards and controls.
- Provide reduced-motion, volume, contrast, and readability considerations where relevant.
- Pool or bound frequently created effects and avoid expensive per-frame allocations.
- Preserve deterministic gameplay and test outcomes when cosmetic effects are disabled.
- Reuse the project's visual and audio language instead of introducing unrelated effect styles.

## Evaluate

Compare the same gameplay moment before and after polish. Verify that a player can identify the action, consequence, source of danger, and next available decision more quickly or reliably.

Exercise repeated events, simultaneous effects, low frame rate, pause, room transition, restart, success, and failure. Confirm effects clean up and do not accumulate persistent instances, audio, alarms, or camera state.

Report the gameplay signals improved, accessibility/performance constraints considered, and runtime checks performed.
