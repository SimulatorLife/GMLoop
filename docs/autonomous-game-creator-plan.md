# Autonomous GameMaker Creator Plan

GMLoop already has most of the lower-level ingredients for agent-assisted GameMaker development: parser, formatter, lint rules, refactors, semantic indexing, transpilation, runtime hot reload, a CLI, UI surfaces, fixture infrastructure, and an MCP workspace. The next step is to turn those tools into a higher-level autonomous game creation system that can design, modify, test, build, run, and iteratively improve complete GameMaker projects.

The target is not merely an agent that writes `.gml` files. The target is a closed-loop GameMaker development platform where agents can safely mutate real GameMaker resources, reuse known-good gameplay systems, run validation, split work into tasks, and continue work through scheduled or PR-driven automation.

## 1. Current Foundation

The existing monorepo already provides a strong technical base:

- `@gmloop/parser` for GML parsing.
- `@gmloop/format` for deterministic GML formatting.
- `@gmloop/lint` for diagnostics and autofixes.
- `@gmloop/refactor` for project-aware codemods and cross-file edits.
- `@gmloop/semantic` for project indexing, symbols, graph queries, and context retrieval.
- `@gmloop/transpiler` for GML-to-JavaScript emission.
- `@gmloop/runtime-wrapper` for hot-reload and HTML5 runtime integration.
- `@gmloop/cli` as the command surface.
- `@gmloop/ui` for browser-facing visualization and interaction.
- `@gmloop/mcp` for exposing GMLoop behavior to AI and agent clients.
- GitHub Actions agent workflows for PR-comment-driven agent execution.

The remaining gap is the product layer above those pieces: a reusable game-creation operating system with project mutation APIs, build/run/test loops, game-design skills, task orchestration, helper libraries, and scheduled autonomous improvement flows.

## 2. Guiding Principles

1. **Agents should use high-level GameMaker operations, not raw file edits.**
   Editing `.yyp` and `.yy` files directly is fragile. Agents need resource-aware APIs that understand scripts, objects, events, rooms, folders, UUIDs, layers, and metadata.

2. **MCP should stay derived from CLI commands.**
   The current MCP direction is correct: MCP tools should be generated from the CLI command catalog rather than duplicating behavior in the MCP workspace. New autonomous-game tools should be added as CLI commands first, then exposed through MCP.

3. **Validation must close the loop.**
   The system must be able to format, lint, test, build, run, inspect logs, and iterate from failures. Autonomous game creation is not reliable without an automated proof step.

4. **Reusable building blocks beat repeated invention.**
   Agents should compose known-good helpers, systems, templates, and prefabs instead of inventing new state machines, input systems, cameras, and UI primitives every time.

5. **Task graphs should coordinate agents.**
   Scheduled agents and subagents need a machine-readable plan, not just freeform prompts. Work should be split, claimed, blocked, completed, and reviewed through explicit task metadata.

6. **Game design context is as important as code context.**
   Agents need skills and prompts for core loops, player agency, feedback, juice, scope, loss/win criteria, progression, balancing, and vertical-slice planning.

## 3. Milestone 1: Resource-Aware GameMaker Project Mutation

### Goal

Allow agents to safely inspect and mutate real GameMaker projects through structured commands instead of ad-hoc file edits.

### Proposed Workspace

Add a new domain layer, either as a new workspace or a clearly bounded module inside an existing workspace:

```text
src/gamemaker-project
```

or:

```text
src/core/src/gamemaker-project
```

Use a separate workspace if the API becomes large enough to own `.yyp` and `.yy` resource modeling, validation, and mutation independently.

### Capabilities

Add APIs and CLI commands for:

```text
gmloop project inspect
gmloop project validate
gmloop resource list
gmloop resource create
gmloop resource rename
gmloop script create
gmloop script update
gmloop object create
gmloop object event set-code
gmloop room create
gmloop room layer create
gmloop room instance place
gmloop sprite import
gmloop folder create
```

MCP should then expose derived tools such as:

