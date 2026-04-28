-- worldobject.lua
-- base class for all world objects (game entities)
--
-- DESIGN PRINCIPLES — object lifecycle and event subscription
--
-- 1. OBJECT LIFECYCLE ORDER.
--    new()        — allocates the object and its components; no event
--                   subscriptions here; the object is not yet active.
--    onspawn()    — called by world:spawn() after position is set from pos.
--                   Override for spawn-time setup.  No super call needed.
--    activate()   — called by world:spawn() after onspawn().  Sets
--                   active = true, calls bind(), then starts the FSM.
--    bind()       — override this in subclasses to subscribe to events.
--                   Called exactly once per activation.
--    ondespawn()  — called when removed from the world; deactivates the object.
--    dispose()    — final teardown; calls unbind() which removes all event
--                   subscriptions whose `subscriber` field is this object.
--
-- 2. bind() / unbind() — event subscription lifecycle.
--    All external event subscriptions must be registered inside bind(), not
--    in ctor / new().  Every subscription must set `subscriber = self` so
--    that the default unbind() can clean them up automatically via
--    remove_subscriber(self).
--
--    WRONG — subscribing in ctor (fires before object is active/ready):
--      function myobj:ctor()
--          self.events:on({ event = 'something', handler = function() ... end })
--      end
--    RIGHT — subscribing in bind():
--      function myobj:bind()
--          self.events:on({ event = 'something', emitter = 'src',
--              subscriber = self, handler = function() ... end })
--      end
--
--    Override unbind() only when you need extra cleanup beyond event
--    unsubscription (e.g. releasing external resources).  Always call
--    super's unbind via remove_subscriber if you do override it:
--      function myobj:unbind()
--          eventemitter.eventemitter.instance:remove_subscriber(self)  -- base
--          -- additional cleanup ...
--      end
--
-- 3. NEVER CALL METHODS ON OTHER OBJECTS DIRECTLY FROM bind().
--    Subscriptions in bind() establish reactive wiring.  Do not reach into
--    other objects to mutate their state at bind()-time.  Emit an event and
--    let the other object respond, or use the FSM entering_state for
--    initialisation that must happen on activate.
--
-- 4. DESTROY VIA mark_for_disposal(), NEVER via world:despawn() from update/events.
--    world:despawn() is only safe to call outside of the world's update loop
--    (e.g. during a room transition that stops the world first). From inside
--    an object's event handler, always use:
--      self:mark_for_disposal()
--    This deactivates the object immediately and defers the actual world removal
--    to the end-of-frame cleanup pass, which is safe.
--
-- 5. set_space() IS NOT despawn. Use it only to temporarily hide/show objects.
--    Moving an object to a non-active space hides it from gameplay queries
--    without destroying it (components, subscriptions, and FSM persist).
--    Pattern: move enemies to 'transition' during screen transitions, not despawn.
local eventemitter<const> = require('bios/eventemitter')
local fsm<const> = require('bios/fsm/index')
local fsmlibrary<const> = require('bios/fsm/library')
local components<const> = require('bios/components')
local behaviourtree<const> = require('bios/behaviourtree')
local world_instance<const> = require('bios/world/index').instance
local registry_instance<const> = require('bios/registry').instance

local worldobject<const> = {}
worldobject.__index = worldobject

local world_id_max<const> = 0x7fffffff
local collision_linked_component_types<const> = {
	spritecomponent = true,
	collider2dcomponent = true,
}

local component_key<const> = function(type_or_name)
	local t<const> = type(type_or_name)
	if t == 'string' then
		return string.lower(type_or_name)
	end
	if t == 'table' then
		local name<const> = type_or_name.type_name or type_or_name.typename or type_or_name.name
		if name == nil then
			error('worldobject component key table is missing type name')
		end
		return string.lower(name)
	end
	return string.lower(tostring(type_or_name))
end

local rebuild_collision_sprite_links<const> = function(self)
	local sprite_bucket<const> = self.component_map.spritecomponent
	local collider_bucket<const> = self.component_map.collider2dcomponent
	local primary_sprite = self.sprite_component
	local primary_collider = self.collider
	if primary_sprite == nil or primary_sprite.parent ~= self then
		if sprite_bucket ~= nil then
			primary_sprite = sprite_bucket[1]
		else
			primary_sprite = nil
		end
	end
	if primary_collider == nil or primary_collider.parent ~= self then
		if collider_bucket ~= nil then
			primary_collider = collider_bucket[1]
		else
			primary_collider = nil
		end
	end
	self._collision_primary_sprite = primary_sprite
	self._collision_primary_collider = primary_collider
	local map<const> = self._collision_driving_sprites
	for key in pairs(map) do
		map[key] = nil
	end
	if sprite_bucket == nil then
		return
	end
	for i = 1, #sprite_bucket do
		local sprite<const> = sprite_bucket[i]
		local collider_local_id<const> = sprite.collider_local_id
		if collider_local_id ~= nil then
			map[collider_local_id] = sprite
		end
	end
