-- world.lua
-- central world: owns all objects, spaces, and structural mutation barriers
--
-- DESIGN PRINCIPLES
--
-- 1. SPACES partition the world into independently-updated subsets.
--    The cart world module declares the fixed space topology once.
--    The 'active' space is set with world:set_space(id); default world queries
--    only see active objects in that space.
--    Spaces are mutually exclusive world partitions, not render layers.
--    Objects default to the active space at spawn unless they set .space_id.
--
-- 2. SPAWN / DESPAWN IS THE ONLY WAY TO ADD OR REMOVE OBJECTS.
--    Never add objects to the internal tables directly.
--    world:spawn(obj)         — calls obj:onspawn(), adds to active space
--    world:despawn(obj) — requests the one world-owned despawn transition
--
-- 3. QUERY SCOPE IS EXPLICIT.
--    active_* returns retained dense arrays for the selected space. Unqualified
--    objects* uses the cart-wide Registry or the world's lifecycle list.
--
-- 4. THE MODULE RETURNS THE CART WORLD.
--    Access it via require('cartlib/world/world'); carts do not create another world.
--
-- 5. STRUCTURAL MUTATIONS COMMIT AT TICK-GROUP BOUNDARIES.
--    Systems iterate retained dense arrays directly; world keeps active
--    membership stable until the current group completes.

local registry<const> = require('cartlib/registry')
local space_class<const> = require('cartlib/world/space')
local system_manager<const> = require('cartlib/world/system_manager')

local world
local world_id_max<const> = 0x7fffffff
local empty_object_bucket<const> = {}
local mutation_spawn<const> = 0x01
local mutation_component_attach<const> = 0x02
local mutation_object<const> = 0x04
local mutation_component<const> = 0x08
local mutation_tag<const> = 0x10
local mutation_component_detach<const> = 0x20
local mutation_active_space<const> = 0x40

local world_class<const> = {}
world_class.__index = world_class

function world_class:_add_world_object(obj)
	local objects<const> = self._objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._world_object_index = index
end

function world_class:_remove_world_object(obj)
	local objects<const> = self._objects
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

function world_class.new()
	local self<const> = setmetatable({}, world_class)
	self._objects = {}
	self._spaces = {}
	self._space_order = {}
	self._pending_despawns = {}
	self._pending_despawn_count = 0
	self._pending_spawns = {}
	self._pending_spawn_count = 0
	self._pending_objects = {}
	self._pending_components = {}
	self._pending_component_attaches = {}
	self._pending_component_attach_count = 0
	self._pending_component_detaches = {}
	self._pending_component_detach_count = 0
	self._pending_tag_objects = {}
	self._pending_tag_names = {}
	self._pending_tag_count = 0
	self._pending_mutation_mask = 0
	self._active_component_views = {}
	self._active_component_view_list = {}
	self.active_space_id = nil
	self._active_space = nil
	self._pending_space_id = nil
	self._initial_space_id = nil
	self._system_manager = system_manager.new(self)
	self._current_tick_group = nil
	self._visual_sequence = 0
	self._visual_revision = 0
	-- id counter for unique id generation
	self.idcounter = 0
	return self
end

function world_class:next_id(type_name)
	local baseid<const> = type_name
	local uniquenumber = self.idcounter + 1
	if uniquenumber >= world_id_max then
		uniquenumber = 1
	end

	local result = baseid .. '_' .. tostring(uniquenumber)
	while registry:is_id_claimed(result) do
		uniquenumber = uniquenumber + 1
		if uniquenumber >= world_id_max then
			uniquenumber = 1
		end
		result = baseid .. '_' .. tostring(uniquenumber)
	end

	self.idcounter = uniquenumber
	return result
end

