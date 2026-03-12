# Architecture Review: `pietious` and BIOS

This document captures the architecture review of the `pietious` cart together with the BIOS/runtime layer. A modern general-purpose engine such as Unreal Engine 5 or Godot is used once for calibration, not as a recurring comparison target — BMSX is a fantasy console, not a general-purpose engine, and the review should be read accordingly.

## Scope

- Cart under review: `src/carts/pietious` (35+ Lua files, 11 FSMs, ~6000+ lines total)
- Runtime under review: `src/bmsx/res/bios` (40+ Lua files)
- Verified: headless build and execution pass (`npm run headless:forcebuildallrun -- pietious`)

## Executive Summary

The BIOS is a strong, disciplined fantasy-console runtime. Its frame pipeline, event contract, space system, and component lifecycle are technically coherent and should not be refactored.

`pietious` is more modular than it first appears — 35+ files, 11 FSMs, separated combat/ability/spawning/UI modules. The real problem is narrow: three central orchestration objects (`director`, `castle`, `player`) have accumulated too many cross-cutting responsibilities. The rest of the cart is well-decomposed.

## What Is Strong

### 1. The BIOS frame pipeline

The BIOS has an explicit, deterministic frame pipeline with ordered phases:

- input → action effects → mode resolution → physics → animation → presentation → event flush

Systems register into the pipeline with explicit phase groups, priorities, and conditional `when()` gates. The pipeline is built via `ecspipelineregistry:build()`, which resolves, sorts, and registers all systems before any frame runs.

Relevant files:

- `src/bmsx/res/bios/ecs.lua`
- `src/bmsx/res/bios/ecs_pipeline.lua`
- `src/bmsx/res/bios/ecs_builtin.lua`

This is closer to a custom engine scheduler than to ad hoc gameplay scripting.

### 2. The boot flow is console-firmware-shaped

The BIOS performs manifest inspection, precheck validation, atlas loading, boot gating, and cart handoff. This resembles firmware or a console boot ROM more than a game engine scene bootstrap.

Relevant file:

- `src/bmsx/res/bios/bootrom.lua`

For a fantasy console, this is the correct design. The machine model is part of the product.

### 3. The event model is strict about intent

The BIOS event system explicitly documents that events should be announcements, not disguised commands. The emitter does not know or care who listens. A request/reply pattern exists for async coordination. Emitter filtering and subscriber-based cleanup are enforced.

Relevant file:

- `src/bmsx/res/bios/eventemitter.lua`

This contract is often only implicit in larger engines. Here it is spelled out and enforced.

### 4. The space system

Objects belong to named spaces (`main`, `transition`, `shrine`, `lithograph`, `item`, `ui`). Moving an object to a different space (e.g., hiding enemies during a screen fade) controls visibility without destroying the object — FSM state, event subscriptions, and component state all survive the move.

This avoids a whole class of lifecycle bugs and is one of the most elegant patterns in the runtime.

### 5. The progression system is a rule engine

The BIOS progression module is not just a key-value store. It is a compiled rule engine:

- Rules are compiled from declarative specs into optimized bytecode with interned string keys.
- Rules dispatch automatically via `on_any()` on the global event bus — no manual polling.
- Each rule has `when_event` (payload matching), `when_all` (state conditions), `set` (mutations), `apply` (custom handlers), and `apply_once` (one-shot execution).
- Rules can trigger other rules (repeat until stable).

`pietious` builds 200+ compiled rules from room templates and enemy definitions in `castle.lua`. This is closer to UE5's Gameplay Ability System or a declarative quest system than to ad hoc scripting.

Relevant files:

- `src/bmsx/res/bios/progression.lua`
- `src/carts/pietious/castle.lua`

The progression model is a strength. The weakness is that its mounting point (`castle.lua`) contributes to castle's god-object status.

### 6. The cart is more modular than it appears

`pietious` has 35+ Lua files and 11 registered FSMs. Most subsystems are already in their own modules:

| Concern | Module(s) |
|---------|-----------|
| Abilities/weapons | `player_abilities.lua` |
| Combat damage | `combat_damage.lua`, `combat_overlap.lua` |
| Enemy definitions | `enemy_registry.lua`, `enemies/` subdirectory |
| Room spawning | `room_spawner.lua` |
| Elevators | `elevator.lua`, `elevator_update_system.lua` |
| Projectiles | `pepernoot_projectile.lua` |
| Shrine UI | `shrine.lua` |
| Map/story screen | `lithograph.lua`, `lithograph_screen.lua` |
| Inventory screen | `item_screen.lua` |
| Screen transitions | `transition.lua` |
| HUD | `ui.lua` |
| Loot | `loot_drop.lua` |
| Rotating doors | `draaideur.lua` |
| World entry | `world_entrance.lua` |
| Collectibles | `world_item.lua` |
| Seal mechanics | `seal.lua` |
| Daemon VFX | `daemon_cloud.lua` |
| Constants/config | `constants.lua`, `collision_profiles.lua` |
| Castle layout data | `castle_map.lua`, `res/data/castle_map.yaml` |
| Progression tracking | `progression.lua` |

The problem is not a general lack of decomposition. It is specifically the three central orchestrators.

### 7. The component and object lifecycle

The BIOS component system has a clean lifecycle: `new()` → `attach()`/`bind()` → `on_attach()` → active use → `on_detach()` → `unbind()` → `dispose()`. Components use `subscriber = self` on all event subscriptions, enabling safe bulk cleanup.

World objects follow a parallel lifecycle: `new()` → `spawn()` → `onspawn()` → `activate()` → `bind()` → FSM start → active use → `mark_for_disposal()` → `deactivate()` → `ondespawn()` → `dispose()` → `unbind()`.

The `mark_for_disposal()` pattern (deferred removal instead of eager despawn) prevents iterator corruption during updates and event dispatch.

Relevant files:

- `src/bmsx/res/bios/components.lua`
- `src/bmsx/res/bios/worldobject.lua`

### 8. The runtime survives headless build and execution

```bash
npm run headless:forcebuildallrun -- pietious
```

The build succeeded, the ROM booted, and the existing headless assertions passed. This review is grounded in both code reading and verified execution.

Relevant test/runtime files:

- `src/carts/pietious/test/pietious_assert_results.mjs`
- `src/carts/pietious/test/pietious_demo.json`

## Where `pietious` Is Strained

### 1. Three god objects

The cart's centralization problem is concentrated in three files. Each has accumulated responsibilities beyond its natural scope.

#### `director.lua` (~750 lines)

The director owns:

- space switching and room transitions (core responsibility)
- banner transitions (core responsibility)
- shrine overlay flow (should be owned by `shrine.lua`)
- item screen flow (should be delegated to `item_screen.lua`)
- lithograph flow (should be delegated to `lithograph_screen.lua`)
- seal dissolution flow (cross-cutting with `castle.lua`)
- daemon appearance flow (cross-cutting with `castle.lua`)
- title/story/ending/death flow (cinematic sequences)

This is a gameplay director, UI flow controller, cutscene controller, and transition state machine merged into one object.

#### `castle.lua` (~750 lines)

The castle owns:

- room switching (core responsibility)
- world entrance state (core responsibility)
- progression program compilation (200+ rules — core, but the rules themselves should be data)
- boss/seal state management (cross-cutting with `director.lua`)
- room customization refresh
- daemon/seal death resolution logic

This is a world state store, room manager, progression service, and boss-flow coordinator at the same time.

#### `player.lua` (3000+ lines, ~600 lines of FSM)

The player combines:

- input state and movement (core responsibility)
- stairs and physics (core responsibility)
- hit reactions and damage
- weapons and ability bridging (partially in `player_abilities.lua`)
- transition triggers
- presentation logic
- state graph assembly (~600 lines of FSM definition)

The FSM is large but inherently cohesive — player state is player state. The more extractable parts are the presentation logic and transition triggers, which could be components.

### 2. The event coupling triangle

`director`, `castle`, and `player` form a tight event triangle. They emit and listen to each other's events extensively. Some of these events are genuine broadcasts ("room entered", "seal broken"). Others are effectively disguised bidirectional calls between the three gods — violating the event system's own announcement-not-command contract.

A refactoring plan should map the event graph between these three objects and identify which events are true broadcasts vs. which are point-to-point coordination that should be explicit method calls or extracted into a shared coordinator.

### 3. Progression rules are code, not data

The `build_progression_program()` function in `castle.lua` constructs 200+ rule definitions in code. These rules are declarative in structure (event triggers, conditions, mutations) but are assembled procedurally. Moving the rule definitions into data (YAML or a Lua table literal loaded from a resource) would reduce castle's code volume and make rule authoring more accessible.

## Serialization and State Boundaries

The serialization model is more structured than it may appear:

| Mechanism | Scope | Behavior |
|-----------|-------|----------|
| `registrypersistent = true` | BIOS singletons (HUD, eventemitter, audio) | Survive `world.clear()`, excluded from savegame |
| `registrypersistent = false` (default) | Enemies, room objects, temporary state | Removed on `clear()`, included in savegame |
| `progression` module | Mounted on long-lived object (castle) | Event-driven state with compiled rules, survives room transitions |
| `@insavegame` / `@excludefromsavegame` | TypeScript components | Declarative inclusion/exclusion |
| `@onsave` / `@onload` | TypeScript methods | Pre-serialization packing, post-deserialization rebinding |

The mechanism is sound. The risk is not the mechanism but the surface: `castle` and `player` each carry enough state that their serialization surface is large. A per-field audit of what is and is not serialized in these two objects would be more useful than an architectural change.

## What Should Not Be Refactored

The following systems are solid and should be left alone:

- **BIOS frame pipeline** (`ecs_pipeline.lua`, `ecs_builtin.lua`) — deterministic, phase-ordered, conditional
- **Event system** (`eventemitter.lua`) — strict contract, emitter filtering, subscriber cleanup
- **Space system** — elegant visibility control without lifecycle disruption
- **Component lifecycle** (`components.lua`, `worldobject.lua`) — clean bind/unbind, safe disposal
- **Progression rule engine** (`progression.lua`) — compiled rules with event-driven dispatch
- **Boot flow** (`bootrom.lua`) — console-shaped, correct for the product
- **Registry** (`registry.lua`) — clear persistent/non-persistent split, tag-based queries

Protecting these systems from well-intentioned erosion is as important as fixing the god objects.

## Concrete Decomposition Plan

Prioritized by impact-to-effort ratio:

### Priority 1: Split `director.lua`

Director has the most orthogonal responsibilities and is the easiest to decompose.

| Responsibility | Action |
|---|---|
| Space switching, room transitions, banners | **Keep in director** — this is its core job |
| Shrine overlay flow | **Delegate to `shrine.lua`** — the file already exists |
| Item screen flow | **Delegate to `item_screen.lua`** — director should trigger, not orchestrate internals |
| Lithograph flow | **Delegate to `lithograph_screen.lua`** — same pattern |
| Seal dissolution, daemon appearance | **Move to a `boss_flow.lua`** or let `castle.lua` own since it owns seal/daemon state already |
| Title/story/ending/death sequences | **Extract to `cinematics.lua`** or keep in director if kept to thin dispatch |

### Priority 2: Extract progression rules from `castle.lua`

The 200+ rule definitions in `build_progression_program()` are declarative in structure. Move them to a data file (YAML or Lua table loaded from a resource). Castle keeps the rule *mounting* and *dispatch* logic, but no longer owns the rule *definitions*.

Castle's remaining responsibilities (room switching, world entrance state, room customization) are its natural core.

### Priority 3: Reduce `player.lua` selectively

Player's FSM (~600 lines) is inherently cohesive and does not benefit from splitting. Focus instead on:

- **Presentation logic** (visual state, animation triggers) → extract to a player presentation component
- **Transition triggers** (room exits, stair entries) → extract to a player transition component
- **Ability bridging** → ensure `player_abilities.lua` owns the full contract, not just the implementation

Movement, input, and the state graph should stay in `player.lua`.

### Priority 4: Map and clean the event coupling graph

Audit the events exchanged between `director`, `castle`, and `player`. Classify each as:

- **True broadcast** (multiple listeners, no expected reply) → keep as events
- **Point-to-point coordination** (one emitter, one expected listener) → consider explicit calls or a shared coordinator
- **Disguised command** (emitter expects specific behavior from listener) → refactor to direct calls

## Test Coverage

The ability to run `npm run headless:forcebuildallrun -- pietious` and get assertion results is a real asset. Current test coverage includes headless boot, execution flow, and elevator assertions.

Gaps to consider:

- The three god objects (`director`, `castle`, `player`) are the hardest to test in isolation because of their event coupling
- Decomposing them (Priority 1–3 above) would make per-module testing more tractable
- Room progression rules are a natural fit for unit testing once extracted to data

## Bottom Line

The BIOS is a compact, technically coherent fantasy-console operating environment. It should be preserved as-is.

`pietious` is well-decomposed at the module level — 35+ files covering combat, UI, spawning, elevators, projectiles, and more. The architectural strain is concentrated in three orchestration objects that have grown beyond their natural scope.

The fix is surgical, not structural: decompose `director`, extract progression data from `castle`, slim `player`'s non-core concerns, and clean the event coupling graph between them. The rest of the cart and the entirety of the BIOS should be left alone.
