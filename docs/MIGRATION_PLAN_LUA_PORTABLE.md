# Lua Portability Migration Plan

Goal: make the Lua VM portable to C++ (RetroArch/libretro) while keeping the same Lua API for scripts.

Core rule
- We do NOT support overriding or wrapping existing native C++ member functions from Lua. Attempting to wrap C++ methods requires unsafe vtable manipulation or changing native class layouts and is non-portable.

Behaviour of `applyClassAddons`
- The VM function `applyClassAddons` applies Lua-provided class members to a constructed native instance with the following policy:
  1. If a key corresponds to an existing native property or method on the instance, it is SKIPPED (no override, no wrapping).
 2. Otherwise the key/value pair is stored in the instance's dynamic field map (e.g. `m_vmFields` / `setDynamicProperty`) as a Lua-only property or function.

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
void LuaVM::applyClassAddons(VMWorldObject* instance, Table* classTable) {
    if (!classTable) return;

    for (auto& [key, value] : classTable->entries()) {
        if (excludedClassOverrideKeys.contains(key)) continue;

        // Skip names that map to native properties or methods
        if (!isNil(instance->getVmProperty(key))) continue;

        // Store as Lua-only dynamic field
        instance->setDynamicProperty(key, value);
    }
}
```

Validation checklist
- [ ] Ensure `applyClassAddons` skip-check uses `getVmProperty` or an explicit `hasNativeProperty` helper.
- [ ] Ensure native lifecycle methods do their work and are not silently overridden by Lua.
- [ ] Convert native entry points (TextObject.setText, etc.) to accept Lua tables/iterables at the native boundary so Lua-side helpers are unnecessary.
- [ ] Remove JS-only runtime helpers (`array()`, `table.fromnative()`) after native conversions are complete.

Summary
- Do not attempt to wrap or override native C++ functions from Lua. Use `applyClassAddons` to attach Lua-only fields and explicitly add C++ extension points where altering native behaviour is required.
# Lua Portability Migration Plan

Goal: make the Lua VM portable to C++ (RetroArch/libretro) while keeping the exact same Lua API surface for scripts.

Key principle
- We must not attempt to wrap or override existing native C++ member functions from Lua. Wrapping C++ methods requires unsafe vtable manipulation or rewriting native class layouts and is not portable.

Design decisions
- Native lifecycle methods (e.g. `WorldObject::onspawn`) run their native behaviour; scripts must not override those methods directly in Lua.
- `applyClassOverrides` in the C++ VM NEVER attempts to wrap native functions. It follows a conservative rule-set:
  1. If the key corresponds to an existing native property or method on the instance, skip it (do not override or wrap).
  2. Otherwise, store the value in the instance's dynamic field map (e.g. `m_vmFields` / `setDynamicProperty`) as a Lua-only property/method.

Rationale
- This avoids silent breakage and preserves native behaviour: native methods remain authoritative and portable.
- If native behaviour needs to be extended, the correct approach is to add explicit extension points in C++ (pre/post hooks or documented callbacks) or provide a deliberate API for script integration. Implicit overrides from Lua are not allowed.

Example: Native world object lifecycle (C++)
```cpp
void WorldObject::onspawn(const Vec3* pos, SpawnReason reason) {
    if (pos) { setPos(*pos); }
    if (reason == SpawnReason::Fresh) activate();
    // No implicit scripting override: native logic ends here.
}
```

Example: `applyClassOverrides` behaviour (C++ sketch)
```cpp
void LuaVM::applyClassOverrides(VMWorldObject* instance, Table* classTable) {
    if (!classTable) return;

    for (auto& [key, value] : classTable->entries()) {
        if (excludedClassOverrideKeys.contains(key)) continue;

        // SKIP any name that already exists as a native property or method on the instance.
        if (!isNil(instance->getVmProperty(key))) {
            continue; // do not override or wrap native behaviour
        }

        // Otherwise, store as Lua-only dynamic field
        instance->setDynamicProperty(key, value);
    }
}
```

Migration notes / recommendations
- Do not add implicit event-based hooks or prefix heuristics in the VM; that increases surface area and portability burden.
- Remove JS-specific builtins (`array()`, `table.fromnative()`) only after native functions consistently return Lua tables and the VM no longer needs JS-specific conversions.
- If you need script-level extension of native lifecycle, add explicit C++ extension points and expose them with clear semantics.

Validation checklist
- [ ] Add/verify `hasNativeProperty` or rely on `getVmProperty` for the skip-check in `applyClassOverrides`.
- [ ] Ensure native lifecycle methods perform their work and are not silently overridden by Lua.
- [ ] Convert TextObject and other native methods to accept Lua tables/iterables at the native boundary (avoid requiring Lua-side conversion helpers).
- [ ] Remove JS-only runtime helpers when native conversion is complete.

Summary
- Do not attempt to wrap existing C++ functions from Lua. Skip native names and store Lua-only fields in the VM's dynamic field map. Use explicit C++ extension points if scripts must alter native behavior.
# Lua Portability Migration Plan

Goal: make the Lua VM portable to C++ (RetroArch/libretro) while keeping the exact same Lua API surface for scripts.

Key principle
- We must not attempt to wrap or override existing native C++ member functions from Lua. Wrapping C++ methods requires unsafe vtable manipulation or rewriting native class layouts and is not portable.

Design decisions
- Native lifecycle methods (e.g. `WorldObject::onspawn`) run their native behaviour and then emit events (e.g. `spawn`).
- Lua handlers subscribe to those events by supplying an explicit `events` subtable in the class descriptor. This avoids prefix heuristics and hardcoded handler name checks.
- `applyClassOverrides` in the C++ VM NEVER attempts to wrap native functions. It follows a conservative rule-set:
  1. If the class descriptor contains an `events` table mapping event names to functions, register each entry as an event listener on the instance.
  2. If the key corresponds to an existing native property or method on the instance, skip it (do not override or wrap).
  3. Otherwise, store the value in the instance's dynamic field map (e.g. `m_vmFields` / `setDynamicProperty`) as a Lua-only property/method.

Rationale
- This avoids silent breakage and preserves native behaviour: native methods remain authoritative and portable.
- Event-based hooks provide the same extension capability as overrides (Lua can run after native logic) but are simple and portable to C++.

Example: Lua class descriptor using explicit events table
```lua
define_world_object({
	def_id = "player",
	class = {
		events = {
			spawn = function(self, event)
				-- called AFTER native spawn completes
				setup_collision(self)
				self:define_timeline(...)
			end,
			despawn = function(self, event)
				-- cleanup
			end,
		},
		fsms = { "player_fsm" },
		components = { "Collider2DComponent" }
	}
})

