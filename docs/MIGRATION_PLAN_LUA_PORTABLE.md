# Stappenplan: Portable Lua Architectuur voor BMSX

Dit document beschrijft een migratie naar een **portable Lua architectuur** die:
1. Geen JS-specifieke builtins vereist (`array()`, `table.fromnative()`)
2. Standaard Lua 5.4 / LuaJIT compatible is
3. Serialization ondersteunt via Lua tables
4. Native engine code (C++/TS) alleen via een clean FFI boundary aanspreekt

---

## Deel 1: Probleem Analyse

### 1.1 Huidige JS-Lua Coupling

**Problematische patronen in huidige code:**

```lua
-- Game code (cart.lua) - JS-AWARE!
local positions = array({ 10, 20, 30 })        -- BMSX-specific builtin
spawn_sprite('hero', { pos = positions })       -- Implicit table→JS conversion

-- FSM state handlers krijgen JS objects
entering_state = function(self)
    local obj = world_object(some_id)           -- Returns LuaNativeValue wrapper
    obj.x = 100                                 -- Metatable proxies naar JS
end
```

**JS-specifieke constructies in `luaruntime.ts`:**

| Construct | Probleem | Standaard Lua equivalent |
|-----------|----------|--------------------------|
| `array()` | Maakt JS Array, niet Lua table | Gewoon `{1, 2, 3}` |
| `LuaNativeValue` | JS object wrapper met metatable | Userdata met C API |
| `table.fromnative()` | JS Array → Lua table | Niet nodig |
| `type(x) == 'native'` | JS-specifiek type | `type(x) == 'userdata'` |
| Implicit conversions | Tables ↔ JS objects | Expliciete marshalling |

### 1.2 Serialization Coupling

**Huidige `@insavegame` systeem:**
- TypeScript classes met decorators
- `Reviver.constructors` registry
- `RevivableObjectArgs` voor constructor signature
- Binary/JSON encoding met reference tracking

**Probleem voor C++ port:**
- Decorators zijn TS-only
- Class instantiation via `new Ctor({ constructReason: 'revive' })`
- Prototype chain walking voor exclusion rules

### 1.3 Native Objects die Native moeten blijven

| Object | Reden |
|--------|-------|
| `World` | ECS orchestration, space management, physics |
| `Space` | Object indexing, depth sorting |
| `CameraObject` | 3D math, render pipeline integration |
| `LightObject` | Shader uniforms, shadow maps |
| `Serializer/Reviver` | Binary encoding, reference graphs |
| `ECSystemManager` | Per-frame iteration, cache-friendly |
| `StateMachineController` | State transitions, tick dispatch |

---

## Deel 2: Doel Architectuur

### 2.1 Clean Boundary Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PORTABLE LUA LAYER                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Game Code (cart.lua)                                             │  │
│  │  - Pure Lua tables voor data                                      │  │
│  │  - Geen platform-specifieke builtins                              │  │
│  │  - Standaard Lua 5.4 semantiek                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                  │                                      │
│                                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  System ROM (Lua)                                                 │  │
│  │  - WorldObject/Component base "classes" (metatables)              │  │
│  │  - Lifecycle hooks interface                                       │  │
│  │  - Event registration helpers                                      │  │
│  │  - Serialization protocol (table ↔ binary)                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                  │                                      │
│                                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Engine FFI Layer                                                 │  │
│  │  TypeScript: vm_ffi.ts          C++: lua_ffi.cpp                  │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │  engine.spawn(class_id, props)  │  lua_engine_spawn()            │  │
│  │  engine.despawn(handle)         │  lua_engine_despawn()          │  │
│  │  engine.get_property(h, k)      │  lua_engine_get_prop()         │  │
│  │  engine.set_property(h, k, v)   │  lua_engine_set_prop()         │  │
│  │  engine.emit(event, payload)    │  lua_engine_emit()             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NATIVE ENGINE                                   │
│  TypeScript (browser)              │  C++ (RetroArch/libretro)          │
│  ─────────────────────────────────────────────────────────────────────  │
│  World, Space, Registry            │  World, Space, Registry            │
│  ECS Systems (hot loops)           │  ECS Systems (SIMD)                │
│  FSM tick/transitions              │  FSM tick/transitions              │
│  Render (WebGL/WebGPU)             │  Render (OpenGL/Vulkan)            │
│  Audio (WebAudio)                  │  Audio (platform API)              │
│  Serializer (binary)               │  Serializer (binary)               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

