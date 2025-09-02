# Decorators Reference (BMSX)

This document summarizes the decorator contracts used across the BMSX engine. The engine uses the new TypeScript 5+ decorator model (value + context). All decorators are designed to be declarative, composable, and safe for inheritance.

> Note: Avoid side‑effects inside decorators beyond registration; the engine binds, builds and activates at well‑defined init points.

## Runtime and Build Assumptions

- TypeScript 5+ new decorators are enabled (no legacy experimentalDecorators).
- Method decorators never rely on `descriptor`; they receive the function value and may return a wrapper.
- Class/field/method decorators use `context.addInitializer` where registration needs constructor context.

---

## Serialization

Provided by `src/bmsx/serializer/gameserializer.ts`.

- `@insavegame` / `@insavegame('TypeId')`

  - Class decorator: registers a type for the serializer/deserializer.
  - With a string parameter, uses a stable ID (recommended for long‑term stability/minification safety).
  - Inheritance: derived classes must be decorated explicitly if they should be constructible by the reviver.

- `@excludeclassfromsavegame`

  - Class decorator: fully excludes the type from serialization. Instances are skipped.

- `@excludepropfromsavegame`

  - Field decorator: omits a property from savegame and hydration (both Serializer and Reviver exclusion maps).

- `@onsave`

  - Method decorator: registers a function that runs before serialization to add derived data.
  - The method may be instance or static. The return value is merged into the plain object.

- `@onload`
  - Method decorator: registers a function that runs after hydration to finalize the object.
  - The method may be instance or static.

### Best practices

- Prefer `@insavegame('Stable.Type.Id')` for core engine/game types.
- Use `@onsave`/`@onload` for derived/transient rebuilds (e.g., buffers, runtime caches).
- Avoid serializing registry‑persistent objects; use `@excludeclassfromsavegame` for those.

---

## Components

Provided by `src/bmsx/component/basecomponent.ts`.

- `@componenttags_preprocessing(...tags)`

  - Class decorator on Component subclasses. Marks tags for the preprocessing phase. Tags are merged through inheritance.

- `@componenttags_postprocessing(...tags)`

  - Class decorator on Component subclasses. Marks tags for the postprocessing phase. Tags are merged through inheritance.

- `@update_tagged_components(...tags)`

  - Deprecated for container-driven main loops. The default game loop is ECS-based; prefer Systems to drive component updates.
  - Historical wrapper sequence: preprocessing(tagged) → original() → postprocessing(tagged, { params, returnvalue }).

- `@attach_components(...ComponentClasses)`
  - Class decorator on GameObject subclasses. Auto‑adds the listed component types when the object is spawned.
  - Inherits parent components and deduplicates by constructor.

### Lifecycle and binding

- Component constructor no longer binds events. Binding happens once on add via `GameObject.addComponent` calling `component.onloadSetup()` (late‑init).
- Components remove their subscriptions on `dispose()` via `EventEmitter.removeSubscriber`.

### Performance note

- If you have tight loops on `run`, consider keeping per‑tag indexes to minimize scanning all components.

---

## Events

Provided by `src/bmsx/core/eventemitter.ts`.

- `@subscribesToGlobalEvent(event)`
- `@subscribesToSelfScopedEvent(event)`
- `@subscribesToParentScopedEvent(event)`
- `@subscribesToEmitterScopedEvent(event, emitterId)`

  - Method decorators that register subscription metadata on the class (stored in `eventSubscriptions`).
  - Binding occurs once per instance at late‑init:
    - GameObject: `onLoadSetup()`
    - Component: `onloadSetup()` (called by `addComponent` and during hydration)
  - Duplicate registration is prevented by the emitter.

- `@emits_event(event)`
  - Method decorator that returns a wrapper calling the original method and then emitting the event.

### Best practices

- Keep handlers lightweight and guard with `this.enabled` (wrapping already applied for Components).
- Use persistent listeners sparingly; they bypass `clear()`.

---

## Finite State Machines (FSM)

Provided by `src/bmsx/fsm/fsmdecorators.ts` and `src/bmsx/fsm/fsmlibrary.ts`.

- `@build_fsm(name?)`

  - Method decorator (typically static). Registers a function that returns a `StateMachineBlueprint` under `name` or the class name.

- `@assign_fsm(...names)`
  - Class decorator: links one or more FSM IDs to a class. Inherited through the prototype chain.

### Advanced

- Handler registry uses hoisted thunks; see `HandlerRegistry` and `getDeclaredFsmHandlers` for dynamic resolution.

---

## Behavior Trees (BT)

Provided by `src/bmsx/ai/behaviourtree.ts`.

- `@build_bt(id?)`

  - Method decorator (typically static). Registers a function that returns a BT definition under `id` or the class name.

- `@assign_bt(...ids)`
  - Class decorator: links BTs to a class. Inherited through the prototype chain.

---

## Examples

```ts
@insavegame("Game.Camera")
export class Camera {
  /* ... */
}

@insavegame
@componenttags_preprocessing("physics_pre")
@componenttags_postprocessing("run") // Needs to match a tag in the `@update_tagged_components`-call!
export class PhysicsComponent extends Component {
  // Implement this method to handle preprocessing updates
  public preprocessingUpdate(..._args): void {
    /* ... */
  }

  // Implement this method to handle postprocessing updates
  public postprocessingUpdate({
    params,
    returnvalue,
  }: ComponentUpdateParams): void {
    /* ... */
  }
}

export class GameObject {
  @update_tagged_components("run") // Note that you need to match
  run() {
    /* ... */
  }
}

@attach_components(PhysicsComponent)
export class Player extends GameObject {
  @subscribesToSelfScopedEvent("damaged")
  onDamaged() {
    /* ... */
  }
}

export class Model {
  @build_fsm("game_fsm") // Note that the root state is named 'game_fsm', otherwise it would have been 'Model'
  static build(): StateMachineBlueprint {
    /* ... */
  }
}
```

---

## Best Practices Checklist

- Prefer stable IDs with `@insavegame('Type.Id')` for engine/core types.
- Bind events only at late‑init (already handled by engine) and keep handlers idempotent.
- Avoid heavy work in decorators; register metadata only.
- Deduplicate auto‑components; use composition over inheritance for complicated stacks.
- Keep method wrappers pure: call original and emit/update afterwards.