end

function worldobject.new(opts)
	opts = opts or {}
	local self<const> = setmetatable({}, worldobject)
	self.type_name = opts.type_name or 'worldobject'
	self.id = opts.id or world_instance:next_id(self.type_name)
	self:set_pos(opts.x or 0, opts.y or 0, opts.z or 0)
	self.sx = opts.sx or 0
	self.sy = opts.sy or 0
	self.sz = opts.sz or 0
	self.visible = opts.visible or true
	self.active = false
	self.tick_order = opts.tick_order or 'normal'
	self.fsm_dispatch_enabled = false
	self.player_index = opts.player_index
	self.tags = opts.tags or {}
	self.components = {}
	self.component_map = {}
	self.space_id = opts.space_id
	self.dispose_flag = false
	self.events = eventemitter.events_of(self)
	local definition<const> = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	self.btreecontexts = {}
	self.btree_ids = {}
	self.transform_component = nil
	self._collision_primary_sprite = nil
	self._collision_primary_collider = nil
	self._collision_driving_sprites = {}

	self.timelines = components.timelinecomponent.new({})
	self:add_component(self.timelines)
	return self
end

-- set_pos(x, y, z?): sets world position. Each component falls back to the
-- current value when nil, so set_pos(x, y) preserves the current z.
function worldobject:set_pos(x, y, z)
	self.x = x or self.x
	self.y = y or self.y
	self.z = z or self.z
end

-- set_space(space_id): moves this object into the named world space.
--   Useful for temporarily hiding an object from the active space (e.g. moving
--   enemies to a 'transition' space during a screen-transition animation and
--   back to 'main' on exit).  The object stays alive and subscribed; it is
--   simply excluded from the default active world queries.
--
--   PATTERN (enemies during shrine transition):
--     self.events:on('shrine_transition_enter', function()
--       self:set_space('transition')
--     end)
--     self.events:on('shrine_transition_exit', function()
--       self:set_space('main')
--     end)
function worldobject:set_space(space_id)
	return world_instance:set_object_space(self, space_id)
end