**Object Creation:**
```
Lua: Hero:new({ x = 10, y = 20 })
  │
  ▼
System ROM: WorldObject:new()
  │ - Genereert unique id
  │ - Bouwt Lua table met defaults
  │ - Roept engine.create_object(class_id, props)
  ▼
FFI: engine.create_object('Hero', { x=10, y=20, id='hero_1' })
  │
  ▼
Native: new WorldObject({ id: 'hero_1' })
  │ - Registreert in Registry
  │ - Returned handle (of id)
  ▼
Lua: self._handle = handle
```

**Property Access (hot path):**
```
Lua: obj.x = 100
  │
  ▼ (metatable __newindex)
FFI: engine.set_property(handle, 'x', 100)
  │
  ▼
Native: Registry.get(handle).x = 100
```

**Lifecycle Hooks:**
```
Native: Space.spawn(obj, pos)
  │
  ▼
Native: World.dispatchWorldLifecycleSlot(obj, 'spawn', ctx)
  │
  ▼
HandlerRegistry: registry.get('woclass.Hero.spawn').call(obj, ctx)
  │
  ▼ (stub → impl)
FFI: lua_call_handler(handler_ref, args)
  │
  ▼
Lua: Hero:onspawn(pos)
```

---

## Deel 3: Migratie Fasen

### Fase 1: FFI Abstractie Layer

**Doel:** Introduceer een `engine` global die alle native calls abstraheert.

#### Stap 1.1: Creëer `src/bmsx/vm/vm_ffi.ts`

```typescript
/**
 * FFI Layer - Clean boundary tussen Lua en Native Engine
 *
 * Dit is de ENIGE plek waar Lua↔Native conversie plaatsvindt.
 * Alle functies zijn portable: dezelfde signatures in C++.
 */

import { $ } from '../core/engine_core';
import { WorldObject } from '../core/object/worldobject';
import { Registry } from '../core/registry';
import { HandlerRegistry } from '../core/handlerregistry';
import type { LuaTable } from '../lua/luavalue';

export type Handle = number;

// Object handle registry (integer → WorldObject)
const handles = new Map<Handle, WorldObject>();
const objectToHandle = new Map<WorldObject, Handle>();
let nextHandle = 1;

function allocHandle(obj: WorldObject): Handle {
    const h = nextHandle++;
    handles.set(h, obj);
    objectToHandle.set(obj, h);
    return h;
}

function freeHandle(h: Handle): void {
    const obj = handles.get(h);
    if (obj) objectToHandle.delete(obj);
    handles.delete(h);
}

function getObject(h: Handle): WorldObject {
    const obj = handles.get(h);
    if (!obj) throw new Error(`Invalid handle: ${h}`);
    return obj;
}

/**
 * FFI Functions - exposed to Lua via engine.* table
 */
export const EngineFfi = {
    /**
     * Create a native WorldObject and return its handle.
     * Properties from `props` table are applied to the instance.
     */
    create_object(class_id: string, props: LuaTable): Handle {
        const id = props.get('id') as string ?? undefined;
        const obj = new WorldObject({ id, constructReason: undefined });

        // Apply properties from Lua table
        for (const [key, value] of props.entries()) {
            if (key === 'id') continue;
            (obj as any)[key] = convertLuaToNative(value);
        }

        return allocHandle(obj);
    },

    /**
     * Spawn object into active space.
     */
    spawn(handle: Handle, x?: number, y?: number, z?: number): void {
        const obj = getObject(handle);
        const pos = (x !== undefined) ? { x, y: y ?? 0, z: z ?? 0 } : undefined;
        $.world.spawn(obj, pos, { reason: 'fresh' });
    },

    /**
     * Despawn and dispose object.
     */
    despawn(handle: Handle): void {
        const obj = getObject(handle);
        obj.mark_for_disposal();
        freeHandle(handle);
    },

    /**
     * Get property value from native object.
     */
    get_prop(handle: Handle, key: string): unknown {
        const obj = getObject(handle);
        return convertNativeToLua((obj as any)[key]);
    },

    /**
     * Set property value on native object.
     */
    set_prop(handle: Handle, key: string, value: unknown): void {
        const obj = getObject(handle);
        (obj as any)[key] = convertLuaToNative(value);
    },

    /**
     * Call a method on native object.
     */
    call_method(handle: Handle, method: string, ...args: unknown[]): unknown {
        const obj = getObject(handle);
        const fn = (obj as any)[method];
        if (typeof fn !== 'function') {
            throw new Error(`Method '${method}' not found on object`);
        }
        const nativeArgs = args.map(convertLuaToNative);
        return convertNativeToLua(fn.apply(obj, nativeArgs));
    },

    /**
     * Register a Lua function as handler for lifecycle/event slot.
     */
    register_handler(slot_id: string, handler_ref: number): void {
        // handler_ref is a Lua registry reference to the function
        // Implementation calls back into Lua when handler is invoked
        // ...
    },

    /**
     * Emit event to native event system.
     */
    emit(event_name: string, scope: string, payload: LuaTable): void {
        const nativePayload = convertLuaToNative(payload);
        $.emit(event_name, scope as any, nativePayload);
    },

    /**
     * Query world for objects matching predicate.
     */
    query_objects(space_id?: string): Handle[] {
        const space = space_id ? $.world.getSpace(space_id) : $.world.activeSpace;
        return space.objects.map(obj => {
            let h = objectToHandle.get(obj);
            if (h === undefined) h = allocHandle(obj);
            return h;
        });
    },

    // ... more FFI functions
};

// Conversion helpers
function convertLuaToNative(value: unknown): unknown {
    // LuaTable → plain object/array
    // Primitives pass through
    // ...
}

function convertNativeToLua(value: unknown): unknown {
    // WorldObject → handle
    // Arrays → Lua table (1-indexed)
    // Objects → Lua table
    // ...
}
```

