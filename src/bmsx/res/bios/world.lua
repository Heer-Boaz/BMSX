-- world.lua
-- central world: owns all objects, spaces, and the ECS system manager
--
-- DESIGN PRINCIPLES
--
-- 1. SPACES partition the world into independently-updated subsets.
--    There is always a 'main' space. Add more with world:add_space(id).
--    The 'active' space is set with world:set_space(id); only objects in the
--    active space are returned by world:objects({scope='active'}).
--    Use spaces for: UI layer, background layer, loading screens, etc.
--    Objects default to the active space at spawn unless they set .space_id.
--
-- 2. SPAWN / DESPAWN IS THE ONLY WAY TO ADD OR REMOVE OBJECTS.
--    Never add objects to the internal tables directly.
--    world:spawn(obj)         — calls obj:onspawn(), adds to active space
--    world:despawn(id_or_obj) — calls obj:ondespawn() + obj:dispose()
--
-- 3. SCOPE PARAMETER IN objects() / objects_with_components()
--    'all'    — every object regardless of active space or active state
--    'active' — only objects in the current active space that are active
--    Always pass scope='active' for gameplay logic; use 'all' only for
--    serialization or global queries.
--
-- 4. world_instance IS THE GLOBAL SINGLETON.
--    Access via  require('world').instance. Do not create extra world.new().
--
-- 5. NEVER ITERATE AND MUTATE at the same time.
--    Do not spawn/despawn while iterating world:objects(). If you need to
--    defer a spawn/despawn, use a queue and process it after the loop.

local ecs<const> = require('ecs')
local registry<const> = require('registry')

local tickgroup<const> = ecs.tickgroup
local world_instance

local world_class<const> = {}
world_class.__index = world_class

local emit_space_clear<const> = function()
	local c<const> = sys_palette_color(1)
	memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 4), sys_vdp_cmd_clear, 4, 0, c.r, c.g, c.b, c.a)
end

local tickgroup_names<const> = {}
for name, value in pairs(tickgroup) do
	tickgroup_names[value] = name
end

local phase_order<const> = {
	tickgroup.input,
	tickgroup.actioneffect,
	tickgroup.moderesolution,
	tickgroup.physics,
	tickgroup.animation,
	tickgroup.presentation,
	tickgroup.eventflush,
}

-- Active-space iteration is the dominant gameplay path, so it runs directly
-- over the current space object list and only checks obj.active. That avoids
-- paying global world-scope filtering cost for every yielded object.
local iter_active_objects<const> = function(state, _)
	local list<const> = state.list
	local index = state.index + state.step
	while index ~= state.stop do
		local obj<const> = list[index]
		if obj.active then
			state.index = index
			return obj
		end
		index = index + state.step
	end
	return nil
end

local iter_objects<const> = function(state, _)
	local list<const> = state.list
	local scope<const> = state.scope
	local index = state.index + state.step
	while index ~= state.stop do
		local obj<const> = list[index]
		if state.world:_object_in_scope(obj, scope) then
			state.index = index
			return obj
		end
		index = index + state.step
	end
	return nil
end

-- objects_with_components(..., {scope='active'}) is also a frame hot path.
-- Components already know their parent, and parents already track active space,
-- so the fast path only checks parent.active + parent.space_id instead of
-- routing through broader world-scope logic again.
local iter_active_objects_with_components<const> = function(state, _)
	local bucket<const> = state.bucket
	local active_space_id<const> = state.active_space_id
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		local parent<const> = entity.parent
		if parent.active and parent.space_id == active_space_id then
			state.reg_key = next_key
			return parent, entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_objects_with_components<const> = function(state, _)
	local bucket<const> = state.bucket
	local scope<const> = state.scope
	local world<const> = state.world
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		local parent<const> = entity.parent
		if world:_object_in_scope(parent, scope) then
			state.reg_key = next_key
			return parent, entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_subsystems<const> = function(state, _)
	local list<const> = state.list
	local scope<const> = state.scope
	local index = state.index + state.step
	while index ~= state.stop do
		local subsys<const> = list[index]
		if state.world:_subsystem_in_scope(subsys, scope) then
			state.index = index
			return subsys
		end
		index = index + state.step
	end
	return nil
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
	self.active_space_id = 'main'
	self.space_clear_pending = false
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.paused = false
	self.gamewidth = display_width()
	self.gameheight = display_height()
	-- id counter for unique id generation
	self.idcounter = 0
	self:add_space('main')
	return self
