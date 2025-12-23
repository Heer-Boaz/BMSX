# Lua Portability Migration Plan

## Goal
Make the Lua VM portable to C++ for RetroArch/libretro while keeping the **exact same Lua API**.

## Key Insight: Events Instead of Method Overrides

The old approach tried to override `onspawn()` methods, which required complex wrapping logic. The new approach:

1. **Native methods emit events** - `WorldObject.onspawn()` does its work then emits `'spawn'` event
2. **Scripts subscribe to events** - Lua `on_spawn` handlers are registered as event listeners
3. **Native always runs first** - No risk of breaking engine lifecycle

This is **trivially portable to C++** because event systems are simple.

## Current API (UNCHANGED)

```lua
define_world_object({
    def_id = "player",
    class = {
        on_spawn = function(self, event)
            -- called AFTER native onspawn completes
            setup_collision(self)
            self:define_timeline(...)
        end,
        on_despawn = function(self, event)
            -- cleanup
        end,
    },
    fsms = { "player_fsm" },
    components = { "Collider2DComponent" }
})

spawn_object("player", { pos = { x = 100, y = 50 } })
```

## Implementation (DONE)

### WorldObject.ts

```typescript
public onspawn(spawningPos?: vec3, opts?: { reason?: SpawnReason }): void {
    // Native logic - always runs
    if (spawningPos) { ... }
    if (reason === 'fresh') this.activate();

    // Emit event for scripts
    this.events.emit('spawn', { pos: spawningPos, reason });
}

public ondespawn(): void {
    this.active = false;
    this.eventhandling_enabled = false;
    this.events.emit('despawn');
}
```

### vm_api.ts

```typescript
const eventHandlerKeys: Record<string, string> = {
    'on_spawn': 'spawn',
    'on_despawn': 'despawn',
};

private applyClassOverrides<T>(instance: T, classTable?: ...): void {
    for (const [key, value] of Object.entries(classTable)) {
        const eventName = eventHandlerKeys[key];
        if (eventName && typeof value === 'function' && instance.events) {
            // Register as event listener instead of method override
            instance.events.on({
                event: eventName,
                subscriber: instance,
                handler: (event) => value.call(instance, instance, event),
            });
            continue;
        }
        // ... regular property handling
    }
}
```

## C++ Port

The C++ version is straightforward:

```cpp
void WorldObject::onspawn(vec3* pos, SpawnReason reason) {
    if (pos) { x = pos->x; y = pos->y; z = pos->z; }
    if (reason == SpawnReason::Fresh) activate();

    // Emit event - EventPort is simple to port
    events.emit("spawn", { {"pos", pos}, {"reason", reason} });
}
```

No complex function wrapping, no vtable hacks, no string-based method dispatch.

## Remaining Cleanup

### Remove JS-specific builtins
- [ ] Remove `array()` from `luaruntime.ts`
- [ ] Remove `table.fromnative()` from `luaruntime.ts`
- [ ] Audit native functions to return Lua tables instead of JS arrays

### Validation
- [x] `npm run headless:game testcart` passes
- [ ] Run full test suite
