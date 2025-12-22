# Stappenplan: Migratie Core Engine Objects naar Lua (System ROM)

Dit document beschrijft een gedetailleerd, door Codex uitvoerbaar stappenplan voor het migreren van WorldObject/Component definities, game-specifieke logic en event handlers naar Lua als onderdeel van de System ROM.

---

## Overzicht Architectuur

### Huidige situatie
```
┌─────────────────────────────────────────────────────────────────┐
│  TypeScript Engine (native)                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  WorldObject    │  │  Component      │  │  FSM Core       │  │
│  │  (class)        │  │  (class)        │  │  (tick/trans)   │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      vm_api.ts                              ││
│  │  - define_world_object() → worldObjectExts Map              ││
│  │  - spawn_object() → new WorldObject() + applyOverrides      ││
│  │  - applyClassOverrides() → Object.assign()                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Game ROM (Lua)                                                 │
│  - define_world_object({ def_id, class = { onspawn, run } })   │
│  - define_fsm(id, { states = {...} })                          │
│  - spawn_object('hero.def')                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Doelsituatie
```
┌─────────────────────────────────────────────────────────────────┐
│  TypeScript Engine (native) - ALLEEN HOT PATHS                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ ECS Systems     │  │ FSM Tick/Trans  │  │ Render Pipeline │  │
│  │ (per-frame)     │  │ (native speed)  │  │ (WebGL/WebGPU)  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Native API Surface (vm_native_api.ts)                      ││
│  │  - create_native_world_object(class_id) → handle            ││
│  │  - set_property(handle, key, value)                         ││
│  │  - HandlerRegistry.get(slot_id).call()                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│  System ROM (Lua) - CORE OBJECT DEFINITIONS                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ worldobject.lua │  │ component.lua   │  │ abilities.lua   │  │
│  │ - WorldObject   │  │ - Component     │  │ - AbilityBase   │  │
│  │ - SpriteObject  │  │ - Collider2D    │  │ - DamageEffect  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ behaviortree.lua│  │ eventhandlers.lua│                      │
│  │ - BTNode        │  │ - on_spawn      │                       │
│  │ - Selector      │  │ - on_despawn    │                       │
│  └─────────────────┘  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Game ROM (Lua) - GAME-SPECIFIC CONTENT                         │
│  - Hero = WorldObject:extend({ ... })                          │
│  - enemy_fsm = { states = {...} }                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fase 1: System ROM Infrastructuur

### Stap 1.1: Multi-file Lua ondersteuning in System ROM

**Doel:** Uitbreiden van de engine om meerdere `.lua` bestanden in de System ROM te ondersteunen.

**Bestanden aan te passen:**
- `src/bmsx/res/manifest/manifest.rommanifest`
- `scripts/rompacker/rompacker-core.ts`

**Acties:**

1. **Pas `manifest.rommanifest` aan** om meerdere Lua entry points te ondersteunen:
```json
{
  "lua": {
    "entry_path": "res/code/system_program.lua",
    "modules": [
      "res/code/core/worldobject.lua",
      "res/code/core/component.lua",
      "res/code/core/events.lua",
      "res/code/abilities/ability_base.lua",
      "res/code/ai/behaviortree.lua"
    ]
  }
}
```

2. **Pas `rompacker-core.ts` aan** om de `modules` array te verwerken:
   - Zoek naar de sectie die `lua.entry_path` verwerkt
   - Voeg iteratie toe over `lua.modules` array
   - Pack elk module-bestand als apart Lua chunk in de ROM

3. **Pas `vm_tooling_runtime.ts` aan** om modules te laden:
   - Voeg `loadSystemModules()` methode toe
   - Roep aan vóór `loadEntryPoint()`

### Stap 1.2: Lua Module Loader

**Doel:** `require()` functionaliteit voor Lua modules.

**Nieuw bestand:** `src/bmsx/res/code/core/module_loader.lua`

```lua
-- Module loader voor System ROM
local _loaded = {}
local _loading = {}

function require(module_name)
    if _loaded[module_name] then
        return _loaded[module_name]
    end
    if _loading[module_name] then
        error("Circular dependency detected: " .. module_name)
    end
    _loading[module_name] = true
    local chunk = _G["__modules"][module_name]
    if not chunk then
        error("Module not found: " .. module_name)
    end
    local result = chunk()
    _loaded[module_name] = result or true
    _loading[module_name] = nil
    return _loaded[module_name]
end
```

