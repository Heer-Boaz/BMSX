# Lua Portability Migration Plan

Goal: make the Lua runtime portable to C++ (RetroArch/libretro) while keeping the same Lua API for scripts.

Core rule
- We do NOT support overriding or wrapping existing native C++ member functions from Lua. Attempting to wrap C++ methods requires unsafe vtable manipulation or changing native class layouts and is non-portable.

Behaviour of `applyClassAddons`
- The runtime function `applyClassAddons` applies Lua-provided class members to a constructed native instance with the following policy:
  1. If a key corresponds to an existing native property or method on the instance, it is SKIPPED (no override, no wrapping).
 2. Otherwise the key/value pair is stored in the instance's dynamic field map (e.g. `m_runtimeFields` / `setDynamicProperty`) as a Lua-only property or function.

Notes and rationale
- This prevents accidental shadowing of native behaviour and avoids any need for function-wrapping tricks in C++.
- If scripts must extend native behaviour in a controlled way, add explicit C++ extension points (pre/post hooks or documented callback slots) implemented in C++ and intentionally exposed to Lua.

Example: native lifecycle in C++ (no Lua override)
```cpp
void WorldObject::onspawn(const Vec3* pos, SpawnReason reason) {
    if (pos) setPos(*pos);
    if (reason == SpawnReason::Fresh) activate();
    // native lifecycle ends here; Lua cannot implicitly override this method
}
```

Example: `applyClassAddons` behaviour (C++ sketch)
```cpp
void LuaRuntime::applyClassAddons(WorldObject* instance, Table* classTable) {
    if (!classTable) return;

    for (auto& [key, value] : classTable->entries()) {
        if (excludedClassOverrideKeys.contains(key)) continue;

        // Skip names that map to native properties or methods
        if (!isNil(instance->getRuntimeProperty(key))) continue;

        // Store as Lua-only dynamic field
        instance->setDynamicProperty(key, value);
    }
}
```

Validation checklist
- [ ] Ensure `applyClassAddons` skip-check uses `getRuntimeProperty` or equivalent to detect existing native members.
- [ ] Ensure native lifecycle methods do their work and are not silently overridden by Lua.
- [ ] Convert native entry points (TextObject.setText, etc.) to accept Lua tables/iterables at the native boundary so Lua-side helpers are unnecessary.
- [ ] Remove JS-only runtime helpers (`array()`, `table.fromnative()`) after native conversions are complete.

Summary
- Do not attempt to wrap or override native C++ functions from Lua. Use `applyClassAddons` to attach Lua-only fields and explicitly add C++ extension points where altering native behaviour is required.
