---

name: gmloop-game-playtest
description: Use Playwright to inspect, navigate, and play a running browser-based GameMaker game. Use when the user wants the agent to verify gameplay, menus, input, screenshots, browser behavior, or the exported HTML5 game loop. This skill is for operating the game through the browser like a player, not for editing code.
argument-hint: "[game-url-or-localhost-url]"
---

# Playtest Game

Use Playwright to interact with a running browser game the way a player would.

This skill is about choosing the right browser-control tool at the right time: opening the game, navigating menus, using mouse and keyboard input, capturing screenshots, checking console errors, and verifying that the game responds correctly.

## Core Principle

Operate the game through its real browser surface.

Prefer real player actions:

* Click buttons with the mouse
* Move the cursor when hover state matters
* Press keyboard controls for gameplay
* Use screenshots to verify visual state
* Use console logs and page errors to detect runtime failures
* Use read-only page inspection when visual evidence is not enough

Do not “cheat” by mutating game state through browser JavaScript unless the user explicitly asks for debugging instrumentation.

## When to Use

Use this skill when checking:

* The game launches in the browser
* Menus, buttons, overlays, pause screens, and settings screens work
* Keyboard or mouse controls affect the game correctly
* The player can start, restart, lose, win, or complete the intended loop
* Visual layout, scaling, fullscreen, or canvas placement looks correct
* The game has console errors, loading failures, or broken assets
* A recent code change needs browser-level verification
* Screenshots are needed as evidence

Do not use this skill as a replacement for unit tests, linting, build validation, or code review.

## Tool Choice Guide

### Open or reconnect to the game

Use browser navigation when:

* The game is already running at a local URL
* The user gives a URL
* A dev server or exported HTML5 build is already available

Verify:

* Page loads successfully
* Canvas or game container appears
* No blocking browser error page appears
* The game reaches a playable or menu-ready state

### Use mouse input

Use mouse movement and clicks when checking:

* Main menu navigation
* Buttons
* Hover states
* Drag interactions
* Card selection
* Inventory interactions
* UI panels
* Mouse-aimed gameplay
* Touch-like interactions on canvas

Prefer real coordinates only when necessary. If the game exposes DOM buttons, use selectors. If the game is canvas-only, use screenshots and canvas coordinates.

### Use keyboard input

Use keyboard controls when checking:

* Movement
* Jumping
* Pause
* Confirm/cancel
* Menu navigation
* Debug hotkeys
* Restart
* Gameplay shortcuts

Send key presses through Playwright as real keyboard events. Do not call game functions directly to simulate input.

### Take screenshots

Take screenshots when:

* Confirming a visual state
* Reporting a bug
* Comparing before/after behavior
* Checking layout, scaling, or UI placement
* Verifying that gameplay visibly changed after input

Capture screenshots at meaningful checkpoints:

* Initial page load
* Main menu
* After starting the game
* During active gameplay
* After win/loss/restart/pause
* At the observed bug or suspicious state

### Check console and page errors

Always check for:

* Browser console errors
* Failed asset loads
* Unhandled exceptions
* WebGL/canvas errors
* Audio unlock or autoplay warnings
* Repeated warnings that may indicate a loop problem

Include important errors in the final report.

### Inspect page state carefully

Use read-only page inspection when screenshots and input are not enough.

Allowed:

* Read canvas size and position
* Read DOM structure
* Read visible text
* Read URL and document title
* Read console output
* Read explicitly exposed debug state, such as `window.__GAME_DEBUG__`, if the project provides it

Avoid:

* Changing variables
* Calling gameplay functions
* Skipping menus by setting state
* Injecting code that makes the game pass
* Editing local storage unless the user asks

## Playtest Loop

1. **Open the Game**

   * Navigate to the provided URL or local running game.
   * Wait until the page, canvas, or game container is ready.

2. **Check Launch Health**

   * Look for console errors, page errors, failed assets, and blank screens.
   * Take an initial screenshot.

3. **Identify the Current Screen**

   * Determine whether the game is on a loading screen, title screen, menu, gameplay screen, pause screen, or error state.

4. **Navigate Like a Player**

   * Use mouse or keyboard input to move through menus.
   * Start the game through the visible UI whenever possible.

5. **Exercise the Core Controls**

   * Press the expected movement/action keys.
   * Confirm that the game responds visually or through exposed read-only state.

6. **Verify the Main Loop**

   * Try to reach at least one meaningful gameplay transition:

     * start game
     * move/interact
     * score/progress
     * take damage/fail
     * pause/resume
     * restart
     * win/lose if feasible

7. **Capture Evidence**

   * Take screenshots at important states.
   * Record observed console/page errors.
   * Note exact inputs used.

8. **Report Findings**

   * Summarize what worked, what failed, and what was not verified.
   * Include reproduction steps for bugs.

## GameMaker HTML5 Notes

For GameMaker HTML5 exports:

* Expect the game to be canvas-heavy.
* DOM selectors may be limited or unavailable.
* Mouse coordinates may need to target the canvas.
* Keyboard focus may require clicking the canvas before pressing keys.
* Asset-loading failures may appear as console errors or stuck loading screens.
* Scaling issues may depend on browser viewport size.
* Audio may require the first user interaction before playback starts.

Before testing keyboard input, click the canvas once unless the page clearly focuses it automatically.

## Recommended Verification Pattern

Use this pattern for most browser-game checks:

```text
1. Open the game URL
2. Wait for canvas/game container
3. Check console and page errors
4. Screenshot initial state
5. Click canvas or start button
6. Navigate menus with real input
7. Play with keyboard/mouse controls
8. Screenshot the result
9. Report observed behavior and evidence
```

## Red Flags

* The game loads to a blank canvas
* The loading screen never completes
* Keyboard input does nothing until canvas focus is clicked
* Menus require exact coordinates with no visual feedback
* Buttons work only by direct JS calls, not real clicks
* The game throws console errors after starting
* Canvas size does not match the viewport or intended aspect ratio
* The game state changes only when injected/debug code is used
* Screenshots do not match the expected state after input
* The playtest passes without actually playing the game

## Output Format

Report:

1. **Launch Result**

   * URL tested
   * Whether the game loaded
   * Any console/page errors

2. **Interaction Result**

   * Menus navigated
   * Inputs used
   * Whether the game responded correctly

3. **Gameplay Result**

   * What part of the game loop was verified
   * What could not be verified

4. **Screenshots**

   * List screenshots captured and what each proves

5. **Issues Found**

   * Bug
   * Evidence
   * Reproduction steps
   * Severity

6. **Next Recommended Check**

   * One focused follow-up test or area to inspect next

## Non-Goals

Do not:

* Modify source files
* Patch game state through JavaScript
* Replace real player input with direct function calls
* Treat a screenshot alone as proof when behavior also needs input verification
* Write a full automated test suite unless the user asks
* Assume DOM selectors exist for canvas-only GameMaker games