end

-- world:add_space(space_id)
--   Registers a new named space. Returns false if the space already exists.
--   Must be called before any object is spawned into that space.
function world_class:add_space(space_id)
	if type(space_id) ~= 'string' then
		error('world.add_space expects a non-empty space id')
	end
	if self._spaces[space_id] ~= nil then
		return false
	end
	self._spaces[space_id] = {
		id = space_id,
		objects = {},
		by_id = {},
	}
	self._space_order[#self._space_order + 1] = space_id
	return true
end

-- world:set_space(space_id): makes space_id the active space.
--   Objects subsequently spawned without an explicit .space_id go here.
--   Affects the 'active' scope in objects() / objects_with_components().
--   Errors if space_id is not registered.
function world_class:set_space(space_id)
	if self._spaces[space_id] == nil then
		error('world.set_space unknown space id "' .. tostring(space_id) .. '".')
	end
	if self.active_space_id ~= space_id then
		self.space_clear_pending = true
	end
	self.active_space_id = space_id
	return self.active_space_id
end

function world_class:set_object_space(obj, space_id)
	local target_space<const> = self._spaces[space_id]
	if target_space == nil then
		error('world.set_object_space unknown space id "' .. tostring(space_id) .. '".')
	end

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
		current_space.by_id[object_id] = nil
		local current_space_objects<const> = current_space.objects
		for i = #current_space_objects, 1, -1 do
			if current_space_objects[i] == obj then
				table.remove(current_space_objects, i)
				break
			end
		end
	end

	local target_space_objects<const> = target_space.objects
	target_space_objects[#target_space_objects + 1] = obj
	target_space.by_id[object_id] = obj
	self._obj_to_space[object_id] = space_id
	obj.space_id = space_id
	return space_id
end

function world_class:_object_in_scope(obj, scope)
	if scope == 'active' then
		if not obj.active then
			return false
		end
		return obj.space_id == self.active_space_id
	end
	return not obj.dispose_flag
end

function world_class:_subsystem_in_scope(subsys, scope)
	if scope == 'active' then
		return subsys.active
	end
	return not subsys.dispose_flag
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
	local subsystem_module<const> = require('subsystem')
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
	local space_id = obj.space_id
	if space_id == nil then
		space_id = self.active_space_id
	end
	self._by_id[obj.id] = obj
	self._objects[#self._objects + 1] = obj
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
	self._subsystems[#self._subsystems + 1] = subsys
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
		local space_objects<const> = space.objects
		for i = #space_objects, 1, -1 do
			if space_objects[i] == obj then
				table.remove(space_objects, i)
				break
			end
		end
		self._obj_to_space[object_id] = nil
	end

	registry.instance:deregister(object_id, true)
	obj:ondespawn()
	obj:dispose()
	self._by_id[object_id] = nil
	for i = #self._objects, 1, -1 do
		if self._objects[i] == obj then
			table.remove(self._objects, i)
			break
		end
	end
end

-- world:get(id): returns the live object with this id, or nil.
--   Returns nil if the object is pending disposal (dispose_flag=true).
function world_class:get(id)
	local obj<const> = self._by_id[id]
	if obj == nil then
		return nil
	end
	if obj.dispose_flag then
		return nil
	end
	return obj
end

function world_class:get_subsystem(id)
	local subsys<const> = self._subsystems_by_id[id]
	if subsys == nil then
		return nil
	end
	if subsys.dispose_flag then
		return nil
	end
	return subsys
end

-- world:objects(opts?)
--   Iterator over all objects matching opts:
--     opts.scope   — 'all' (default) or 'active' (current space + active flag)
--     opts.reverse — iterate in reverse order when true
--   Usage:  for obj in world_instance:objects({scope='active'}) do … end
--   Do NOT spawn or despawn inside this loop.
function world_class:objects(opts)
	local scope<const> = opts and opts.scope or 'all'
	local reverse<const> = opts and opts.reverse or false
	if scope == 'active' then
		-- Use the current space object list directly for gameplay iteration.
		-- This keeps the common case tight and avoids scanning unrelated spaces.
		local space<const> = self._spaces[self.active_space_id]
		local objects<const> = space.objects
		local step<const> = reverse and -1 or 1
		local start<const> = reverse and (#objects + 1) or 0
		local stop<const> = reverse and 0 or (#objects + 1)
		return iter_active_objects, { list = objects, step = step, index = start, stop = stop }, nil
	end
	local step<const> = reverse and -1 or 1
	local start<const> = reverse and (#self._objects + 1) or 0
	local stop<const> = reverse and 0 or (#self._objects + 1)
	return iter_objects, { world = self, list = self._objects, scope = scope, step = step, index = start, stop = stop }, nil
end

function world_class:subsystems(opts)
	local scope<const> = opts and opts.scope or 'all'
	local reverse<const> = opts and opts.reverse or false
	local step<const> = reverse and -1 or 1
	local start<const> = reverse and (#self._subsystems + 1) or 0
	local stop<const> = reverse and 0 or (#self._subsystems + 1)
	return iter_subsystems, { world = self, list = self._subsystems, scope = scope, step = step, index = start, stop = stop }, nil
end

-- world:objects_with_components(type_name, opts?)
--   Iterator that yields (obj, component_handle) for every component of the
--   given type on every matching object. opts.scope follows the same rules as
--   world:objects(). Used by ECS systems; rarely needed in cart code.
function world_class:objects_with_components(type_name, opts)
	local scope<const> = opts and opts.scope or 'all'
	local bucket<const> = registry.instance:get_registered_entities_by_type(type_name)
	if scope == 'active' then
		-- Active component queries combine registry type bucketing with direct
		-- parent active-space checks. The goal is to keep ECS system iteration on
		-- the smallest useful set instead of re-filtering the whole world.
		return iter_active_objects_with_components,
			{ bucket = bucket, active_space_id = self.active_space_id, reg_key = nil },
				nil
	end
	return iter_objects_with_components,
		{ world = self, bucket = bucket, scope = scope, reg_key = nil },
			nil
end

-- Stateless iterator functions for world queries.
-- These traverse the registry directly without allocating a results table.

local iter_world_by_type<const> = function(state, key)
	local bucket<const> = state.bucket
	local by_id<const> = state.by_id
	local world<const> = state.world
	local scope<const> = state.scope
	local next_key, entity = next(bucket, state.reg_key)
	while next_key do
		if by_id[entity.id] and world:_object_in_scope(entity, scope) then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(bucket, next_key)
	end
	state.reg_key = nil
	return nil
end

local iter_world_by_tag<const> = function(state, key)
	local reg_table<const> = state.reg
	local tag<const> = state.tag
	local by_id<const> = state.by_id
	local world<const> = state.world
	local scope<const> = state.scope
	local next_key, entity = next(reg_table, state.reg_key)
	while next_key do
		local tags<const> = entity.tags
		if tags and tags[tag] and by_id[entity.id] and world:_object_in_scope(entity, scope) then
			state.reg_key = next_key
			return entity
		end
		next_key, entity = next(reg_table, next_key)
	end
	state.reg_key = nil
	return nil
end

-- world:objects_by_type(type_name, opts?)
--   Iterator over objects whose type_name matches. Leverages the registry for
--   type-based lookups. opts.scope follows the same rules as world:objects().
--   Like UE5 GetAllActorsOfClass — returns all objects spawned from a given
--   define_prefab definition_id.
function world_class:objects_by_type(obj_type_name, opts)
	local scope<const> = opts and opts.scope or 'all'
	return iter_world_by_type, { bucket = registry.instance:get_registered_entities_by_type(obj_type_name), by_id = self._by_id, world = self, scope = scope, reg_key = nil }, nil
end

-- world:objects_by_tag(tag, opts?)
--   Iterator over objects carrying the given tag. Leverages the registry's
--   tag-based queries. opts.scope follows the same rules as world:objects().
--   Like UE5 GetAllActorsWithTag.
function world_class:objects_by_tag(tag, opts)
	local scope<const> = opts and opts.scope or 'all'
	return iter_world_by_tag, { reg = registry.instance._registry, tag = tag, by_id = self._by_id, world = self, scope = scope, reg_key = nil }, nil
end

-- world:find_by_type(type_name, opts?)
--   Returns the first object matching type_name (or nil). Like UE5 GetActorOfClass.
function world_class:find_by_type(obj_type_name, opts)
	local scope<const> = opts and opts.scope or 'all'
	for entity in iter_world_by_type, { bucket = registry.instance:get_registered_entities_by_type(obj_type_name), by_id = self._by_id, world = self, scope = scope, reg_key = nil }, nil do
		return entity
	end
	return nil
end

-- world:find_by_tag(tag, opts?)
--   Returns the first object carrying the given tag (or nil). Like UE5 GetActorWithTag.
function world_class:find_by_tag(tag, opts)
	local scope<const> = opts and opts.scope or 'all'
	for entity in iter_world_by_tag, { reg = registry.instance._registry, tag = tag, by_id = self._by_id, world = self, scope = scope, reg_key = nil }, nil do
		return entity
	end
	return nil
end

function world_class:update()
	self.current_phase = tickgroup.input
	self.systems:update_phase(tickgroup.input)
	self.current_phase = tickgroup.actioneffect
	self.systems:update_phase(tickgroup.actioneffect)
	self.current_phase = tickgroup.moderesolution
	self.systems:update_phase(tickgroup.moderesolution)
	self.current_phase = tickgroup.physics
	self.systems:update_phase(tickgroup.physics)
	self.current_phase = tickgroup.animation
	self.systems:update_phase(tickgroup.animation)
	self.current_phase = nil

		for i = #self._objects, 1, -1 do
			local obj<const> = self._objects[i]
		if obj.dispose_flag then
			local object_id<const> = obj.id
			local space_id<const> = self._obj_to_space[object_id]
			if space_id ~= nil then
				local space<const> = self._spaces[space_id]
				space.by_id[object_id] = nil
				local space_objects<const> = space.objects
				for j = #space_objects, 1, -1 do
					if space_objects[j] == obj then
						table.remove(space_objects, j)
						break
					end
				end
				self._obj_to_space[object_id] = nil
			end
			self._by_id[object_id] = nil

			obj:ondespawn()
			obj:dispose() -- Also removes from registry, but we need to do the above cleanup first to avoid iterating over a half-destroyed object in the registry's tables.
			table.remove(self._objects, i)
		end
		end
		for i = #self._subsystems, 1, -1 do
			local subsys<const> = self._subsystems[i]
			if subsys.dispose_flag then
				local subsys_id<const> = subsys.id
				self:_remove_subsystem_systems(subsys)
				subsys:onderegister()
				subsys:dispose()
				self._subsystems_by_id[subsys_id] = nil
				table.remove(self._subsystems, i)
			end
		end
end

function world_class:draw()
	if self.space_clear_pending then
		emit_space_clear()
		self.space_clear_pending = false
	end
	self.current_phase = tickgroup.presentation
	self.systems:update_phase(tickgroup.presentation)
	self.current_phase = tickgroup.eventflush
	self.systems:update_phase(tickgroup.eventflush)
	self.current_phase = nil
end

function world_class:clear()
	for i = #self._objects, 1, -1 do
		self._objects[i]:dispose()
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
	registry.instance:clear()
	self:add_space('main')
	self.active_space_id = 'main'
	self.space_clear_pending = false
end
world_instance = world_class.new()
world_instance.id = 'world'
world_instance.registrypersistent = true
registry.instance:register(world_instance)

return {
	world = world_class,
	instance = world_instance,
}