#### Stap 1.2: Registreer `engine` table in Lua globals

In `vm_tooling_runtime.ts`:

```typescript
private registerEngineFfi(): void {
    const engineTable = createLuaTable();

    for (const [name, fn] of Object.entries(EngineFfi)) {
        engineTable.set(name, new LuaNativeFunction(name, (args) => {
            const result = fn(...args);
            return result === undefined ? [] : [result];
        }));
    }

    this.interpreter.globals.set('engine', engineTable);
}
```

---

### Fase 2: System ROM Lua Modules

**Doel:** WorldObject/Component "classes" in pure Lua die FFI gebruiken.

#### Stap 2.1: Creëer `src/bmsx/res/code/core/class.lua`

```lua
-- Minimal OOP helper (geen external dependencies)
local Class = {}

function Class.extend(base, definition)
    local class = definition or {}
    class.__index = class

    if base then
        setmetatable(class, { __index = base })
    end

    function class:new(...)
        local instance = setmetatable({}, class)
        if instance.init then
            instance:init(...)
        end
        return instance
    end

    return class
end

function Class.is_instance(obj, class)
    local mt = getmetatable(obj)
    while mt do
        if mt == class then return true end
        mt = getmetatable(mt)
        if mt then mt = mt.__index end
    end
    return false
end

return Class
```

#### Stap 2.2: Creëer `src/bmsx/res/code/core/worldobject.lua`