function world_class:_add_space(space_id)
	local created<const> = space_class.new(space_id)
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		created:register_component_type(component_views[view_index].type_name)
	end
	self._spaces[space_id] = created
	self._space_order[#self._space_order + 1] = space_id
end

function world_class:_commit_active_space(space_id)
	local active_space<const> = self._spaces[space_id]
	self._active_space = active_space
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		local view<const> = component_views[view_index]
		view.items = active_space:component_bucket(view.type_name)
	end
	self._visual_revision = self._visual_revision + 1
end

function world_class:configure(world_module)
	self._system_manager:configure(world_module.systems)
	local spaces<const> = world_module.spaces
	for space_index = 1, #spaces do
		self:_add_space(spaces[space_index])
	end
	local initial_space_id<const> = spaces[1]
	self._initial_space_id = initial_space_id
	self.active_space_id = initial_space_id
	self:_commit_active_space(initial_space_id)
end

function world_class:_active_component_view(type_name)
	local views<const> = self._active_component_views
	local view<const> = views[type_name]
	if view then
		return view
	end
	local created<const> = {
		type_name = type_name,
		items = empty_object_bucket,
	}
	views[type_name] = created
	local view_list<const> = self._active_component_view_list
	view_list[#view_list + 1] = created
	local spaces<const> = self._spaces
	local space_order<const> = self._space_order
	for space_index = 1, #space_order do
		local partition<const> = spaces[space_order[space_index]]
		partition:register_component_type(type_name)
	end
	if self._active_space ~= nil then
		created.items = self._active_space:component_bucket(type_name)
	end
	return created
end

-- The semantic active-space value changes immediately. Retained membership
-- views switch only at the current tick-group barrier.
function world_class:set_space(space_id)
	if self.active_space_id == space_id then
		return space_id
	end
	self.active_space_id = space_id
	if self._current_tick_group ~= nil then
		self._pending_space_id = space_id
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_active_space
	else
		self:_commit_active_space(space_id)
	end
	return space_id
end

function world_class:reconcile_object_tag(obj, tag)
	if self._current_tick_group ~= nil then
		local index<const> = self._pending_tag_count + 1
		self._pending_tag_count = index
		self._pending_tag_objects[index] = obj
		self._pending_tag_names[index] = tag
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_tag
	else
		registry:reconcile_tag(obj, tag)
		local active_space<const> = obj._active_space
		if active_space ~= nil then
			active_space:reconcile_active_tag(obj, tag)
		end
	end
end

function world_class:set_object_space(obj, space_id)
	if obj.space_id == space_id then
		return space_id
	end
	obj.space_id = space_id
	self:reconcile_object(obj)
	return space_id
end

function world_class:_queue_object_reconcile(obj)
	if obj._object_reconcile_pending then
		return
	end
	local pending<const> = self._pending_objects
	pending[#pending + 1] = obj
	obj._object_reconcile_pending = true
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_object
end

-- Keep active_objects stable for the whole tick group. Structural mutations
-- are deferred to the tick-group boundary so gameplay systems can iterate the dense
-- active list directly instead of relying on reverse-loop/remove workarounds.
function world_class:_reconcile_active_object(obj)
	local target_space = nil
	if obj._published and obj.active then
		target_space = obj._space
	end
	local active_space<const> = obj._active_space
	if active_space ~= target_space then
		if active_space ~= nil then
			active_space:deactivate_object(obj)
		end
		if target_space ~= nil then
			target_space:activate_object(obj)
		end
	end
end

function world_class:_reconcile_object(obj)
	local target_space = nil
	if obj._published then
		target_space = self._spaces[obj.space_id]
	end
	local current_space<const> = obj._space
	if current_space ~= target_space then
		local active_space<const> = obj._active_space
		if active_space ~= nil then
			active_space:deactivate_object(obj)
		end
		local components<const> = obj._components
		for i = 1, #components do
			local comp<const> = components[i]
			local component_space<const> = comp._active_space
			if component_space ~= nil then
				component_space:deactivate_component(comp)
				if comp.is_visual and component_space == self._active_space then
					self._visual_revision = self._visual_revision + 1
				end
			end
		end
		if current_space ~= nil then
			current_space:remove_object(obj)
		end
		if target_space ~= nil then
			target_space:add_object(obj)
		end
	end
	self:_reconcile_active_object(obj)
	local components<const> = obj._components
	for i = 1, #components do
		self:_reconcile_active_component(components[i])
	end
end

function world_class:reconcile_object(obj)
	if self._current_tick_group ~= nil then
		self:_queue_object_reconcile(obj)
	else
		self:_reconcile_object(obj)
	end
end

function world_class:_queue_component_reconcile(comp)
	if comp._component_reconcile_pending then
		return
	end
	local pending<const> = self._pending_components
	pending[#pending + 1] = comp
	comp._component_reconcile_pending = true
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component
end

function world_class:_reconcile_active_component(comp)
	local parent<const> = comp.parent
	local target_space = nil
	if comp._attached and comp.enabled and parent._published and parent.active then
		target_space = parent._space
	end
	local active_space<const> = comp._active_space
	if active_space ~= target_space then
		if active_space ~= nil then
			active_space:deactivate_component(comp)
			if comp.is_visual and active_space == self._active_space then
				self._visual_revision = self._visual_revision + 1
			end
		end
		if target_space ~= nil then
			if comp.is_visual then
				self._visual_sequence = self._visual_sequence + 1
			end
			target_space:activate_component(comp, self._visual_sequence)
			if comp.is_visual and target_space == self._active_space then
				self._visual_revision = self._visual_revision + 1
			end
		end
	end
end

function world_class:reconcile_component(comp)
	if self._current_tick_group ~= nil then
		self:_queue_component_reconcile(comp)
	else
		self:_reconcile_active_component(comp)
	end
end

function world_class:_commit_component_attach(comp)
	registry:register(comp)
	comp._published = true
	self:_reconcile_active_component(comp)
end

function world_class:attach_component(comp)
	registry:reserve(comp)
	if self._current_tick_group == nil then
		self:_commit_component_attach(comp)
		return
	end
	local index<const> = self._pending_component_attach_count + 1
	self._pending_component_attach_count = index
	self._pending_component_attaches[index] = comp
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component_attach
end

function world_class:_commit_component_detach(comp)
	self:_reconcile_active_component(comp)
	comp.parent:_commit_component_detach(comp)
	registry:deregister(comp)
	comp._published = nil
end

function world_class:detach_component(comp)
	if self._current_tick_group == nil then
		self:_commit_component_detach(comp)
		return
	end
	local index<const> = self._pending_component_detach_count + 1
	self._pending_component_detach_count = index
	self._pending_component_detaches[index] = comp
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component_detach
end

function world_class:_flush_component_attaches()
	local pending<const> = self._pending_component_attaches
	local index = 1
	while index <= self._pending_component_attach_count do
		local comp<const> = pending[index]
		pending[index] = nil
		self:_commit_component_attach(comp)
		index = index + 1
	end
	self._pending_component_attach_count = 0
end

function world_class:_flush_component_detaches()
	local pending<const> = self._pending_component_detaches
	local index = 1
	while index <= self._pending_component_detach_count do
		local comp<const> = pending[index]
		pending[index] = nil
		self:_commit_component_detach(comp)
		index = index + 1
	end
	self._pending_component_detach_count = 0
end

function world_class:_flush_components()
	local pending<const> = self._pending_components
	for i = 1, #pending do
		local comp<const> = pending[i]
		comp._component_reconcile_pending = nil
		self:_reconcile_active_component(comp)
		pending[i] = nil
	end
end

function world_class:_flush_objects()
	local pending<const> = self._pending_objects
	for i = 1, #pending do
		local obj<const> = pending[i]
		obj._object_reconcile_pending = nil
		self:_reconcile_object(obj)
		pending[i] = nil
	end
end

function world_class:_flush_tags()
	local objects<const> = self._pending_tag_objects
	local names<const> = self._pending_tag_names
	for index = 1, self._pending_tag_count do
		local obj<const> = objects[index]
		local tag<const> = names[index]
		objects[index] = nil
		names[index] = nil
		registry:reconcile_tag(obj, tag)
		local active_space<const> = obj._active_space
		if active_space ~= nil then
			active_space:reconcile_active_tag(obj, tag)
		end
	end
	self._pending_tag_count = 0
end

function world_class:visual_depth_changed()
	self._visual_revision = self._visual_revision + 1
end

function world_class:_reserve_object(obj)
	registry:reserve(obj)
	obj.world = self
	obj.space_id = obj.space_id or self.active_space_id
end

function world_class:_commit_spawn(obj)
	registry:register(obj)
	local components<const> = obj._components
	for i = 1, #components do
		registry:register(components[i])
		components[i]._published = true
	end
	obj._published = true
	self:_add_world_object(obj)
	self:_reconcile_object(obj)
	obj.events:emit('spawn', { pos = obj._spawn_position })
	obj._spawn_position = nil
end

function world_class:_flush_spawns()
	local pending<const> = self._pending_spawns
	local index = 1
	while index <= self._pending_spawn_count do
		local obj<const> = pending[index]
		pending[index] = nil
		self:_commit_spawn(obj)
		index = index + 1
	end
	self._pending_spawn_count = 0
end

-- A spawn is fully constructed before Registry, space and system views publish
-- it. During a tick group that publication happens at the group barrier.
function world_class:spawn(obj, pos)
	if pos then
		obj.x = pos.x or obj.x
		obj.y = pos.y or obj.y
		obj.z = pos.z or obj.z
	end
	obj:onspawn(pos)
	obj:activate()
	local components<const> = obj._components
	for i = 1, #components do
		registry:reserve(components[i])
	end
	obj._spawn_position = pos
	if self._current_tick_group == nil then
		self:_commit_spawn(obj)
	else
		local index<const> = self._pending_spawn_count + 1
		self._pending_spawn_count = index
		self._pending_spawns[index] = obj
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_spawn
	end
	return obj
end

function world_class:_commit_despawn(obj)
	obj.active = false
	local components<const> = obj._components
	for i = 1, #components do
		self:_reconcile_active_component(components[i])
	end
	self:_reconcile_active_object(obj)

	registry:deregister(obj)
	obj._space:remove_object(obj)
	self:_remove_world_object(obj)
	obj._published = nil

	obj:ondespawn()
	obj:dispose()
	obj._despawn_pending = nil
	obj.world = nil
end

-- world:despawn(obj)
--   Requests the object's terminal lifecycle transition. During a tick group
--   the command commits at the group barrier; outside one it commits directly
--   through the same operation.
function world_class:despawn(obj)
	if obj._despawn_pending then
		return
	end
	obj._despawn_pending = true
	if self._current_tick_group == nil then
		self:_commit_despawn(obj)
		return
	end
	local pending_count<const> = self._pending_despawn_count + 1
	self._pending_despawn_count = pending_count
	self._pending_despawns[pending_count] = obj
end

function world_class:_flush_despawns()
	local pending<const> = self._pending_despawns
	local index = 1
	while index <= self._pending_despawn_count do
		local obj<const> = pending[index]
		pending[index] = nil
		self:_commit_despawn(obj)
		index = index + 1
	end
	self._pending_despawn_count = 0
end

-- world:get(id): returns the current live object with this id, or nil.
--   The central Registry owns this direct lookup. A despawn requested during a
--   tick group remains part of that group's retained snapshot until its barrier.
function world_class:get(id)
	return registry:get(id)
end

function world_class:active_objects()
	return self._active_space:active_objects()
end

function world_class:objects()
	return self._objects
end

function world_class:active_objects_by_type(type_name)
	return self._active_space:active_objects_by_type(type_name) or empty_object_bucket
end

function world_class:objects_by_type(type_name)
	return registry:entities_by_type(type_name)
end

function world_class:active_objects_by_tag(tag)
	return self._active_space:active_objects_by_tag(tag) or empty_object_bucket
end

function world_class:objects_by_tag(tag)
	return registry:entities_by_tag(tag)
end

function world_class:active_visuals()
	return self._active_space:active_visuals(), self._visual_revision
end

function world_class:_begin_tick_group(group)
	self._current_tick_group = group
end

function world_class:_flush_structural_mutations()
	if (self._pending_mutation_mask & mutation_spawn) ~= 0 then
		self:_flush_spawns()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_spawn
	end
	if (self._pending_mutation_mask & mutation_component_attach) ~= 0 then
		self:_flush_component_attaches()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_component_attach
	end
	if (self._pending_mutation_mask & mutation_object) ~= 0 then
		self:_flush_objects()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_object
	end
	if (self._pending_mutation_mask & mutation_component) ~= 0 then
		self:_flush_components()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_component
	end
	if (self._pending_mutation_mask & mutation_tag) ~= 0 then
		self:_flush_tags()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_tag
	end
	if (self._pending_mutation_mask & mutation_component_detach) ~= 0 then
		self:_flush_component_detaches()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_component_detach
	end
	if (self._pending_mutation_mask & mutation_active_space) ~= 0 then
		local pending_space_id<const> = self._pending_space_id
		self._pending_space_id = nil
		self:_commit_active_space(pending_space_id)
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_active_space
	end
end

function world_class:_commit_tick_group()
	if self._pending_mutation_mask ~= 0 then
		self:_flush_structural_mutations()
	end
	self._current_tick_group = nil
	if self._pending_despawn_count ~= 0 then
		self:_flush_despawns()
	end
end

function world_class:update()
	self._system_manager:update()
end

function world_class:clear()
	local objects<const> = self._objects
	while #objects > 0 do
		self:despawn(objects[#objects])
	end
	registry:clear()
	self._system_manager:reset()
	self._visual_sequence = 0
	self:set_space(self._initial_space_id)
end
world = world_class.new()
world.id = 'world'
world.registry_persistent = true
registry:register(world)

return world
