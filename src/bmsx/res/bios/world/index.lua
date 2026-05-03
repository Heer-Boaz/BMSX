local frame_delta_ms<const> = 1000 / machine_manifest.ufps
-- world.lua
-- central world: owns all objects, spaces, and the ECS system manager
--
-- DESIGN PRINCIPLES
--
-- 1. SPACES partition the world into independently-updated subsets.
--    There is always a 'main' space. Add more with world:add_space(id).
--    The 'active' space is set with world:set_space(id); default world queries
--    only see active objects in that space.
--    Use spaces for: UI layer, background layer, loading screens, etc.
--    Objects default to the active space at spawn unless they set .space_id.
--
-- 2. SPAWN / DESPAWN IS THE ONLY WAY TO ADD OR REMOVE OBJECTS.
--    Never add objects to the internal tables directly.
--    world:spawn(obj)         — calls obj:onspawn(), adds to active space
--    world:despawn(id_or_obj) — calls obj:ondespawn() + obj:dispose()
--
-- 3. ACTIVE IS THE DEFAULT QUERY MODE.
--    world:objects(), world:objects_with_components(), world:objects_by_type(),
--    and world:objects_by_tag() all use the current active space by default.
--    Global/live queries use explicit all_* methods instead of options tables.
--
-- 4. world_instance IS THE GLOBAL SINGLETON.
--    Access via  require('world/index').instance. Do not create extra world.new().
--
-- 5. NEVER ITERATE AND MUTATE at the same time.
--    Do not spawn/despawn while iterating world:objects() or world:all_objects().
--    If you need to
--    defer a spawn/despawn, use a queue and process it after the loop.

local ecs<const> = require('bios/ecs/index')
local registry<const> = require('bios/registry')
local vdp_stream<const> = require('bios/vdp_stream')

local tickgroup<const> = ecs.tickgroup
local world_instance
local world_id_max<const> = 0x7fffffff

local world_class<const> = {}
world_class.__index = world_class

local active_component_bucket_types<const> = {
	'actioneffectcomponent',
	'ambientlightcomponent',
	'collider2dcomponent',
	'customvisualcomponent',
	'directionallightcomponent',
	'inputactioneffectcomponent',
	'inputintentcomponent',
	'meshcomponent',
	'pointlightcomponent',
	'positionupdateaxiscomponent',
	'prohibitleavingscreencomponent',
	'screenboundarycomponent',
	'spritecomponent',
	'textcomponent',
	'tilecollisioncomponent',
	'timelinecomponent',
}

local active_component_buckets_mt<const> = {
	__index = function(t, key)
		local bucket<const> = {}
		rawset(t, key, bucket)
		return bucket
	end,
}

local new_active_component_buckets<const> = function()
	local buckets<const> = {}
	for i = 1, #active_component_bucket_types do
		buckets[active_component_bucket_types[i]] = {}
	end
	return setmetatable(buckets, active_component_buckets_mt)
end

-- Active-space iteration is the dominant gameplay path, so it runs directly
-- over the current space object list. The object itself is the control value,
-- which keeps objects() allocation-free and avoids per-iterator state tables.
local iter_active_objects<const> = function(list, obj)
	local index = 1
	if obj ~= nil then
		index = obj._active_object_index + 1
	end
	return list[index]
end

-- All-scope iteration still needs to skip end-of-frame disposals, but it keeps
-- that rule inside its own iterator instead of routing every yielded object
-- through a generic scope helper.
local iter_live_objects<const> = function(list, obj)
	local index = 1
	if obj ~= nil then
		index = obj._world_object_index + 1
	end
	while true do
		local obj<const> = list[index]
		if obj == nil then
			return nil
		end
		if not obj.dispose_flag then
			return obj
		end
		index = index + 1
	end
end

-- objects_with_components(...) is also a frame hot path.
-- The fast path runs over a dense active component list for the current space,
-- so ECS systems do not pay registry bucket traversal and parent/scope
-- filtering cost every frame.
local iter_active_objects_with_components<const> = function(state, _)
	local list<const> = state.list
	local index<const> = state.index + 1
	if index == state.stop then
		return nil
	end
	local entity<const> = list[index]
	state.index = index
	return entity.parent, entity
end