```text
gmloop_project_inspect
gmloop_resource_create
gmloop_script_create
gmloop_object_create
gmloop_object_event_set_code
gmloop_room_instance_place
```

### Required Behavior

- Preserve valid `.yyp` and `.yy` structure.
- Generate stable resource IDs where required.
- Keep folders and resource metadata consistent.
- Support dry-run previews.
- Emit structured JSON summaries for agent consumption.
- Include fixture tests for each supported resource mutation.

### First Work Slice

Start with scripts and objects before rooms:

1. Read a `.yyp` project.
2. List existing scripts and objects.
3. Create a script resource with `.gml` contents.
4. Create an object resource.
5. Set code for a Create or Step event.
6. Validate that project metadata remains consistent.

## 4. Milestone 2: Reusable GML Helper Library and Templates

### Goal

Give agents a common library of reusable GML primitives, systems, and project slices so generated games are consistent, testable, and maintainable.

### Proposed Workspace

```text
src/gml-kit
```

This package should contain importable GameMaker assets and metadata, not just TypeScript helpers.

### Library Layers

Organize the kit into three layers.

#### 4.1 Primitives

Small, dependency-light scripts:

```text
math helpers
timers
state machines
signals/events
object pooling
debug logging
input normalization
array/list helpers
struct helpers
save-data helpers
```

#### 4.2 Systems

Multi-resource systems:

```text
input manager
camera controller
save/load system
debug overlay
menu navigation
dialogue runner
inventory system
particle/burst helper
audio manager
unit-test bootstrap
room transition controller
```

#### 4.3 Templates

Composable project slices:

```text
top-down controller
platformer controller
card-shop roguelike shell
racing prototype shell
visual-novel dialogue scene
arcade score-attack loop
turn-based tactics shell
```

### Manifest Format

Each helper/system/template should include agent-readable metadata:

```json
{
  "id": "gmloop.camera.follow_2d",
  "description": "Smooth 2D follow camera for object-centered rooms.",
  "resources": ["scripts/scr_camera_follow", "objects/obj_camera_controller"],
  "dependencies": ["gmloop.math.lerp"],
  "tags": ["camera", "2d", "runtime"],
  "agent_notes": "Use for player-following rooms. Requires a target instance id or object reference.",
  "tests": ["gmloop.camera.follow_2d.basic"]
}
```

### CLI and MCP Commands

```text
gmloop kit list
gmloop kit search --tag camera
gmloop kit inspect gmloop.camera.follow_2d
gmloop kit import gmloop.camera.follow_2d --path MyGame/MyGame.yyp
gmloop kit dependencies gmloop.camera.follow_2d
```

### First Work Slice

Add 5 to 10 tiny helpers first:

```text
scr_timer_create
scr_timer_tick
scr_state_machine_create
scr_state_machine_set
scr_input_axis
scr_debug_log
scr_assert_equal
scr_array_find_index
scr_lerp
scr_clamp01
```

Keep the initial kit small and heavily tested.

## 5. Milestone 3: GML Unit-Test Authoring and Execution

### Goal

Allow agents to define, inject, run, and collect GML unit tests quickly, ideally without manual GameMaker IDE interaction.

### Context

A separate GameMaker unit-test framework already exists, but it currently has to run inside the GameMaker IDE. GMLoop should provide an adapter around that framework so agents can author tests consistently and eventually run them automatically.

### Test Workflow

Add CLI commands:

```text
gmloop test scaffold
gmloop test add
gmloop test list
gmloop test run
gmloop test parse-results
gmloop test report
```

MCP should expose:

```text
gmloop_test_scaffold
gmloop_test_add
gmloop_test_run
gmloop_test_report
```

### Phase 1: IDE-Compatible Test Generation

The first version does not need perfect headless execution. It should reliably generate test resources that work with the existing framework.

Requirements:

- Create or update test scripts in the GameMaker project.
- Use the existing unit-test framework's conventions.
- Generate deterministic test names.
- Keep tests separate from production scripts where possible.
- Support test metadata and expected result descriptions.

