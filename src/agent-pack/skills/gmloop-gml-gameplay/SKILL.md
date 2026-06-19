---
name: gmloop-gml-gameplay
description: Implement gameplay systems in idiomatic GameMaker Language using clear object events, scripts, state machines, input, collisions, rooms, persistence, and performance practices. Use for gameplay code and runtime behavior.
---

# GML Gameplay

Write gameplay logic inside GML scripts and object events. Focus on writing clean, idiomatic GameMaker Language code.

> [!NOTE]
> Creating/deleting resources, editing resource metadata, managing parent-child object structures, or room layer layouts is handled by `gmloop-gamemaker-resources`. Do not attempt to hand-edit JSON YY files or YYP files directly.

Inspect the project's current object, script, input, collision, and room conventions before adding gameplay code. Match established patterns unless they are the source of the requested defect.

## Event Ownership

- Create: initialize instance-owned state and acquire stable references.
- Step: read input, update state, simulate movement, and resolve gameplay consequences in a deliberate order.
- Draw: render presentation without silently changing simulation state.
- Alarm, async, collision, and room events: use only when their engine timing or ownership is required.
- Scripts and functions: isolate reusable calculations, transitions, and data operations from instance lifecycle code.

Follow a project-specific convention when it is clearer and already consistent.

## Gameplay State

Model modes such as idle, moving, attacking, hurt, paused, won, and lost with explicit transitions. Define entry conditions, exit conditions, one-time entry work, and which inputs or collisions are accepted in each state.

Keep update order deterministic. Avoid hidden dependencies on instance iteration order, Draw events, or globals written by unrelated objects. Store shared state in the project's established controller or data structure rather than introducing a new global owner.

## Input, Movement, And Collision

Separate input intent from movement resolution so tests and alternate controls can provide the same intent. Normalize diagonal movement where appropriate and use delta-time or fixed-step conventions consistently with the project.

Use the project's established collision model. Make solid resolution, triggers, damage, invulnerability, and one-way behavior explicit. Prevent repeated collision consequences when only one transition or hit should occur.

## Rooms, Persistence, And Performance

Treat room start/end and persistent-instance behavior as lifecycle boundaries. Define which state resets, persists, or is serialized. Keep save data independent from transient instance identifiers when possible.

Avoid repeated whole-project searches, resource loads, large allocations, or expensive collision queries in per-step code. Optimize measured hot paths without obscuring the gameplay rules.

## Verify

Do not replicate testing layer definitions here. For details on designing unit, resource integration, and smoke tests, refer to the testing guidelines in `gmloop-gml-tests`. Verify gameplay logic continuously using the validation steps in the project's development guidance (`AGENTS.md`).