spawn_object("player", { pos = { x = 100, y = 50 } })
```

Example: Native world object emission (C++)
```cpp
void WorldObject::onspawn(const Vec3* pos, SpawnReason reason) {
	if (pos) { setPos(*pos); }
	if (reason == SpawnReason::Fresh) activate();
	events.emit("spawn", EventPayload::withPosAndReason(pos, reason));
}
```

Example: `applyClassOverrides` behaviour (C++ sketch)
```cpp
void LuaVM::applyClassOverrides(VMWorldObject* instance, Table* classTable) {
	if (!classTable) return;

	// 1) Register explicit event handlers from the `events` table, if present
	if (auto eventsVal = classTable->get("events"); !isNil(eventsVal)) {
		auto eventsTable = std::get<std::shared_ptr<Table>>(eventsVal);
		for (auto& [eventNameVal, handlerVal] : eventsTable->entries()) {
			std::string eventName = asString(eventNameVal);
			if (isFunction(handlerVal)) {
				instance->events.on(eventName, [instance, func = asFunction(handlerVal)](const Event& e){
					func->call({ instance->nativeHandle(), eventToTable(e) });
				});
			}
		}
	}

	// 2) Apply remaining class members as dynamic fields, but SKIP any name that
	//    already exists as a native property or method on the instance to avoid
	//    accidental overrides.
	for (auto& [key, value] : classTable->entries()) {
		if (key == "events") continue;
		if (excludedClassOverrideKeys.contains(key)) continue;
		if (!isNil(instance->getVmProperty(key))) continue; // skip native
		instance->setDynamicProperty(key, value);
	}
}
```

Migration notes / recommendations
- Remove JS-specific builtins (`array()`, `table.fromnative()`) only after native functions consistently return Lua tables and the VM no longer needs JS-specific conversions.
- If you need a safe way for Lua to alter native behaviour beyond events, add explicit C++ extension points (pre/post hooks or configurable callbacks) and document them. Those hooks are implemented in C++ and exposed intentionally; they are not implicit overrides.

Validation checklist
- [ ] Add/verify `hasNativeProperty` or rely on `getVmProperty` for the skip-check in `applyClassOverrides`.
- [ ] Ensure `WorldObject` emits `spawn`/`despawn` and other lifecycle events.
- [ ] Convert TextObject and other native methods to accept Lua tables/iterables at the native boundary (avoid requiring Lua-side conversion helpers).
- [ ] Remove JS-only runtime helpers when native conversion is complete.

Summary
- Do not attempt to wrap existing C++ functions from Lua. Use an explicit `events` subtable for lifecycle hooks, skip native names, and store any other Lua-only fields in the VM's dynamic field map. This keeps the runtime portable and predictable.