Example command:

```text
gmloop test add --path MyGame/MyGame.yyp --target scr_damage_enemy --name kills_enemy_at_zero_hp
```

### Phase 2: Runtime Test Execution

Use a special GameMaker test target or bootstrap room that runs tests and writes structured results.

Potential outputs:

```text
JSON result file
JUnit XML
plain-text summary
GameMaker log parser output
```

Prefer JUnit XML for CI integration because the repo already uses report-oriented test scripts.

### Phase 3: Transpiler-Based Pure Function Tests

Later, add a fast path for pure script tests by transpiling constrained GML to JavaScript and running in Node. This should not be the first implementation because it risks becoming an incomplete replacement for the GameMaker runtime.

### First Work Slice

1. Define a test manifest format.
2. Add `gmloop test scaffold` to install or validate the test harness resources.
3. Add `gmloop test add` for simple function-style tests.
4. Add fixture tests proving the generated GameMaker resources are stable.
5. Add `gmloop test parse-results` for a sample result file.

## 6. Milestone 4: GameMaker Build, Run, and Log Loop

### Goal

Allow agents to prove that a generated or modified GameMaker game actually builds and, where possible, runs.

### Proposed Workspace

```text
src/build
```

or:

```text
src/gamemaker-build
```

This workspace should expose a provider-backed build facade rather than hardcoding one build mechanism.

### CLI Commands

```text
gmloop game build --path MyGame/MyGame.yyp --target windows
gmloop game build --path MyGame/MyGame.yyp --target html5
gmloop game check-build --path MyGame/MyGame.yyp
gmloop game run --path MyGame/MyGame.yyp
gmloop game logs --path MyGame/MyGame.yyp
gmloop game smoke-test --path MyGame/MyGame.yyp
```

### Provider Model

Potential providers:

```text
local-igor
github-action
stitch-action
html5-export
mock-fixture
```

The CLI and MCP surface should not expose provider-specific details unless necessary. Agents should call `gmloop game build`; GMLoop can decide whether that means a local Igor invocation, an existing GitHub Action, a Stitch-backed action, or a fixture-mode build.

### Stitch / Open-Source Action Direction

There appears to be an open-source Stitch GitHub Action that can test whether a GameMaker game builds. GMLoop should investigate whether it can be used as one provider. Do not make agent prompts depend directly on Stitch. Wrap it behind the GMLoop build facade.

### Required Behavior

- Capture build stdout/stderr/log files.
- Normalize common GameMaker build errors into structured diagnostics.
- Link errors back to resource names and file paths where possible.
- Emit machine-readable JSON output.
- Support CI and local execution modes.

### First Work Slice

1. Add `gmloop game check-build` with a mock provider and documented provider contract.
2. Add log parsing for representative GameMaker build failures.
3. Add CI fixture tests around log parsing.
4. Add a real provider once local/CI credentials and platform constraints are known.

## 7. Milestone 5: Game Design and Game-Building Agent Skills

### Goal

Give agents durable, repo-local guidance for designing and building complete games rather than isolated code changes.

### Proposed Skills

```text
.agents/skills/game-design/SKILL.md
.agents/skills/gml-gameplay/SKILL.md
.agents/skills/gamemaker-resources/SKILL.md
.agents/skills/gml-tests/SKILL.md
.agents/skills/game-debugging/SKILL.md
.agents/skills/game-polish/SKILL.md
.agents/skills/prototype-to-vertical-slice/SKILL.md
```

### `game-design` Skill Topics

The game-design skill should force agents to define or preserve:

```text
core fantasy
core loop
player verbs
moment-to-moment decisions
win condition
loss condition
progression
feedback and juice
risk/reward
resource economy
content scope
testability
minimum playable slice
accessibility
balancing assumptions
```

### `gml-gameplay` Skill Topics

```text
GameMaker object/event patterns
Create/Step/Draw responsibilities
script organization
input handling
state machines
collision conventions
room setup
save/load patterns
performance constraints
GML style conventions
```