-- add_component(comp): attach a component to this object.
-- comp.bind() is called immediately; comp.on_attach() fires after binding.
-- Returns the component for chaining.  Components are updated by ECS systems,
-- as the object lacks its own update() method.
function worldobject:add_component(comp)
	comp.parent = self
	if not comp.id then
		comp.id = components.component.generate_id(comp)
	end
	local key<const> = component_key(comp.type_name or comp)
	local bucket = self.component_map[key]
	if not bucket then
		bucket = {}
		self.component_map[key] = bucket
	end
	if comp.unique and #bucket > 0 then
		error('component "' .. (comp.type_name or key) .. '" is unique and already attached to "' .. self.id .. '"')
	end
	table.insert(self.components, comp)
	bucket[#bucket + 1] = comp
	comp:bind()
	comp:on_attach()
	registry_instance:register(comp)
	if self.active then
		world_instance:activate_component(comp)
	end
	if comp.type_name == 'timelinecomponent' then
		self.timelines = comp
	end
	if comp.type_name == 'transformcomponent' then
		self.transform_component = comp
	end
	if comp.type_name == 'actioneffectcomponent' then
		self.actioneffects = comp
	end
	if comp.type_name == 'abilitiescomponent' then
		self.abilities = comp
	end
	if collision_linked_component_types[comp.type_name] then
		rebuild_collision_sprite_links(self)
	end

	return comp
end

function worldobject:get_component(type_name)
	local key<const> = component_key(type_name)
	local list<const> = self.component_map[key]
	return list and list[1]
end

function worldobject:get_components(type_name)
	local key<const> = component_key(type_name)
	return self.component_map[key] or {}
end

function worldobject:get_unique_component(type_name)
	local list<const> = self.component_map[component_key(type_name)]
	if not list or #list == 0 then
		return nil
	end
	if #list > 1 then
		error('multiple "' .. component_key(type_name) .. '" components attached to "' .. self.id .. '"')
	end
	return list[1]
end

function worldobject:has_component(type_name)
	local key<const> = component_key(type_name)
	local list<const> = self.component_map[key]
	return list and #list > 0
end

function worldobject:get_component_by_id(id)
	for _, c in ipairs(self.components) do
		if c.id == id or c.id_local == id then
			return c
		end
	end
	return nil
end

function worldobject:get_component_by_local_id(type_name, id_local)
	for _, c in ipairs(self.components) do
		if c.id_local == id_local and component_key(c.type_name) == component_key(type_name) then
			return c
		end
	end
	return nil
end

function worldobject:get_component_at(type_name, index)
	local list<const> = self.component_map[component_key(type_name)]
	return list and list[index + 1]
end

function worldobject:find_component(predicate, type_name)
	local list<const> = type_name and self:get_components(type_name) or self.components
	for i = 1, #list do
		local c<const> = list[i]
		if predicate(c, i) then
			return c
		end
	end
	return nil
end

function worldobject:find_components(predicate, type_name)
	local list<const> = type_name and self:get_components(type_name) or self.components
	local out<const> = {}
	for i = 1, #list do
		local c<const> = list[i]
		if predicate(c, i) then
			out[#out + 1] = c
		end
	end
	return out
end

function worldobject:remove_components(type_name)
	local key<const> = component_key(type_name)
	local list<const> = self.component_map[key]
	if not list then
		return
	end
	for i = #list, 1, -1 do
		self:remove_component_instance(list[i])
	end
end

function worldobject:remove_component_instance(comp)
	local key<const> = component_key(comp.type_name or comp)
	local list<const> = self.component_map[key]
	if list then
		for i = #list, 1, -1 do
			if list[i] == comp then
				table.remove(list, i)
				break
			end
		end
		if #list == 0 then
			self.component_map[key] = nil
		end
	end
	for i = #self.components, 1, -1 do
		if self.components[i] == comp then
			table.remove(self.components, i)
			break
		end
	end
	comp:on_detach()
	comp:unbind()
	if self.active then
		world_instance:deactivate_component(comp)
	end
	registry_instance:deregister(comp, true)
	if comp == self.sprite_component then
		self.sprite_component = nil
	end
	if comp == self.collider then
		self.collider = nil
	end
	if comp == self.transform_component then
		self.transform_component = nil
	end
	if collision_linked_component_types[comp.type_name] then
		rebuild_collision_sprite_links(self)
	end
end

function worldobject:remove_all_components()
	for i = #self.components, 1, -1 do
		self:remove_component_instance(self.components[i])
	end
end


-- has_tag(tag): returns true if this object currently carries the given tag.
-- Tags are plain-string keys set on self.tags.  The FSM also manages tags
-- automatically through state `tags` declarations and timeline windows.
function worldobject:has_tag(tag)
	return (self.tags[tag])
end

function worldobject:add_tag(tag)
	self.tags[tag] = true
end

function worldobject:remove_tag(tag)
	self.tags[tag] = nil
end

function worldobject:toggle_tag(tag)
	self.tags[tag] = not self.tags[tag]
end

-- dispatch_state_event(event_or_name, payload): deliver an event to this
-- object's FSM.  The FSM routes it to the current state's `on` handlers and
-- `input_event_handlers`.  Use this to push external facts into the FSM;
-- do NOT use it to command another object's FSM from the outside — emit a
-- broadcast event instead and let the target subscribe in its own bind().
function worldobject:dispatch_state_event(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

-- dispatch_command(event_or_name, payload): identical to dispatch_state_event.
-- Use this name when the intent is to send a direct command to this object's
-- own FSM from within the same object (e.g. from a child component or timer
-- callback).  Still forbidden for cross-object calls — see dispatch_state_event.
function worldobject:dispatch_command(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

-- emit_gameplay_fact(event_or_name, payload): emit an event on the global bus
-- AND dispatch it into this object's own FSM in one call.  Use this for facts
-- that are both externally observable (other objects may subscribe) and
-- relevant to this object's own state machine (e.g. a 'hit' that triggers both
-- a visual reaction and a health-state transition).  Fields in payload are
-- merged into the event table; emitter is set to self automatically.
function worldobject:emit_gameplay_fact(event_or_name, payload)
	local event
	if type(event_or_name) ~= 'table' then
		local spec<const> = { type = event_or_name, emitter = self, payload = payload }
		event = eventemitter.eventemitter.instance:create_gameevent(spec)
	else
		event = event_or_name
		if event.emitter == nil then
			event.emitter = self
		end
	end
	self.events:emit_event(event)
	self.sc:dispatch(event)
	return event
end

-- activate(): called by world:spawn() after onspawn().  Sets active = true,
-- calls bind(), then starts the FSM.  Do not call directly; spawn the object
-- through the world instead.
function worldobject:activate()
	self.active = true
	self.fsm_dispatch_enabled = true
	world_instance:activate_object(self)
	self:bind()
	self.sc:start()
end

-- bind(): override in subclasses to register event subscriptions.
-- Called once by activate() before the FSM starts.  Always set
-- `subscriber = self` on every subscription so unbind() cleans them up.
function worldobject:bind()
end

-- unbind(): removes all event subscriptions whose subscriber == self.
-- Called by dispose().  Override only if you need extra teardown beyond
-- event unsubscription; in that case call the base implementation first.
function worldobject:unbind()
	eventemitter.eventemitter.instance:remove_subscriber(self)
end

-- deactivate(): stops the object's FSM, update, and timeline playback without
-- removing it from the world.  The object stays registered; its components and
-- event subscriptions are preserved.  Called automatically by mark_for_disposal()
-- and ondespawn().  Do not override; instead react to the 'despawn' event.
function worldobject:deactivate()
	self.active = false
	self.fsm_dispatch_enabled = false
	world_instance:deactivate_object(self)
end

-- onspawn(pos): called by world:spawn() after position is set from pos.
-- Override for spawn-time setup.  Position (x, y, z) is already applied.
-- activate(), bind(), FSM start, and the 'spawn' event are handled
-- automatically by world:spawn() after this returns — no super call needed.
function worldobject:onspawn(pos)
end

-- ondespawn(): called when the object is removed from the world.  Deactivates
-- and emits 'despawn'.  Override for despawn-specific cleanup; always call
-- the supermethod so that the FSM pause and 'despawn' emission still happen.
function worldobject:ondespawn()
	if self.active then
		self:deactivate()
	end
	self.events:emit('despawn')
end

-- mark_for_disposal(): schedules the object for removal at end-of-frame.
--   This is the CORRECT way to destroy an object from inside its own update()
--   or an event handler (where calling world:despawn() directly is unsafe).
--   Sets dispose_flag=true and deactivates the object immediately; the world
--   cleans it up after the current frame finishes.
--
--   WRONG — despawning inside update() or an event handler:
--     world_instance:despawn(self)   -- mutates the object list mid-iteration!
--
--   RIGHT:
--     self:mark_for_disposal()       -- safe, deferred cleanup
function worldobject:mark_for_disposal()
	if self.dispose_flag then
		return
	end
	self.dispose_flag = true
	self:deactivate()
	world_instance._by_id[self.id] = nil
	local space<const> = world_instance._spaces[self.space_id]
	space.by_id[self.id] = nil
	world_instance._obj_to_space[self.id] = nil
	world_instance:queue_object_disposal(self)
end

function worldobject:dispose()
	self.sc:dispose()
	self:remove_all_components()
	self:unbind()
	registry_instance:deregister(self, true)
end

-- define_timeline(def): register a pre-built timeline object on this object.
-- Prefer declaring timelines inside the FSM state's `timelines` block using a
-- plain `def` table — the FSM calls define_timeline() automatically.  Only
-- call this manually for timelines that exist outside any FSM state.
function worldobject:define_timeline(def)
	self.timelines:define(def)
end

-- play_timeline(id, opts): start playback of a previously defined timeline.
-- Prefer setting `autoplay = true` in the FSM timeline binding rather than
-- calling this manually.  Use it directly only when play options are computed
-- at runtime (e.g. a dynamic target index).
-- opts fields: rewind (bool), snap_to_start (bool).
function worldobject:play_timeline(id, opts)
	self.timelines:play(id, opts)
end

-- stop_timeline(id): halt a playing timeline.  Prefer setting
-- `stop_on_exit = true` in the FSM binding.  Call directly only for
-- imperative early-stop logic outside an FSM state transition.
function worldobject:stop_timeline(id)
	self.timelines:stop(id)
end

function worldobject:get_timeline(id)
	return self.timelines:get(id)
end

function worldobject:seek_timeline(id, frame)
	return self.timelines:seek(id, frame)
end

function worldobject:force_seek_timeline(id, frame)
	return self.timelines:force_seek(id, frame)
end

function worldobject:advance_timeline(id)
	return self.timelines:advance(id)
end

function worldobject:add_btree(bt_id)
	local index<const> = #self.btree_ids + 1
	self.btree_ids[index] = bt_id
	local blackboard<const> = behaviourtree.blackboard.new(bt_id)
	self.btreecontexts[bt_id] = {
		tree_id = bt_id,
		running = true,
		root = behaviourtree.instantiate(bt_id),
		blackboard = blackboard,
	}
end

function worldobject:reset_tree(bt_id)
	local context<const> = self.btreecontexts[bt_id]
	context.blackboard:clear_node_data()
end

return worldobject