```lua
local Class = require('core.class')

-- Counter voor unieke IDs
local id_counter = 0
local function next_id(prefix)
    id_counter = id_counter + 1
    return (prefix or 'obj') .. '_' .. id_counter
end

---@class WorldObject
---@field _handle number Native engine handle
---@field id string Unique identifier
---@field x number
---@field y number
---@field z number
---@field visible boolean
---@field active boolean
local WorldObject = Class.extend(nil, {
    -- Class defaults
    __class_id = 'WorldObject',
    visible = true,
    active = false,
})

-- Property mapping: welke properties naar native gaan
WorldObject.__native_props = {
    x = true, y = true, z = true,
    visible = true, active = true,
    direction = true, hittable = true,
}

-- Metatable voor property access naar native engine
local function create_proxy_metatable(class)
    return {
        __index = function(self, key)
            -- Check class hierarchy first
            local value = rawget(class, key)
            if value ~= nil then return value end

            -- Native property?
            if class.__native_props[key] and self._handle then
                return engine.get_prop(self._handle, key)
            end

            return nil
        end,

        __newindex = function(self, key, value)
            -- Native property?
            if class.__native_props[key] and self._handle then
                engine.set_prop(self._handle, key, value)
                return
            end

            -- Store locally
            rawset(self, key, value)
        end,
    }
end

function WorldObject:init(opts)
    opts = opts or {}

    -- Generate ID
    self.id = opts.id or next_id(self.__class_id)

    -- Collect initial properties for native
    local props = { id = self.id }
    for key, _ in pairs(self.__native_props) do
        local value = opts[key]
        if value == nil then value = self[key] end  -- Class default
        if value ~= nil then props[key] = value end
    end

    -- Create native object
    self._handle = engine.create_object(self.__class_id, props)

    -- Store Lua-only properties locally
    for key, value in pairs(opts) do
        if not self.__native_props[key] and key ~= 'id' then
            rawset(self, key, value)
        end
    end

    -- Apply proxy metatable
    setmetatable(self, create_proxy_metatable(getmetatable(self).__index or self))
end

-- Lifecycle hooks (override in subclasses)
function WorldObject:onspawn(pos) end
function WorldObject:ondespawn() end
function WorldObject:tick(dt) end
function WorldObject:dispose() end

-- Spawn into world
function WorldObject:spawn(x, y, z)
    engine.spawn(self._handle, x, y, z)
    self.active = true
    self:onspawn({ x = x, y = y, z = z })
end

-- Mark for disposal
function WorldObject:destroy()
    self:ondespawn()
    engine.despawn(self._handle)
    self._handle = nil
    self.active = false
end

-- Extend to create subclass
function WorldObject:extend(definition)
    local class = Class.extend(self, definition)
    class.__class_id = definition.class_id or ('LuaClass_' .. next_id('class'))

    -- Merge native props
    class.__native_props = {}
    for k, v in pairs(self.__native_props) do
        class.__native_props[k] = v
    end
    if definition.native_props then
        for k, v in pairs(definition.native_props) do
            class.__native_props[k] = v
        end
    end

    return class
end

return WorldObject
```

#### Stap 2.3: Creëer `src/bmsx/res/code/core/spriteobject.lua`

```lua
local WorldObject = require('core.worldobject')

---@class SpriteObject : WorldObject
local SpriteObject = WorldObject:extend({
    class_id = 'SpriteObject',

    -- Extra native props voor sprites
    native_props = {
        sprite_id = true,
        frame = true,
        flip_x = true,
        flip_y = true,
        scale_x = true,
        scale_y = true,
        rotation = true,
        tint = true,
    },

    -- Defaults
    sprite_id = nil,
    frame = 0,
    flip_x = false,
    flip_y = false,
    scale_x = 1,
    scale_y = 1,
    rotation = 0,
})

function SpriteObject:set_sprite(sprite_id, frame)
    self.sprite_id = sprite_id
    if frame then self.frame = frame end
end

function SpriteObject:set_frame(frame)
    self.frame = frame
end

return SpriteObject
```

#### Stap 2.4: Creëer `src/bmsx/res/code/core/component.lua`

```lua
local Class = require('core.class')

---@class Component
---@field _handle number Native component handle
---@field parent WorldObject Parent object
---@field enabled boolean
local Component = Class.extend(nil, {
    __component_type = 'Component',
    enabled = true,
})

function Component:init(opts)
    opts = opts or {}
    self.parent = opts.parent
    self.enabled = opts.enabled ~= false

    if self.parent and self.parent._handle then
        self._handle = engine.attach_component(
            self.parent._handle,
            self.__component_type,
            opts
        )
    end
end

function Component:on_attach() end
function Component:on_detach() end
function Component:tick(dt) end

function Component:detach()
    if self._handle then
        engine.detach_component(self._handle)
        self._handle = nil
    end
    self:on_detach()
end

function Component:extend(definition)
    local class = Class.extend(self, definition)
    class.__component_type = definition.component_type or 'LuaComponent'
    return class
end

return Component
```

---

### Fase 3: Serialization Protocol