**Aanpassing `vm_tooling_runtime.ts`:**
- Registreer `__modules` tabel met compiled chunks
- Expose `require` als native functie

---

## Fase 2: WorldObject/Component naar Lua

### Stap 2.1: Native Handle System

**Doel:** Lua tables die native WorldObject instances wrappen via handles.

**Nieuw bestand:** `src/bmsx/vm/native_handle_registry.ts`

```typescript
export class NativeHandleRegistry {
    private static nextHandle = 1;
    private static readonly handles = new Map<number, WorldObject>();
    private static readonly objectToHandle = new WeakMap<WorldObject, number>();

    public static register(obj: WorldObject): number {
        const existing = this.objectToHandle.get(obj);
        if (existing !== undefined) return existing;
        const handle = this.nextHandle++;
        this.handles.set(handle, obj);
        this.objectToHandle.set(obj, handle);
        return handle;
    }

    public static get(handle: number): WorldObject {
        return this.handles.get(handle);
    }

    public static release(handle: number): void {
        const obj = this.handles.get(handle);
        if (obj) {
            this.objectToHandle.delete(obj);
            this.handles.delete(handle);
        }
    }
}
```

### Stap 2.2: Lua WorldObject Base Class

**Nieuw bestand:** `src/bmsx/res/code/core/worldobject.lua`

```lua
-- WorldObject base class voor Lua
-- Native properties worden via handles benaderd

local WorldObject = {}
WorldObject.__index = WorldObject

-- Class registry voor extend()
local _class_registry = {}

function WorldObject:new(opts)
    opts = opts or {}
    local instance = setmetatable({}, self)

    -- Vraag native handle aan
    instance._native_handle = _native_create_world_object(self.__class_id or 'WorldObject')

    -- Pas defaults toe
    if self.__defaults then
        for k, v in pairs(self.__defaults) do
            instance[k] = v
        end
    end

    -- Pas opts toe
    for k, v in pairs(opts) do
        instance[k] = v
    end

    return instance
end

function WorldObject:extend(definition)
    local class = setmetatable({}, { __index = self })
    class.__index = class
    class.__class_id = definition.class_id or ('LuaClass_' .. tostring(#_class_registry + 1))
    class.__defaults = definition.defaults or {}

    -- Kopieer methodes
    for k, v in pairs(definition) do
        if k ~= 'defaults' and k ~= 'class_id' then
            class[k] = v
        end
    end

    _class_registry[class.__class_id] = class
    return class
end

-- Property accessors die doorverwijzen naar native handle
function WorldObject:get_x()
    return _native_get_property(self._native_handle, 'x')
end

function WorldObject:set_x(value)
    _native_set_property(self._native_handle, 'x', value)
end

-- Convenience property syntax via __index/__newindex
local mt = getmetatable(WorldObject) or {}
mt.__index = function(t, k)
    local getter = rawget(t, 'get_' .. k)
    if getter then return getter(t) end
    return rawget(t, k)
end
mt.__newindex = function(t, k, v)
    local setter = rawget(t, 'set_' .. k)
    if setter then setter(t, v) return end
    rawset(t, k, v)
end
setmetatable(WorldObject, mt)

-- Lifecycle hooks (te overriden door subclasses)
function WorldObject:onspawn(pos) end
function WorldObject:ondespawn() end
function WorldObject:dispose() end
function WorldObject:tick(dt) end

-- Handler registration
function WorldObject:_register_handlers()
    local class_id = self.__class_id
    if self.onspawn ~= WorldObject.onspawn then
        register_handler('woclass.' .. class_id .. '.spawn', self.onspawn, {
            module = class_id,
            symbol = 'onspawn',
            category = 'world'
        })
    end
end

return WorldObject
```

### Stap 2.3: Native API Bridge voor Properties

**Aanpassing `src/bmsx/vm/vm_api.ts`:**

Voeg toe aan `BmsxVMApi` class:

```typescript
// Native handle operations
public _native_create_world_object(class_id: string): number {
    const instance = new WorldObject({ id: undefined, constructReason: undefined });
    return NativeHandleRegistry.register(instance);
}

public _native_get_property(handle: number, key: string): unknown {
    const obj = NativeHandleRegistry.get(handle);
    return (obj as any)[key];
}

public _native_set_property(handle: number, key: string, value: unknown): void {
    const obj = NativeHandleRegistry.get(handle);
    (obj as any)[key] = value;
}

public _native_call_method(handle: number, method: string, ...args: unknown[]): unknown {
    const obj = NativeHandleRegistry.get(handle);
    const fn = (obj as any)[method];
    return fn.apply(obj, args);
}

public _native_spawn(handle: number, pos?: vec3): void {
    const obj = NativeHandleRegistry.get(handle);
    $.world.spawn(obj, pos, { reason: 'fresh' });
}
```

### Stap 2.4: Component Base Class in Lua

**Nieuw bestand:** `src/bmsx/res/code/core/component.lua`

```lua
local Component = {}
Component.__index = Component

local _component_types = {}

function Component:new(opts)
    local instance = setmetatable({}, self)
    instance._native_handle = _native_create_component(self.__component_type or 'Component', opts.parent_handle)
    return instance
end

function Component:extend(definition)
    local class = setmetatable({}, { __index = self })
    class.__index = class
    class.__component_type = definition.component_type

    for k, v in pairs(definition) do
        if k ~= 'component_type' then
            class[k] = v
        end
    end

    _component_types[class.__component_type] = class
    return class
end

-- Lifecycle
function Component:on_attach() end
function Component:on_detach() end
function Component:tick(dt) end

return Component
```

---

## Fase 3: Event Handler Registratie via HandlerRegistry

### Stap 3.1: Lua-side Handler Registration API

**Nieuw bestand:** `src/bmsx/res/code/core/events.lua`

```lua
-- Event handler registration voor Lua
-- Werkt samen met HandlerRegistry in TypeScript

local Events = {}

-- Registreer een handler voor een specifiek slot
-- @param slot_id: bijv. 'woclass.Hero.spawn' of 'global.spawn'
-- @param handler: function(context) -> result
-- @param meta: { module, symbol, category?, target? }
function Events.register(slot_id, handler, meta)
    meta = meta or {}
    meta.module = meta.module or 'lua'
    meta.symbol = meta.symbol or 'anonymous'
    return _native_register_handler(slot_id, handler, meta)
end

-- Subscribe to event slot (multicast)
-- @param slot_id: event slot identifier
-- @param handler: function(context) -> result
-- @param opts: { priority?, once?, module, symbol }
function Events.subscribe(slot_id, handler, opts)
    opts = opts or {}
    opts.module = opts.module or 'lua'
    opts.symbol = opts.symbol or 'subscriber'
    return _native_subscribe_handler(slot_id, handler, opts)
end

-- Emit event
function Events.emit(event_name, scope, payload)
    _native_emit_event(event_name, scope, payload)
end

-- Stop propagation sentinel
Events.STOP = '__handler_stop__'

return Events
```

### Stap 3.2: Native Handler Bridge

**Aanpassing `src/bmsx/vm/vm_api.ts`:**

```typescript
public _native_register_handler(
    slot_id: string,
    handler: LuaFunctionValue,
    meta: { module: string; symbol: string; category?: string; target?: object }
): LuaFunctionValue {
    // Wrap Lua function in GenericHandler
    const wrappedHandler: GenericHandler = function(this: any, ...args: any[]) {
        const result = handler.call(args);
        if (result === 'STOP' || result?.value === '__handler_stop__') {
            return HandlerRegistry.STOP;
        }
        return result;
    };

    const desc: HandlerDescriptor = {
        id: slot_id,
        category: (meta.category as HandlerCategory) ?? 'other',
        target: meta.target,
        source: {
            lang: 'lua',
            module: meta.module,
            symbol: meta.symbol,
        }
    };

    return HandlerRegistry.instance.register(desc, wrappedHandler);
}

public _native_subscribe_handler(
    slot_id: string,
    handler: LuaFunctionValue,
    opts: { priority?: number; once?: boolean; module: string; symbol: string }
): () => void {
    const wrappedHandler: GenericHandler = function(this: any, ...args: any[]) {
        return handler.call(args);
    };

    return subscribeLua(slot_id, wrappedHandler, {
        module: opts.module,
        symbol: opts.symbol,
    }, {
        priority: opts.priority,
        once: opts.once,
    });
}
```

---

## Fase 4: Abilities en AI Behavior Trees

### Stap 4.1: Ability Base Class