local iter_live_objects_with_components<const> = function(state, _)
	local bucket<const> = state.bucket
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		local parent<const> = entity.parent
		if not parent.dispose_flag then
			state.reg_key = next_key
			return parent, entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_live_subsystems<const> = function(list, subsys)
	local index = 1
	if subsys ~= nil then
		index = subsys._world_subsystem_index + 1
	end
	while true do
		local subsys<const> = list[index]
		if subsys == nil then
			return nil
		end
		if not subsys.dispose_flag then
			return subsys
		end
		index = index + 1
	end
end

local iter_active_subsystems<const> = function(list, subsys)
	local index = 1
	if subsys ~= nil then
		index = subsys._world_subsystem_index + 1
	end
	while true do
		local subsys<const> = list[index]
		if subsys == nil then
			return nil
		end
		if subsys.active then
			return subsys
		end
		index = index + 1
	end
end

local iter_active_world_by_type<const> = function(state, _)
	local bucket<const> = state.bucket
	local by_id<const> = state.by_id
	local active_space_id<const> = state.active_space_id
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		if by_id[entity.id] and entity.active and entity.space_id == active_space_id then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_live_world_by_type<const> = function(state, _)
	local bucket<const> = state.bucket
	local by_id<const> = state.by_id
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		if by_id[entity.id] then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_active_world_by_tag<const> = function(state, _)
	local reg_table<const> = state.reg
	local tag<const> = state.tag
	local by_id<const> = state.by_id
	local active_space_id<const> = state.active_space_id
	local next_key, entity = next(reg_table, state.reg_key)
	while next_key do
		local tags<const> = entity.tags
		if tags and tags[tag] and by_id[entity.id] and entity.active and entity.space_id == active_space_id then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(reg_table, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_live_world_by_tag<const> = function(state, _)
	local reg_table<const> = state.reg
	local tag<const> = state.tag
	local by_id<const> = state.by_id
	local next_key, entity = next(reg_table, state.reg_key)
	while next_key do
		local tags<const> = entity.tags
		if tags and tags[tag] and by_id[entity.id] then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(reg_table, next_key)
	end
	state.reg_key = nil
	return nil
end

local add_space_object<const> = function(obj, space)
	local objects<const> = space.objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._space_object_index = index
end

local remove_space_object<const> = function(obj, space)
	local objects<const> = space.objects
	local index<const> = obj._space_object_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._space_object_index = index
	end
	objects[last_index] = nil
	obj._space_object_index = nil
end

local add_world_object<const> = function(world, obj)
	local objects<const> = world._objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._world_object_index = index
end

local remove_world_object<const> = function(world, obj)
	local objects<const> = world._objects
	local index<const> = obj._world_object_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._world_object_index = index
	end
	objects[last_index] = nil
	obj._world_object_index = nil
end

local add_subsystem<const> = function(world, subsys)
	local subsystems<const> = world._subsystems
	local index<const> = #subsystems + 1
	subsystems[index] = subsys
	subsys._world_subsystem_index = index
end

local remove_subsystem<const> = function(world, subsys)
	local subsystems<const> = world._subsystems
	local index<const> = subsys._world_subsystem_index
	local last_index<const> = #subsystems
	if index < last_index then
		local moved<const> = subsystems[last_index]
		subsystems[index] = moved
		moved._world_subsystem_index = index
	end
	subsystems[last_index] = nil
	subsys._world_subsystem_index = nil
end

local add_active_object<const> = function(obj, space)
	local objects<const> = space.active_objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._active_object_index = index
	obj._active_object_space_id = space.id
	local tick_order<const> = obj.tick_order
	local tick_bucket<const> = space.active_objects_by_tick_order[tick_order]
	local tick_index<const> = #tick_bucket + 1
	tick_bucket[tick_index] = obj
	obj._active_object_tick_order = tick_order
	obj._active_object_tick_order_index = tick_index
end

local remove_active_object<const> = function(obj, space)
	local objects<const> = space.active_objects
	local index<const> = obj._active_object_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._active_object_index = index
	end
	objects[last_index] = nil
	obj._active_object_index = nil
	obj._active_object_space_id = nil
	local tick_order<const> = obj._active_object_tick_order
	local tick_bucket<const> = space.active_objects_by_tick_order[tick_order]
	local tick_index<const> = obj._active_object_tick_order_index
	local tick_last_index<const> = #tick_bucket
	if tick_index < tick_last_index then
		local moved<const> = tick_bucket[tick_last_index]
		tick_bucket[tick_index] = moved
		moved._active_object_tick_order_index = tick_index
	end
	tick_bucket[tick_last_index] = nil
	obj._active_object_tick_order = nil
	obj._active_object_tick_order_index = nil
end

local add_active_component<const> = function(comp, space)
	local bucket<const> = space.active_components_by_type[comp.type_name]
	local index<const> = #bucket + 1
	bucket[index] = comp
	comp._active_component_index = index
	comp._active_component_space_id = space.id
end

local remove_active_component<const> = function(comp, space)
	local bucket<const> = space.active_components_by_type[comp.type_name]
	local index<const> = comp._active_component_index
	local last_index<const> = #bucket
	if index < last_index then
		local moved<const> = bucket[last_index]
		bucket[index] = moved
		moved._active_component_index = index
	end
	bucket[last_index] = nil
	comp._active_component_index = nil
	comp._active_component_space_id = nil
end

function world_class.new()
	local self<const> = setmetatable({}, world_class)
	self._objects = {}
	self._by_id = {}
	self._subsystems = {}
	self._subsystems_by_id = {}
	self._spaces = {}
	self._space_order = {}
	self._obj_to_space = {}
	self._pending_object_disposals = {}
	self._pending_subsystem_disposals = {}
	self._pending_active_objects = {}
	self._pending_active_components = {}
	self.active_space_id = 'main'
	self.active_space = nil
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.gamewidth = machine_manifest.render_size.width
	self.gameheight = machine_manifest.render_size.height
	-- id counter for unique id generation
	self.idcounter = 0
	self:add_space('main')
	self.active_space = self._spaces.main
	return self
end

function world_class:next_id(type_name)
	local baseid<const> = type_name
	local uniquenumber = self.idcounter + 1
	if uniquenumber >= world_id_max then
		uniquenumber = 1
	end

	local result = baseid .. '_' .. tostring(uniquenumber)
	while self._by_id[result] ~= nil or self._subsystems_by_id[result] ~= nil do
		uniquenumber = uniquenumber + 1
		if uniquenumber >= world_id_max then
			uniquenumber = 1
		end
		result = baseid .. '_' .. tostring(uniquenumber)
	end

	self.idcounter = uniquenumber
	return result
end

-- world:add_space(space_id)
--   Registers a new named space. Returns false if the space already exists.
--   Must be called before any object is spawned into that space.
function world_class:add_space(space_id)
	if self._spaces[space_id] ~= nil then
		return false
	end
	self._spaces[space_id] = {
		id = space_id,
		objects = {},
		active_objects = {},
		active_objects_by_tick_order = {
			early = {},
			normal = {},
			late = {},
		},
		by_id = {},
		active_components_by_type = new_active_component_buckets(),
	}
	self._space_order[#self._space_order + 1] = space_id
	return true
end

-- world:set_space(space_id): makes space_id the active space.
--   Objects subsequently spawned without an explicit .space_id go here.
--   Affects the default world query helpers (objects(), objects_with_components()).
function world_class:set_space(space_id)
	if self.active_space_id ~= space_id then
		vdp_stream.clear_color(0xff000000)
	end
	self.active_space_id = space_id
	self.active_space = self._spaces[space_id]
	return self.active_space_id
end

function world_class:set_object_space(obj, space_id)
	local target_space<const> = self._spaces[space_id]

	local object_id<const> = obj.id
	if self._by_id[object_id] == nil then
		obj.space_id = space_id
		return space_id
	end

	local current_space_id<const> = self._obj_to_space[object_id]
	if current_space_id == space_id then
		obj.space_id = space_id
		return space_id
	end

	if current_space_id ~= nil then
		local current_space<const> = self._spaces[current_space_id]
		if obj.active then
			self:deactivate_object(obj)
		end
		current_space.by_id[object_id] = nil
		remove_space_object(obj, current_space)
	end

	add_space_object(obj, target_space)
	target_space.by_id[object_id] = obj
	self._obj_to_space[object_id] = space_id
	obj.space_id = space_id
	if obj.active then
		self:activate_object(obj)
	end
	return space_id
end

local queue_active_object<const> = function(world, obj)
	if obj._active_object_pending then
		return
	end
	local pending<const> = world._pending_active_objects
	pending[#pending + 1] = obj
	obj._active_object_pending = true
end

-- Keep active_objects stable for the whole ECS phase. Structural mutations
-- are deferred to the phase boundary so gameplay systems can iterate the dense
-- active list directly instead of relying on reverse-loop/remove workarounds.
local reconcile_active_object<const> = function(world, obj)
	local target_space_id = nil
	if obj.active and world._by_id[obj.id] == obj then
		target_space_id = obj.space_id
	end
	local active_space_id<const> = obj._active_object_space_id
	if active_space_id ~= target_space_id then
		if active_space_id ~= nil then
			remove_active_object(obj, world._spaces[active_space_id])
		end
		if target_space_id ~= nil then
			add_active_object(obj, world._spaces[target_space_id])
		end
	end
end

function world_class:activate_object(obj)
	local components<const> = obj.components
	for i = 1, #components do
		self:activate_component(components[i])
	end
	if self.current_phase ~= nil then
		queue_active_object(self, obj)
	else
		reconcile_active_object(self, obj)
	end
end

function world_class:deactivate_object(obj)
	local components<const> = obj.components
	for i = 1, #components do
		self:deactivate_component(components[i])
	end
	if self.current_phase ~= nil then
		queue_active_object(self, obj)
	else
		reconcile_active_object(self, obj)
	end
end

local queue_active_component<const> = function(world, comp)
	if comp._active_component_pending then
		return
	end
	local pending<const> = world._pending_active_components
	pending[#pending + 1] = comp
	comp._active_component_pending = true
end

local reconcile_active_component<const> = function(world, comp)
	local parent<const> = comp.parent
	local target_space_id = nil
	if comp.enabled and parent.active and registry.instance:has(comp.id) then
		target_space_id = parent.space_id
	end
	local active_space_id<const> = comp._active_component_space_id
	if active_space_id ~= target_space_id then
		if active_space_id ~= nil then
			remove_active_component(comp, world._spaces[active_space_id])
		end
		if target_space_id ~= nil then
			add_active_component(comp, world._spaces[target_space_id])
		end
	end
end

function world_class:activate_component(comp)
	if self.current_phase ~= nil then
		queue_active_component(self, comp)
	else
		reconcile_active_component(self, comp)
	end
end

function world_class:deactivate_component(comp)
	if self.current_phase ~= nil then
		queue_active_component(self, comp)
	else
		reconcile_active_component(self, comp)
	end
end

function world_class:flush_active_components()
	local pending<const> = self._pending_active_components
	for i = 1, #pending do
		local comp<const> = pending[i]
		comp._active_component_pending = nil
		reconcile_active_component(self, comp)
		pending[i] = nil
	end
end

function world_class:flush_active_objects()
	local pending<const> = self._pending_active_objects
	for i = 1, #pending do
		local obj<const> = pending[i]
		obj._active_object_pending = nil
		reconcile_active_object(self, obj)
		pending[i] = nil
	end
end

-- Queue disposal work at mutation time so the frame loop only touches objects
-- that actually requested teardown. Low-end hardware benefits much more from a
-- short dirty list than from proving every frame that almost everything is alive.
function world_class:queue_object_disposal(obj)
	local pending<const> = self._pending_object_disposals
	pending[#pending + 1] = obj
end

function world_class:queue_subsystem_disposal(subsys)
	local pending<const> = self._pending_subsystem_disposals
	pending[#pending + 1] = subsys
end

function world_class:_remove_subsystem_systems(subsys)
	local systems<const> = subsys.__subsystem_systems
	if systems == nil then
		return
	end
	for i = 1, #systems do
		local sys<const> = systems[i]
		self.systems:unregister(sys)
		if sys.id then
			registry.instance:deregister(sys.id, true)
		end
	end
	subsys.__subsystem_systems = nil
end

function world_class:rebind_subsystem_systems(subsys)
	self:_remove_subsystem_systems(subsys)
	if self._subsystems_by_id[subsys.id] ~= subsys or subsys.dispose_flag then
		return
	end
	local subsystem_module<const> = require('bios/subsystem/index')
	local systems<const> = {
		subsystem_module.create_update_system(subsys),
		subsystem_module.create_animation_system(subsys),
		subsystem_module.create_presentation_system(subsys),
	}
	local registered<const> = {}
	for i = 1, #systems do
		local sys<const> = systems[i]
		if sys ~= nil then
			self.systems:register(sys)
			registry.instance:register(sys)
			registered[#registered + 1] = sys
		end
	end
	subsys.__subsystem_systems = registered
end

function world_class:rebind_subsystem_systems_all()
	for i = 1, #self._subsystems do
		self:rebind_subsystem_systems(self._subsystems[i])
	end
end

-- world:spawn(obj, pos?)
--   Registers obj in the world (and in the active space unless obj.space_id is
--   pre-set), sets position from pos, calls obj:onspawn(pos), then activates
--   the object and emits the 'spawn' event.
--   obj.id must be unique. Returns obj.
function world_class:spawn(obj, pos)
	local existing<const> = self._by_id[obj.id]
	if existing ~= nil and existing ~= obj then
		error('world.spawn duplicate id "' .. obj.id .. '".')
	end
	local space_id<const> = obj.space_id or self.active_space_id
	self._by_id[obj.id] = obj
	add_world_object(self, obj)
	self:set_object_space(obj, space_id)
	registry.instance:register(obj)
	if pos then
		obj.x = pos.x or obj.x
		obj.y = pos.y or obj.y
		obj.z = pos.z or obj.z
	end
	obj:onspawn(pos)
	obj:activate()
	obj.events:emit('spawn', { pos = pos })
	return obj
end

function world_class:spawn_subsystem(subsys)
	local existing<const> = self._subsystems_by_id[subsys.id]
	if existing ~= nil and existing ~= subsys then
		error('world.spawn_subsystem duplicate id "' .. subsys.id .. '".')
	end
	self._subsystems_by_id[subsys.id] = subsys
	add_subsystem(self, subsys)
	registry.instance:register(subsys)
	self:rebind_subsystem_systems(subsys)
	subsys:onregister()
	subsys:activate()
	subsys.events:emit('spawn')
	return subsys
end

-- world:despawn(id_or_obj)
--   Removes the object from the world and its space, then calls
--   obj:ondespawn() and obj:dispose(). Does nothing if obj is nil.
--   Do not call during an objects() iteration loop.
function world_class:despawn(id_or_obj)
	local obj
	if type(id_or_obj) ~= 'table' then
		obj = self._by_id[id_or_obj]
	else
		obj = id_or_obj
	end

	local object_id<const> = obj.id
	local space_id<const> = self._obj_to_space[object_id]
	if space_id ~= nil then
		local space<const> = self._spaces[space_id]
		space.by_id[object_id] = nil
		remove_space_object(obj, space)
		self._obj_to_space[object_id] = nil
	end

	registry.instance:deregister(object_id, true)
	obj:ondespawn()
	obj:dispose()
	self._by_id[object_id] = nil
	remove_world_object(self, obj)
end

-- world:get(id): returns the current live object with this id, or nil.
--   Pending-disposal objects are removed from the id map up front, so get()
--   stays a direct lookup instead of re-checking lifecycle flags on every call.
function world_class:get(id)
	return self._by_id[id]
end

function world_class:get_subsystem(id)
	return self._subsystems_by_id[id]
end

-- world:objects()
--   Iterator over active objects in the current active space.
--   Do NOT spawn or despawn inside this loop.
function world_class:objects()
	return iter_active_objects, self.active_space.active_objects, nil
end

-- world:all_objects()
--   Iterator over all live objects regardless of active space or active flag.
--   Use this for diagnostics, serialization, and leak checks, not gameplay hot loops.
function world_class:all_objects()
	return iter_live_objects, self._objects, nil
end

function world_class:subsystems()
	return iter_active_subsystems, self._subsystems, nil
end

function world_class:all_subsystems()
	return iter_live_subsystems, self._subsystems, nil
end

-- world:objects_with_components(type_name)
--   Iterator that yields (obj, component_handle) for every active component of
--   the given type in the current active space.
function world_class:objects_with_components(type_name)
	-- Active component queries combine registry type bucketing with direct dense
	-- active component sets. The goal is to keep ECS system iteration on the
	-- smallest useful set instead of re-filtering registry buckets every frame.
	local components<const> = self.active_space.active_components_by_type[type_name]
	return iter_active_objects_with_components,
		{ list = components, index = 0, stop = #components + 1 },
			nil
end

function world_class:all_objects_with_components(type_name)
	local bucket<const> = registry.instance:get_registered_entities_by_type(type_name)
	return iter_live_objects_with_components,
		{ bucket = bucket, reg_key = nil },
			nil
end

-- World query iterators stay lazy and never materialize result arrays.
-- The common active-object/subsystem paths are allocation-free; the registry-
-- backed type/tag queries still keep a tiny iterator state table.

-- world:objects_by_type(type_name)
--   Iterator over active objects whose type_name matches.
--   Like UE5 GetAllActorsOfClass — returns all objects spawned from a given
--   define_prefab definition_id.
function world_class:objects_by_type(obj_type_name)
	local state<const> = { bucket = registry.instance:get_registered_entities_by_type(obj_type_name), by_id = self._by_id, reg_key = nil }
	state.active_space_id = self.active_space_id
	return iter_active_world_by_type, state, nil
end

function world_class:all_objects_by_type(obj_type_name)
	local state<const> = { bucket = registry.instance:get_registered_entities_by_type(obj_type_name), by_id = self._by_id, reg_key = nil }
	return iter_live_world_by_type, state, nil
end

-- world:objects_by_tag(tag)
--   Iterator over active objects carrying the given tag.
--   Like UE5 GetAllActorsWithTag.
function world_class:objects_by_tag(tag)
	local state<const> = { reg = registry.instance._registry, tag = tag, by_id = self._by_id, reg_key = nil }
	state.active_space_id = self.active_space_id
	return iter_active_world_by_tag, state, nil
end

function world_class:all_objects_by_tag(tag)
	local state<const> = { reg = registry.instance._registry, tag = tag, by_id = self._by_id, reg_key = nil }
	return iter_live_world_by_tag, state, nil
end

-- world:find_by_type(type_name)
--   Returns the first active object matching type_name (or nil).
function world_class:find_by_type(obj_type_name)
	for entity in self:objects_by_type(obj_type_name) do
		return entity
	end
	return nil
end

function world_class:find_any_by_type(obj_type_name)
	for entity in self:all_objects_by_type(obj_type_name) do
		return entity
	end
	return nil
end

-- world:find_by_tag(tag)
--   Returns the first active object carrying the given tag (or nil).
function world_class:find_by_tag(tag)
	for entity in self:objects_by_tag(tag) do
		return entity
	end
	return nil
end

function world_class:find_any_by_tag(tag)
	for entity in self:all_objects_by_tag(tag) do
		return entity
	end
	return nil
end

local run_phase<const> = function(self, group, dt_ms)
	self.current_phase = group
	self.systems:update_phase(group, dt_ms)
	self.current_phase = nil
	self:flush_active_objects()
	self:flush_active_components()
end

function world_class:update()
	local dt_ms<const> = frame_delta_ms
	run_phase(self, tickgroup.input, dt_ms)
	run_phase(self, tickgroup.actioneffect, dt_ms)
	run_phase(self, tickgroup.moderesolution, dt_ms)
	run_phase(self, tickgroup.physics, dt_ms)
	run_phase(self, tickgroup.animation, dt_ms)

	local pending_objects<const> = self._pending_object_disposals
	for i = 1, #pending_objects do
		local obj<const> = pending_objects[i]
		if obj.dispose_flag then
			local space_object_index<const> = obj._space_object_index
			if space_object_index ~= nil then
				remove_space_object(obj, self._spaces[obj.space_id])
			end
			obj:ondespawn()
			obj:dispose() -- Also removes from registry, but we need to do the above cleanup first to avoid iterating over a half-destroyed object in the registry's tables.
			remove_world_object(self, obj)
		end
		pending_objects[i] = nil
	end

	local pending_subsystems<const> = self._pending_subsystem_disposals
	for i = 1, #pending_subsystems do
		local subsys<const> = pending_subsystems[i]
		if subsys.dispose_flag then
			self:_remove_subsystem_systems(subsys)
			subsys:onderegister()
			subsys:dispose()
			remove_subsystem(self, subsys)
		end
		pending_subsystems[i] = nil
	end
end

function world_class:draw()
	local dt_ms<const> = frame_delta_ms
	run_phase(self, tickgroup.presentation, dt_ms)
	run_phase(self, tickgroup.eventflush, dt_ms)
end

function world_class:clear()
	for i = #self._objects, 1, -1 do
		local obj<const> = self._objects[i]
		if obj.active then
			obj:deactivate()
		end
		obj:dispose()
	end
	for i = #self._subsystems, 1, -1 do
		local subsys<const> = self._subsystems[i]
		self:_remove_subsystem_systems(subsys)
		registry.instance:deregister(subsys.id, true)
		subsys:onderegister()
		subsys:dispose()
	end
	self._objects = {}
	self._by_id = {}
	self._subsystems = {}
	self._subsystems_by_id = {}
	self._spaces = {}
	self._space_order = {}
	self._obj_to_space = {}
	self._pending_active_components = {}
	self.current_phase = nil
	registry.instance:clear()
	self:add_space('main')
	self.active_space_id = 'main'
	self.active_space = self._spaces.main
end
world_instance = world_class.new()
world_instance.id = 'world'
world_instance.registrypersistent = true
registry.instance:register(world_instance)

return {
	world = world_class,
	instance = world_instance,
}