**Doel:** Lua tables kunnen serializen/deserializen zonder TS class dependencies.

#### Stap 3.1: Creëer `src/bmsx/res/code/core/serialization.lua`

```lua
--[[
    Serialization Protocol voor Lua Objects

    Format: Lua table met __type marker
    {
        __type = 'Hero',
        __handle = 123,  -- Native handle (excluded from save)
        id = 'hero_1',
        x = 100,
        y = 200,
        health = 50,
        inventory = { 'sword', 'shield' },
    }
]]

local Serialization = {}

-- Registry van class constructors
local class_registry = {}

function Serialization.register_class(class_id, class)
    class_registry[class_id] = class
end

function Serialization.get_class(class_id)
    return class_registry[class_id]
end

-- Excluded keys (niet serializen)
local excluded_keys = {
    _handle = true,
    __index = true,
    __newindex = true,
}

-- Serialize object naar plain table
function Serialization.serialize(obj)
    if type(obj) ~= 'table' then
        return obj
    end

    local result = {}

    -- Type marker
    local mt = getmetatable(obj)
    if mt and mt.__index and mt.__index.__class_id then
        result.__type = mt.__index.__class_id
    end

    -- Copy fields recursively
    for key, value in pairs(obj) do
        if not excluded_keys[key] and type(key) == 'string' then
            result[key] = Serialization.serialize(value)
        end
    end

    -- Numeric array entries
    for i = 1, #obj do
        result[i] = Serialization.serialize(obj[i])
    end

    return result
end

-- Deserialize table naar typed object
function Serialization.deserialize(data)
    if type(data) ~= 'table' then
        return data
    end

    -- Recursively deserialize children first
    local processed = {}
    for key, value in pairs(data) do
        if key ~= '__type' then
            processed[key] = Serialization.deserialize(value)
        end
    end

    -- Instantiate typed object
    local type_id = data.__type
    if type_id then
        local class = class_registry[type_id]
        if class then
            -- Create via revive constructor
            processed.constructReason = 'revive'
            local obj = class:new(processed)
            return obj
        end
    end

    return processed
end

-- Encode naar binary (calls native)
function Serialization.to_binary(data)
    local serialized = Serialization.serialize(data)
    return engine.encode_binary(serialized)
end

-- Decode from binary (calls native)
function Serialization.from_binary(binary)
    local data = engine.decode_binary(binary)
    return Serialization.deserialize(data)
end

return Serialization
```

#### Stap 3.2: Update WorldObject met serialization support

```lua
-- In worldobject.lua, add:
local Serialization = require('core.serialization')

function WorldObject:init(opts)
    opts = opts or {}

    -- Revive path
    if opts.constructReason == 'revive' then
        self.id = opts.id
        -- Re-create native handle
        local props = { id = self.id }
        for key, _ in pairs(self.__native_props) do
            if opts[key] ~= nil then props[key] = opts[key] end
        end
        self._handle = engine.create_object(self.__class_id, props)

        -- Restore Lua-only state
        for key, value in pairs(opts) do
            if not self.__native_props[key] and key ~= 'id' and key ~= 'constructReason' then
                rawset(self, key, value)
            end
        end

        setmetatable(self, create_proxy_metatable(getmetatable(self).__index or self))
        return
    end

    -- Fresh creation (existing code)
    -- ...
end

-- Register class voor deserialization
Serialization.register_class('WorldObject', WorldObject)
```

---

### Fase 4: Handler Registration Bridge

**Doel:** Lua lifecycle hooks registreren via HandlerRegistry.

#### Stap 4.1: Creëer `src/bmsx/res/code/core/handlers.lua`

