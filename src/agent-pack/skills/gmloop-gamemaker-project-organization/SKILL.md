---
name: gmloop-gamemaker-project-organization
description: Organize GameMaker resources, manage layout and naming, structure project notes, and establish reusable architectural systems. Use when organizing resources, naming systems, or structuring GameMaker projects.
---

# GameMaker Project Organization Guidelines

1. **Keep one central project note named `TODO`.**
   Use one main GameMaker note, `TODO`, as the central place for active goals, bugs, cleanup tasks, feature ideas, and design reminders. Update it throughout development instead of scattering important TODOs across many notes, comments, or temporary files. Code comments can still mark local work, but anything important or project-level should also be reflected in `TODO`.

2. **Group resources by system or feature, not by resource type.**
   Prefer folders like `GUI`, `Combat`, `Player`, `World`, `Audio`, or `Dialogue` over broad folders like `Sprites`, `Scripts`, `Objects`, and `Shaders`. A sprite, object, script, shader, and sound that all belong to the GUI should live near each other so the whole system is easier to understand and move around.

3. **Prefer fewer reusable systems over many tiny one-off systems.**
   When possible, use one flexible, reusable struct or controller for related behavior instead of many small specialized ones. For example, one reusable juice/effects/squish struct is usually better than separate structs for bounce, pulse, squash, shake, pop, and hover effects if those effects share the same basic behavior. Reuse and consistency are preferred over variety when variety adds tracking, resources, or maintenance cost.

4. **Use one main global game controller object for bootstrapping.**
   Prefer one main global controller object that initializes core systems, controller structs, managers, save data, debug tools, and persistent state. Avoid creating many separate global objects for each system unless they truly need object behavior, room placement, collisions, alarms, draw events, or independent GameMaker event lifecycles. Structs are usually lighter, easier to pass around, and easier to trace.

5. **Give each system a clear owner.**
   Every major feature should have an obvious owning object, struct, or script entry point. Avoid situations where responsibility is split across many unrelated resources. For example, GUI layout should not be partly owned by a room object, partly by a random draw script, and partly by a global variable unless there is a clear reason.

6. **Keep system internals private by convention.**
   Organize each system so most scripts and structs are used only inside that system. Expose a small, clear public API for other systems to call. This keeps unrelated systems from reaching into internal state and makes future refactors safer.

7. **Prefer consistent naming that shows ownership.**
   Use names that make the resource’s system obvious. For example, GUI resources should share a clear prefix, folder, or naming pattern. Avoid generic names like `manager`, `controller`, `helper`, or `data` unless the folder context makes the owner obvious.

8. **Do not create new managers by default.**
   Only add a new manager/controller when there is a real lifetime, ownership, or coordination problem to solve. Many “manager” objects become vague dumping grounds. Prefer plain functions, structs, or data tables until a dedicated manager is clearly needed.

9. **Keep rooms lightweight.**
   Rooms should mostly place instances and configure scene-specific data. Avoid hiding important game logic directly in room creation code or scattered room-specific instance overrides. Shared behavior should live in scripts, structs, objects, or system controllers.

10. **Regularly remove dead resources and merge duplicates.**
    During development, periodically delete unused sprites, objects, scripts, notes, and test assets. If two systems solve the same problem in different ways, prefer merging them into one reusable version instead of keeping both indefinitely.

11. **Group simple utility functions into shared script files.**
    Prefer grouping small, generic helper functions into one clearly named script resource instead of creating a separate script resource for every tiny function. For example, custom buffer helpers can live in `group_buffers`, array helpers in `group_arrays`, string helpers in `group_strings`, and math helpers in `group_math`. Keep these files focused by topic, and avoid turning them into random catch-all dumping grounds.

12. **Use object inheritance for shared instance behavior.**
    Prefer clear parent-child object hierarchies when multiple objects share behavior, state, events, or lifecycle logic. For example, use a hierarchy like `obj_entity -> obj_enemy -> obj_zombie` instead of duplicating movement, health, collision, damage, animation, or cleanup logic across many separate objects. This makes shared behavior easier to update in one place, keeps specific objects smaller, and makes the project easier to reason about because each child object only needs to define what makes it different.

13. **Maintain/use one top-level script file `macros` for project-wide macros and configurations.**
   This "macros" script should contain any/all project-wide macros like `RELEASE`, a true/false flag that indicates whether the project is in release mode. During development, it should be set to `false`, and debug-only code/objects can be conditionally compiled/included based on this flag. Avoid scattering these values across multiple scripts or objects. This centralization makes it easier to manage and update configurations as the project evolves.