### `gml-tests` Skill Topics

```text
how to structure unit tests
how to isolate pure scripts
when to use runtime smoke tests
how to write deterministic tests
how to avoid brittle log wording assertions
how to report test results
```

### First Work Slice

Add `game-design/SKILL.md` and `gamemaker-resources/SKILL.md` first. Those two skills should immediately improve agent behavior for project creation and resource edits.

## 8. Milestone 6: Task Graph and Agent Work Queue

### Goal

Give scheduled agents and subagents a machine-readable TODO list so they can coordinate without duplicating or thrashing work.

### Proposed Files

For generated game projects:

```text
.gmloop/tasks.json
.gmloop/plan.md
.gmloop/game-design.md
.gmloop/agent-log.jsonl
```

For the GMLoop repo itself, equivalent files could live under:

```text
docs/autonomous-game-creator-plan.md
.agents/tasks.json
```

### Task Schema

Example:

```json
{
  "id": "gameplay.player_movement.v1",
  "title": "Implement basic player movement",
  "status": "ready",
  "owner": null,
  "dependsOn": ["project.bootstrap"],
  "acceptance": [
    "Player object exists",
    "Arrow/WASD movement works",
    "Movement speed is configurable",
    "Unit tests or smoke test exist"
  ],
  "files": [
    "objects/obj_player",
    "scripts/scr_player_input"
  ]
}
```

### CLI and MCP Commands

```text
gmloop tasks init
gmloop tasks list
gmloop tasks next
gmloop tasks claim
gmloop tasks split
gmloop tasks complete
gmloop tasks block
gmloop tasks log
```

MCP tools:

```text
gmloop_tasks_list
gmloop_tasks_next
gmloop_tasks_claim
gmloop_tasks_complete
gmloop_tasks_block
gmloop_tasks_split
```

### Required Behavior

- Dependency-aware next-task selection.
- Status transitions with validation.
- Acceptance criteria on every implementation task.
- Machine-readable agent logs.
- Optional links to PRs, commits, files, build runs, and test results.

### First Work Slice

1. Define the task schema.
2. Add `gmloop tasks init/list/next/complete`.
3. Store files as JSON with stable formatting.
4. Add fixture tests.
5. Add MCP exposure through CLI catalog.

## 9. Milestone 7: Scheduled Agentic Game Improvement Flow

### Goal

Extend the existing GitHub Actions agent workflow pattern from repo-maintenance tasks to game-creation tasks.

### Proposed Workflows

```text
.github/workflows/agent-game-plan.yml
.github/workflows/agent-game-implement.yml
.github/workflows/agent-game-test.yml
.github/workflows/agent-game-polish.yml
.github/workflows/agent-game-review.yml
```

### Workflow Types

```text
daily prototype improvement
nightly build/test repair
weekly content expansion
scheduled polish pass
scheduled bug triage
scheduled helper-library expansion
```

### Required Behavior

- Pull the next task from `.gmloop/tasks.json`.
- Run the appropriate agent role prompt.
- Require a repository diff or explicit blocked status.
- Run relevant validation.
- Commit or open a PR.
- Write a machine-readable agent summary.
- Update the task graph.

### First Work Slice

Create one scheduled workflow that runs in dry-run or issue-creation mode only:

```text
agent-game-plan.yml
```

It should inspect the task graph and propose the next implementation task without mutating game resources yet.

## 10. Milestone 8: Subagent Orchestration

### Goal

Allow larger game-development goals to be split across specialized agents.

### Roles

```text
designer
planner
implementer
tester
debugger
refactorer
polisher
reviewer
asset-integrator
```

### Orchestration Loop

```text
planner splits milestone into tasks
implementer claims one ready task
tester adds or updates tests
debugger fixes failing validation
reviewer checks design coherence and code quality
polisher improves feel, feedback, and UX
planner updates the task graph
```

### Required Constraints

- Each subagent gets one narrow task.
- Each subagent must write a machine-readable summary.
- Each subagent must cite changed files and validation results.
- Agents should not silently rewrite unrelated systems.
- Parent orchestration should prevent multiple agents from claiming the same task.