```lua
--[[
    Handler Registration Bridge

    Koppelt Lua methods aan native HandlerRegistry slots.
]]

local Handlers = {}

-- Store registered handlers for cleanup
local registered = {}

-- Register lifecycle handler voor een class
function Handlers.register_lifecycle(class_id, slot, handler)
    local slot_id = 'woclass.' .. class_id .. '.' .. slot
    local ref = engine.register_handler(slot_id, handler)
    registered[slot_id] = ref
    return ref
end

-- Register instance-specific handler
function Handlers.register_instance(object_id, slot, handler)
    local slot_id = 'wo.' .. object_id .. '.' .. slot
    local ref = engine.register_handler(slot_id, handler)
    registered[slot_id] = ref
    return ref
end

-- Subscribe to event slot (multicast)
function Handlers.subscribe(slot_id, handler, opts)
    opts = opts or {}
    return engine.subscribe_handler(slot_id, handler, opts.priority or 0, opts.once or false)
end

-- Unregister handler
function Handlers.unregister(slot_id)
    local ref = registered[slot_id]
    if ref then
        engine.unregister_handler(slot_id, ref)
        registered[slot_id] = nil
    end
end

-- Auto-register lifecycle hooks when class is defined
function Handlers.register_class_hooks(class)
    local class_id = class.__class_id

    if class.onspawn and class.onspawn ~= class.__base_onspawn then
        Handlers.register_lifecycle(class_id, 'spawn', function(ctx)
            local obj = Handlers.get_lua_object(ctx.object_id)
            if obj then obj:onspawn(ctx.position) end
        end)
    end

    if class.ondespawn and class.ondespawn ~= class.__base_ondespawn then
        Handlers.register_lifecycle(class_id, 'despawn', function(ctx)
            local obj = Handlers.get_lua_object(ctx.object_id)
            if obj then obj:ondespawn() end
        end)
    end

    if class.dispose and class.dispose ~= class.__base_dispose then
        Handlers.register_lifecycle(class_id, 'dispose', function(ctx)
            local obj = Handlers.get_lua_object(ctx.object_id)
            if obj then obj:dispose() end
        end)
    end
end

-- Lua object tracking (id → Lua instance)
local lua_objects = {}

function Handlers.track_object(obj)
    lua_objects[obj.id] = obj
end

function Handlers.untrack_object(obj)
    lua_objects[obj.id] = nil
end

function Handlers.get_lua_object(id)
    return lua_objects[id]
end

return Handlers
```

---

### Fase 5: Verwijder JS-specifieke Builtins

**Doel:** `array()` en `table.fromnative()` volledig verwijderen.

#### Stap 5.1: Audit alle game code voor `array()` gebruik

```bash
grep -r "array(" src/carts/ src/ella2023/ src/testrom/
```

#### Stap 5.2: Migreer naar pure Lua tables

**Voor:**
```lua
local positions = array({ 10, 20, 30 })
spawn_sprite('hero', { components = array({ 'collider', 'health' }) })
```

**Na:**
```lua
local positions = { 10, 20, 30 }
spawn_sprite('hero', { components = { 'collider', 'health' } })
```

#### Stap 5.3: Update FFI conversions

In `vm_ffi.ts`, handle Lua tables correctly:

```typescript
function convertLuaToNative(value: unknown): unknown {
    if (isLuaTable(value)) {
        const table = value as LuaTable;

        // Check if array-like (sequential numeric keys starting at 1)
        const length = table.numericLength();
        if (length > 0) {
            const arr: unknown[] = [];
            for (let i = 1; i <= length; i++) {
                arr.push(convertLuaToNative(table.get(i)));
            }
            return arr;
        }

        // Object-like
        const obj: Record<string, unknown> = {};
        for (const [key, val] of table.entries()) {
            if (typeof key === 'string') {
                obj[key] = convertLuaToNative(val);
            }
        }
        return obj;
    }

    // Primitives pass through
    return value;
}
```

#### Stap 5.4: Verwijder `array()` en `table.fromnative()` builtins

In `luaruntime.ts`, verwijder volledig:
- De `array()` builtin registratie
- De `table.fromnative()` functie uit tableLibrary

---

### Fase 6: System ROM File Structure

```
src/bmsx/res/code/
├── system_program.lua          # Entry point, bootstraps modules
├── core/
│   ├── class.lua               # OOP helper
│   ├── worldobject.lua         # WorldObject base
│   ├── spriteobject.lua        # SpriteObject extends WorldObject
│   ├── textobject.lua          # TextObject extends WorldObject
│   ├── component.lua           # Component base
│   ├── handlers.lua            # HandlerRegistry bridge
│   └── serialization.lua       # Save/load protocol
├── components/
│   ├── collider.lua            # Collider2DComponent wrapper
│   ├── timeline.lua            # TimelineComponent wrapper
│   └── actioneffect.lua        # ActionEffectComponent wrapper
└── util/
    ├── vector.lua              # vec2/vec3 helpers
    └── table.lua               # Table utilities
```