**Nieuw bestand:** `src/bmsx/res/code/abilities/ability_base.lua`

```lua
local Events = require('core.events')

local Ability = {}
Ability.__index = Ability

function Ability:extend(definition)
    local class = setmetatable({}, { __index = self })
    class.__index = class
    class.id = definition.id
    class.cooldown = definition.cooldown or 0
    class.cost = definition.cost or 0

    for k, v in pairs(definition) do
        class[k] = v
    end

    return class
end

function Ability:new(owner_handle)
    local instance = setmetatable({}, self)
    instance.owner_handle = owner_handle
    instance.cooldown_remaining = 0
    return instance
end

-- Override these in subclasses
function Ability:can_activate()
    return self.cooldown_remaining <= 0
end

function Ability:activate()
    -- Implement in subclass
end

function Ability:tick(dt)
    if self.cooldown_remaining > 0 then
        self.cooldown_remaining = self.cooldown_remaining - dt
    end
end

return Ability
```

### Stap 4.2: Behavior Tree Nodes in Lua

**Nieuw bestand:** `src/bmsx/res/code/ai/behaviortree.lua`

```lua
-- Behavior Tree implementation for Lua
-- Note: Tree execution happens native-side for performance
-- Lua defines the tree structure and leaf behaviors

local BT = {}

-- Node types
BT.SUCCESS = 1
BT.FAILURE = 2
BT.RUNNING = 3

-- Base node
local Node = {}
Node.__index = Node

function Node:new()
    return setmetatable({}, self)
end

function Node:tick(blackboard)
    return BT.SUCCESS
end

-- Selector (OR)
local Selector = setmetatable({}, { __index = Node })
Selector.__index = Selector

function Selector:new(children)
    local instance = setmetatable({}, self)
    instance.children = children or {}
    return instance
end

function Selector:tick(blackboard)
    for _, child in ipairs(self.children) do
        local status = child:tick(blackboard)
        if status ~= BT.FAILURE then
            return status
        end
    end
    return BT.FAILURE
end

-- Sequence (AND)
local Sequence = setmetatable({}, { __index = Node })
Sequence.__index = Sequence

function Sequence:new(children)
    local instance = setmetatable({}, self)
    instance.children = children or {}
    return instance
end

function Sequence:tick(blackboard)
    for _, child in ipairs(self.children) do
        local status = child:tick(blackboard)
        if status ~= BT.SUCCESS then
            return status
        end
    end
    return BT.SUCCESS
end

-- Action (leaf that calls Lua function)
local Action = setmetatable({}, { __index = Node })
Action.__index = Action

function Action:new(fn)
    local instance = setmetatable({}, self)
    instance.fn = fn
    return instance
end

function Action:tick(blackboard)
    return self.fn(blackboard)
end

-- Condition (leaf that checks condition)
local Condition = setmetatable({}, { __index = Node })
Condition.__index = Condition

function Condition:new(predicate)
    local instance = setmetatable({}, self)
    instance.predicate = predicate
    return instance
end

function Condition:tick(blackboard)
    if self.predicate(blackboard) then
        return BT.SUCCESS
    end
    return BT.FAILURE
end

-- Export
BT.Node = Node
BT.Selector = Selector
BT.Sequence = Sequence
BT.Action = Action
BT.Condition = Condition

-- Register tree definition (compiles to native)
function BT.define(id, root_node)
    _native_define_behavior_tree(id, root_node)
end

return BT
```

---

## Fase 5: System ROM Directory Structure

### Stap 5.1: Creëer Directory Structuur

```
src/bmsx/res/code/
├── system_program.lua          # Entry point (bestaand)
├── core/
│   ├── module_loader.lua       # require() implementatie
│   ├── worldobject.lua         # WorldObject base class
│   ├── component.lua           # Component base class
│   ├── sprite.lua              # SpriteObject extends WorldObject
│   ├── textobject.lua          # TextObject extends WorldObject
│   └── events.lua              # Event handler registration
├── abilities/
│   ├── ability_base.lua        # Ability base class
│   └── effect_types.lua        # Common effect implementations
├── ai/
│   ├── behaviortree.lua        # BT node definitions
│   └── blackboard.lua          # Blackboard utilities
└── util/
    ├── vector.lua              # vec2/vec3 utilities
    └── math.lua                # Math helpers
```