### First Work Slice

Add role prompt files and a sequential parent workflow before attempting parallel agents.

```text
.agents/roles/game-planner.md
.agents/roles/game-implementer.md
.agents/roles/game-tester.md
.agents/roles/game-reviewer.md
```

## 11. End-to-End Target Workflow

The long-term autonomous creation loop should look like this:

```text
1. User requests a game concept or feature.
2. Agent creates or updates game-design.md.
3. Agent splits the design into tasks.
4. Agent selects the next ready task.
5. Agent imports helpers/templates from gml-kit when applicable.
6. Agent mutates GameMaker resources through structured commands.
7. Agent formats and lints GML.
8. Agent generates or updates tests.
9. Agent builds/runs/tests the GameMaker project.
10. Agent inspects logs and structured diagnostics.
11. Agent fixes failures.
12. Agent commits or opens a PR.
13. Scheduled agents continue from the task graph.
```

## 12. Recommended Implementation Order

### Phase 1: Safe GameMaker Mutation

Deliver:

```text
GameMaker project/resource model
script creation
object creation
event code editing
fixture tests
CLI commands
MCP exposure
```

### Phase 2: Minimal Helper Library

Deliver:

```text
src/gml-kit
helper manifest format
5 to 10 tiny helpers
kit list/search/import commands
fixture import tests
```

### Phase 3: Unit-Test Adapter

Deliver:

```text
test manifest format
test scaffold command
test add command
sample generated tests
result parser
JUnit output
```

### Phase 4: Build Facade

Deliver:

```text
provider contract
mock provider
log parser
check-build command
real provider investigation
```

### Phase 5: Agent Skills and Task Graph

Deliver:

```text
game-design skill
gamemaker-resources skill
task schema
tasks CLI commands
MCP task tools
```

### Phase 6: Scheduled and Subagent Workflows

Deliver:

```text
scheduled game-planning workflow
sequential subagent roles
machine-readable summaries
task graph updates
validation-gated PR flow
```

## 13. Highest-Leverage Immediate PRs

1. **Add GameMaker project/resource mutation layer.**
   Focus on scripts, objects, and object event code first.

2. **Add CLI commands for resource creation and editing.**
   Keep MCP derived from the CLI command catalog.

3. **Add a minimal `gml-kit` helper library.**
   Start with a small manifest-driven library rather than a large prefab system.

4. **Add a unit-test adapter spec.**
   Define how GMLoop scaffolds tests for the existing GameMaker unit-test framework.

5. **Add a build facade.**
   Start with provider contracts and log parsing before committing to a specific backend.

6. **Add game-design and GameMaker-resource agent skills.**
   Improve agent behavior before large automation is attempted.

7. **Add a task graph.**
   Enable scheduled agents and subagents to coordinate through explicit state.

## 14. Open Questions

1. Which GameMaker versions and runtimes should the first build provider support?
2. Can the open-source Stitch GitHub Action reliably build the target project types in CI?
3. Should the reusable GML kit be shipped as source resources, package artifacts, or project templates?
4. How should generated projects distinguish production resources from test-only resources?
5. What is the minimum viable headless test runner for the existing unit-test framework?
6. Should generated games keep `.gmloop` metadata in the project root, or should metadata live outside the GameMaker project tree?
7. How much of the runtime/playtest loop can be automated through HTML5 export and browser automation?
8. What subagent roles should run in parallel versus sequentially?

## 15. Summary

The next stage for GMLoop is to become a GameMaker autonomous development platform, not only a set of GML code tools. The core unlocks are:

```text
resource-aware project mutation
reusable GML helper systems
unit-test generation and execution
GameMaker build/run validation
game-design agent skills
task graph orchestration
scheduled and subagent workflows
```

The first priority should be safe, structured GameMaker resource mutation. Once agents can reliably create scripts, objects, events, and rooms through high-level commands, the rest of the autonomous loop can build on a stable foundation.