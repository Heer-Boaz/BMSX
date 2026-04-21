# Project Rules

These rules distill the project-level guidance from `AGENTS.md` into working instructions for this skill. They are not a replacement for `AGENTS.md`; they are the parts most likely to affect code shape.

## Architecture
- BMSX is a fantasy console with real console discipline. Hardware visible to carts belongs behind memory maps, MMIO registers, machine devices, and stable cart-facing helpers.
- Do not turn host/platform shortcuts into the hardware contract. If a feature must be cart-visible, model it as console hardware or a deliberate cart API.
- Keep TS and C++ runtime concepts aligned. Divergence should come from language/runtime constraints, not accidental duplicate designs.
- Understand the current module boundary before adding files. Split by real ownership, not by generic layers.

## Existing Primitives
- Use `TaskGate` and `AssetBarrier` for async coordination instead of ad-hoc readiness flags or custom promise gates.
- Search `src/bmsx/common/` before adding utilities. Use existing helpers such as `clamp` instead of local duplicates.
- Use scratch buffers, scratch batches, or pools for temporary hot-path data. Avoid fresh arrays/objects/closures in render, CPU, scheduler, editor layout, and cart loops.
- Do not use `require` in core engine/game code. Keep it to scripts/tooling where the project already allows it.

## Defensive Boundaries
- Internal engine contracts should be direct and fail loudly when broken.
- Defensive handling is valid at real external boundaries: parsing, browser APIs, IO, network, feature detection, user config, and cart/user-authored input.
- Legacy fallbacks are not a default. Add a fallback only when the current supported runtime genuinely needs it.
- Throw for missing required configuration or impossible internal state. Do not return `null` as a bug blanket.

## Cart Code
- Cart code must not call `engine.*`. Use cart-facing globals/helpers such as `object(...)`, `service(...)`, `inst(...)`, `update(...)`, `reset(...)`, `add_space(...)`, `set_space(...)`, and `get_space(...)`.
- String memory and string comparisons are a hard budget. Avoid long repeated prefixes in tags, events, effect IDs, timelines, and other cart-visible identifiers.
- Do not create local aliases of global constants just to shorten access. Read constants directly from their source table/global.

## Serialization
- Treat serialization as a feature requirement, not a cleanup task at the end.
- Decide which state belongs in save data and which state is runtime-only before introducing new objects or fields.
- Registry objects, host/platform handles, caches, scratch buffers, and persistent runtime infrastructure should not be serialized unless there is a deliberate save-state contract.

## Validation
- Use Node v22+ and local TypeScript when running project checks.
- Pick checks that match the touched area. For C++ runtime changes, include the libretro/platform build when the change affects that output.
- For headless game validation, use the project scripts and remember that folder names and ROM manifest names can differ.