### Stap 5.2: Update system_program.lua

```lua
-- System Program - Bootstrap voor BMSX Engine
-- Laadt core modules en initialiseert de runtime

-- Bootstrap module loader eerst
local module_loader = require('core.module_loader')

-- Laad core modules
local WorldObject = require('core.worldobject')
local Component = require('core.component')
local Events = require('core.events')

-- Laad ability system
local Ability = require('abilities.ability_base')

-- Laad AI system
local BT = require('ai.behaviortree')

-- Export naar global scope voor games
_G.WorldObject = WorldObject
_G.Component = Component
_G.Events = Events
_G.Ability = Ability
_G.BT = BT

-- System globals
local message = "insert cart"

local function draw_insert_cart()
    cls(4)
    local width = display_width()
    local height = display_height()
    local text_width = #message * 6
    local x = math.floor((width - text_width) / 2)
    local y = math.floor((height - 8) / 2)
    write(message, x, y, 0, 15)
end

function init()
    -- System initialization
end

function new_game()
    -- Called when cart is loaded
end

function update(dt)
    if peek(SYS_CART_PRESENT) == 1 then
        poke(SYS_BOOT_CART, 1)
    end
end

function draw()
    draw_insert_cart()
end
```

---

## Fase 6: Integratie en Migratie Bestaande Code

### Stap 6.1: Backwards Compatibility Layer

**Aanpassing `src/bmsx/vm/vm_api.ts`:**

De bestaande `define_world_object`, `spawn_object`, etc. blijven werken maar delegeren nu naar het nieuwe systeem:

```typescript
public define_world_object(descriptor: EntityExtensions): void {
    // Registreer in bestaande map voor TypeScript compatibility
    this.worldObjectExts.set(descriptor.def_id, descriptor);

    // Registreer ook in Lua class registry als class table aanwezig is
    if (descriptor.class) {
        this._runtime.callLuaFunction('__register_world_object_class', [
            descriptor.def_id,
            descriptor.class,
            descriptor.defaults,
            descriptor.fsms,
            descriptor.components,
            descriptor.effects,
            descriptor.bts,
        ]);
    }
}
```

### Stap 6.2: Migratie Checklist per Game

Voor elke game ROM (bijv. `2025`, `testcart`):

1. **Identificeer WorldObject definities:**
   - Zoek alle `define_world_object({ ... })` calls
   - Noteer welke `class` overrides ze hebben

2. **Converteer naar Lua class syntax:**
   ```lua
   -- Oud:
   define_world_object({
       def_id = 'hero.def',
       class = { id = 'hero', onspawn = function(self) ... end },
       fsms = { 'hero.fsm' },
   })

   -- Nieuw:
   local Hero = WorldObject:extend({
       class_id = 'hero.def',
       defaults = { ... },
       onspawn = function(self, pos)
           -- lifecycle hook
       end,
   })
   Hero:_register_handlers()
   ```

3. **Update spawn calls:**
   ```lua
   -- Oud:
   spawn_object('hero.def', { pos = { x = 10, y = 20 } })

   -- Nieuw (optie A - factory function):
   Hero:spawn({ x = 10, y = 20 })

   -- Nieuw (optie B - blijft werken via compatibility layer):
   spawn_object('hero.def', { pos = { x = 10, y = 20 } })
   ```

---

## Fase 7: Testing en Validatie

### Stap 7.1: Unit Tests voor Lua Modules

**Nieuw bestand:** `tests/lua/worldobject_lua.test.ts`

```typescript
import { describe, test, expect } from 'vitest';
import { BmsxVMRuntime } from '../../src/bmsx/vm/vm_tooling_runtime';

describe('Lua WorldObject', () => {
    test('extend creates subclass with correct metatable', async () => {
        const runtime = new BmsxVMRuntime(/* config */);
        await runtime.loadSystemModules();

        const result = runtime.executeLua(`
            local WorldObject = require('core.worldobject')
            local Hero = WorldObject:extend({
                class_id = 'test.hero',
                defaults = { health = 100 }
            })
            local h = Hero:new()
            return h.health
        `);

        expect(result).toBe(100);
    });

    test('native handle bridges property access', async () => {
        const runtime = new BmsxVMRuntime(/* config */);
        await runtime.loadSystemModules();

        const result = runtime.executeLua(`
            local WorldObject = require('core.worldobject')
            local obj = WorldObject:new({ id = 'test' })
            obj.x = 50
            return obj.x
        `);

        expect(result).toBe(50);
    });
});
```