---

## Deel 4: Codex Execution Checklist

### Prerequisites
- [ ] Lees en begrijp `src/bmsx/vm/vm_api.ts`
- [ ] Lees en begrijp `src/bmsx/lua/luaruntime.ts` (initializeBuiltins)
- [ ] Lees en begrijp `src/bmsx/core/handlerregistry.ts`
- [ ] Lees en begrijp `src/bmsx/serializer/gameserializer.ts`

### Fase 1: FFI Layer
- [ ] 1.1: Creëer `src/bmsx/vm/vm_ffi.ts` met EngineFfi object
- [ ] 1.2: Registreer `engine` table in `vm_tooling_runtime.ts`
- [ ] 1.3: Implementeer handle management (alloc/free/get)
- [ ] 1.4: Implementeer `convertLuaToNative()` en `convertNativeToLua()`
- [ ] 1.5: Unit tests voor FFI layer

### Fase 2: System ROM Modules
- [ ] 2.1: Creëer `src/bmsx/res/code/core/class.lua`
- [ ] 2.2: Creëer `src/bmsx/res/code/core/worldobject.lua`
- [ ] 2.3: Creëer `src/bmsx/res/code/core/spriteobject.lua`
- [ ] 2.4: Creëer `src/bmsx/res/code/core/component.lua`
- [ ] 2.5: Update `system_program.lua` om modules te laden

### Fase 3: Serialization
- [ ] 3.1: Creëer `src/bmsx/res/code/core/serialization.lua`
- [ ] 3.2: Voeg FFI functions toe: `engine.encode_binary()`, `engine.decode_binary()`
- [ ] 3.3: Update WorldObject met revive support
- [ ] 3.4: Integration test: save/load cycle

### Fase 4: Handler Bridge
- [ ] 4.1: Creëer `src/bmsx/res/code/core/handlers.lua`
- [ ] 4.2: Voeg FFI functions toe: `engine.register_handler()`, `engine.subscribe_handler()`
- [ ] 4.3: Update WorldObject:extend() om hooks te registreren
- [ ] 4.4: Test lifecycle hooks (spawn/despawn/dispose)

### Fase 5: Cleanup
- [ ] 5.1: Audit `array()` usage in all game code
- [ ] 5.2: Migreer naar pure Lua tables
- [ ] 5.3: Verwijder `array()` builtin uit luaruntime.ts
- [ ] 5.4: Verwijder `table.fromnative()` uit luaruntime.ts
- [ ] 5.5: Update FFI converters voor automatic table handling

### Fase 6: Validation
- [ ] 6.1: Build engine: `npx tsc --build ./src/bmsx`
- [ ] 6.2: Build testrom: `npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname testrom --force`
- [ ] 6.3: Run headless test: `npm run headless:game testrom`
- [ ] 6.4: Build 2025: `npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname 2025 --force`
- [ ] 6.5: Run headless test: `npm run headless:game 2025`

---

## Deel 5: C++ Port Considerations

Met deze architectuur is de C++ port straightforward:

| TypeScript | C++ Equivalent |
|------------|----------------|
| `vm_ffi.ts` | `lua_ffi.cpp` - Lua C API bindings |
| `EngineFfi.create_object()` | `lua_engine_create_object()` |
| Handle registry | `std::unordered_map<int, WorldObject*>` |
| `LuaTable` | `lua_State* L` + stack operations |
| `convertLuaToNative()` | `lua_to_native()` via `lua_type()` switch |

De Lua code (`worldobject.lua`, etc.) werkt **ongewijzigd** op LuaJIT.

---

## Belangrijke Notities

1. **Performance**: Property access via metatables heeft overhead. Voor hot paths (ECS iteration), gebruik native systems die direct op WorldObject properties werken.

2. **Memory**: Lua objects houden handles naar native objects. Bij Lua GC moet native handle vrijgegeven worden via weak references of explicit cleanup.

3. **Debugging**: FFI boundary maakt debugging lastiger. Voeg logging toe aan FFI calls tijdens development.