### Stap 7.2: Integration Test met testrom

```bash
# Build en test
npm run headless:game testrom
```

Verwachte output: Geen regressies, alle bestaande functionaliteit werkt.

---

## Fase 8: Performance Optimalisaties

### Stap 8.1: Property Access Caching

Om de overhead van native calls te minimaliseren:

```lua
-- In worldobject.lua
local _property_cache = setmetatable({}, { __mode = 'k' })

function WorldObject:_cache_property(key, value)
    local cache = _property_cache[self]
    if not cache then
        cache = {}
        _property_cache[self] = cache
    end
    cache[key] = value
end

function WorldObject:_get_cached(key)
    local cache = _property_cache[self]
    return cache and cache[key]
end
```

### Stap 8.2: Batch Property Updates

```typescript
// In vm_api.ts
public _native_set_properties_batch(handle: number, props: Record<string, unknown>): void {
    const obj = NativeHandleRegistry.get(handle);
    Object.assign(obj, props);
}
```

---

## Codex Execution Checklist

Voor Codex om dit stappenplan uit te voeren:

### Prerequisites
- [ ] Lees `src/bmsx/vm/vm_api.ts` volledig
- [ ] Lees `src/bmsx/vm/vm_tooling_runtime.ts` volledig
- [ ] Lees `src/bmsx/core/handlerregistry.ts`
- [ ] Lees `scripts/rompacker/rompacker-core.ts`

### Fase 1 Tasks
- [ ] 1.1.1: Update `manifest.rommanifest` met modules array
- [ ] 1.1.2: Update `rompacker-core.ts` om modules te packen
- [ ] 1.1.3: Update `vm_tooling_runtime.ts` met `loadSystemModules()`
- [ ] 1.2.1: Creëer `src/bmsx/res/code/core/module_loader.lua`
- [ ] 1.2.2: Registreer `require` functie in VM API

### Fase 2 Tasks
- [ ] 2.1.1: Creëer `src/bmsx/vm/native_handle_registry.ts`
- [ ] 2.2.1: Creëer `src/bmsx/res/code/core/worldobject.lua`
- [ ] 2.3.1: Voeg native API bridge methods toe aan `vm_api.ts`
- [ ] 2.4.1: Creëer `src/bmsx/res/code/core/component.lua`

### Fase 3 Tasks
- [ ] 3.1.1: Creëer `src/bmsx/res/code/core/events.lua`
- [ ] 3.2.1: Voeg handler bridge methods toe aan `vm_api.ts`

### Fase 4 Tasks
- [ ] 4.1.1: Creëer `src/bmsx/res/code/abilities/ability_base.lua`
- [ ] 4.2.1: Creëer `src/bmsx/res/code/ai/behaviortree.lua`

### Fase 5 Tasks
- [ ] 5.1.1: Creëer directory structuur
- [ ] 5.2.1: Update `system_program.lua`

### Fase 6 Tasks
- [ ] 6.1.1: Voeg backwards compatibility layer toe
- [ ] 6.2.1: Migreer `testrom` als proof of concept

### Fase 7 Tasks
- [ ] 7.1.1: Creëer unit tests
- [ ] 7.2.1: Run integration tests

### Validatie Commands
```bash
# Build engine
npx tsc --build ./src/bmsx

# Build testrom
npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname testrom --force

# Run headless test
npm run headless:game testrom
```

---

## Belangrijke Notities voor Codex

1. **Geen breaking changes in Fase 1-5**: De bestaande `define_world_object` API moet blijven werken.

2. **FSM blijft native**: Zoals besproken, de FSM core (`tick()`, state transitions) blijft in TypeScript. Alleen de handler callbacks worden via HandlerRegistry aan Lua gekoppeld.

3. **Performance-kritieke paden**:
   - ECS system loops → blijven native
   - Render pipeline → blijft native
   - Physics/collision → blijft native
   - Object creation/lifecycle → kan Lua zijn (cold path)

4. **File naming**: Lua bestanden lowercase, TypeScript classes PascalCase.

5. **Geen `require` in game code voor nu**: Games gebruiken de global exports (`WorldObject`, `Component`, etc.) die `system_program.lua` exposed.
