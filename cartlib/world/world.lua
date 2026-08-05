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
local dense_set<const> = require('cartlib/util/dense_set')
local system_manager<const> = require('cartlib/world/system_manager')

local world
local world_id_max<const> = 0x7fffffff
local empty_object_bucket<const> = {}

local world_class<const> = {}
world_class.__index = world_class

local active_bucket_items<const> = function(buckets, key)
	local bucket<const> = buckets[key]
	return bucket and bucket.items or empty_object_bucket
end

function world_class:_add_space_object(obj)
	local space<const> = self._spaces[obj.space_id]
	local objects<const> = space.objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._space_object_index = index
end

function world_class:_remove_space_object(obj)
	local space<const> = self._spaces[obj.space_id]
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

function world_class:_add_active_object(obj)
	local space<const> = self._spaces[obj.space_id]
	local objects<const> = space.active_objects
	local index = #objects + 1
	while index > 1 and objects[index - 1].z > obj.z do
		local moved<const> = objects[index - 1]
		objects[index] = moved
		moved._active_object_index = index
		index = index - 1
	end
	objects[index] = obj
	obj._active_object_index = index
	obj._active_object_space_id = space.id
	local tick_order<const> = obj.tick_order
	local tick_bucket<const> = space.active_objects_by_tick_order[tick_order]
	local tick_index<const> = #tick_bucket + 1
	tick_bucket[tick_index] = obj
	obj._active_object_tick_order = tick_order
	obj._active_object_tick_order_index = tick_index
	local type_bucket = space.active_objects_by_type[obj.type_name]
	if type_bucket == nil then
		type_bucket = dense_set.new()
		space.active_objects_by_type[obj.type_name] = type_bucket
	end
	dense_set.add(type_bucket, obj)
	for tag in pairs(obj.tags) do
		local tag_bucket = space.active_objects_by_tag[tag]
		if tag_bucket == nil then
			tag_bucket = dense_set.new()
			space.active_objects_by_tag[tag] = tag_bucket
		end
		dense_set.add(tag_bucket, obj)
	end
end

function world_class:_remove_active_object(obj)
	local space<const> = self._spaces[obj._active_object_space_id]
	dense_set.remove(space.active_objects_by_type[obj.type_name], obj)
	for tag in pairs(obj.tags) do
		dense_set.remove(space.active_objects_by_tag[tag], obj)
	end
	local objects<const> = space.active_objects
	local index<const> = obj._active_object_index
	local last_index<const> = #objects
	for moved_index = index + 1, last_index do
		local moved<const> = objects[moved_index]
		objects[moved_index - 1] = moved
		moved._active_object_index = moved_index - 1
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

function world_class:_add_active_visual(comp)
	local space<const> = self._spaces[comp._active_component_space_id]
	local visuals<const> = space.active_visual_components
	self._visual_sequence = self._visual_sequence + 1
	comp._visual_sequence = self._visual_sequence
	local index<const> = #visuals + 1
	visuals[index] = comp
	comp._active_visual_index = index
	self._visual_revision = self._visual_revision + 1
end

function world_class:_remove_active_visual(comp)
	local space<const> = self._spaces[comp._active_component_space_id]
	local visuals<const> = space.active_visual_components
	local index<const> = comp._active_visual_index
	local last_index<const> = #visuals
	if index < last_index then
		local moved<const> = visuals[last_index]
		visuals[index] = moved
		moved._active_visual_index = index
	end
	visuals[last_index] = nil
	comp._active_visual_index = nil
	comp._visual_sequence = nil
	self._visual_revision = self._visual_revision + 1
end

function world_class:_add_active_component(comp)
	local space<const> = self._spaces[comp.parent.space_id]
	local component_type<const> = comp.type_name
	local bucket = space.active_components_by_type[component_type]
	if bucket == nil then
		bucket = {}
		space.active_components_by_type[component_type] = bucket
	end
	local index<const> = #bucket + 1
	bucket[index] = comp
	comp._active_component_index = index
	comp._active_component_space_id = space.id
	if comp.is_visual then
		self:_add_active_visual(comp)
	end
end

function world_class:_remove_active_component(comp)
	local space<const> = self._spaces[comp._active_component_space_id]
	if comp.is_visual then
		self:_remove_active_visual(comp)
	end
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
	self._spaces = {}
	self._space_order = {}
	self._pending_despawns = {}
	self._pending_despawn_count = 0
	self._pending_active_objects = {}
	self._pending_active_components = {}
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
	while registry.instance:get(result) ~= nil do
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
	local active_components_by_type<const> = {}
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		active_components_by_type[component_views[view_index].type_name] = {}
	end
	self._spaces[space_id] = {
		id = space_id,
		objects = {},
		active_objects = {},
		active_objects_by_type = {},
		active_objects_by_tag = {},
		active_visual_components = {},
		active_objects_by_tick_order = {
			early = {},
			normal = {},
			late = {},
		},
		active_components_by_type = active_components_by_type,
	}
	self._space_order[#self._space_order + 1] = space_id
end

function world_class:_commit_active_space(space_id)
	local space<const> = self._spaces[space_id]
	self._active_space = space
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		local view<const> = component_views[view_index]
		view.items = space.active_components_by_type[view.type_name]
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
		local space<const> = spaces[space_order[space_index]]
		local bucket = space.active_components_by_type[type_name]
		if bucket == nil then
			bucket = {}
			space.active_components_by_type[type_name] = bucket
		end
	end
	if self._active_space ~= nil then
		created.items = self._active_space.active_components_by_type[type_name]
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
	else
		self:_commit_active_space(space_id)
	end
	return space_id
end

function world_class:add_object_tag(obj, tag)
	registry.instance:add_tag(obj, tag)
	local active_space_id<const> = obj._active_object_space_id
	if active_space_id ~= nil then
		local buckets<const> = self._spaces[active_space_id].active_objects_by_tag
		local bucket = buckets[tag]
		if bucket == nil then
			bucket = dense_set.new()
			buckets[tag] = bucket
		end
		dense_set.add(bucket, obj)
	end
end

function world_class:remove_object_tag(obj, tag)
	local active_space_id<const> = obj._active_object_space_id
	if active_space_id ~= nil then
		dense_set.remove(self._spaces[active_space_id].active_objects_by_tag[tag], obj)
	end
	registry.instance:remove_tag(obj, tag)
end

function world_class:set_object_space(obj, space_id)
	if registry.instance:get(obj.id) ~= obj then
		obj.space_id = space_id
		return space_id
	end

	local current_space_id<const> = obj.space_id
	if obj._space_object_index ~= nil and current_space_id == space_id then
		return space_id
	end

	if obj._space_object_index ~= nil then
		if obj.active then
			self:deactivate_object(obj)
		end
		self:_remove_space_object(obj)
	end

	obj.space_id = space_id
	self:_add_space_object(obj)
	if obj.active then
		self:activate_object(obj)
	end
	return space_id
end

function world_class:_queue_active_object(obj)
	if obj._active_object_pending then
		return
	end
	local pending<const> = self._pending_active_objects
	pending[#pending + 1] = obj
	obj._active_object_pending = true
end

-- Keep active_objects stable for the whole ECS phase. Structural mutations
-- are deferred to the phase boundary so gameplay systems can iterate the dense
-- active list directly instead of relying on reverse-loop/remove workarounds.
function world_class:_reconcile_active_object(obj)
	local target_space_id = nil
	if obj.active and registry.instance:get(obj.id) == obj then
		target_space_id = obj.space_id
	end
	local active_space_id<const> = obj._active_object_space_id
	if active_space_id ~= target_space_id then
		if active_space_id ~= nil then
			self:_remove_active_object(obj)
		end
		if target_space_id ~= nil then
			self:_add_active_object(obj)
		end
	end
end

function world_class:activate_object(obj)
	local components<const> = obj.components
	for i = 1, #components do
		self:reconcile_component(components[i])
	end
	if self._current_tick_group ~= nil then
		self:_queue_active_object(obj)
	else
		self:_reconcile_active_object(obj)
	end
end

function world_class:deactivate_object(obj)
	local components<const> = obj.components
	for i = 1, #components do
		self:reconcile_component(components[i])
	end
	if self._current_tick_group ~= nil then
		self:_queue_active_object(obj)
	else
		self:_reconcile_active_object(obj)
	end
end

function world_class:_queue_active_component(comp)
	if comp._active_component_pending then
		return
	end
	local pending<const> = self._pending_active_components
	pending[#pending + 1] = comp
	comp._active_component_pending = true
end

function world_class:_reconcile_active_component(comp)
	local parent<const> = comp.parent
	local target_space_id = nil
	if comp._attached and comp.enabled and parent.active then
		target_space_id = parent.space_id
	end
	local active_space_id<const> = comp._active_component_space_id
	if active_space_id ~= target_space_id then
		if active_space_id ~= nil then
			self:_remove_active_component(comp)
		end
		if target_space_id ~= nil then
			self:_add_active_component(comp)
		end
	end
end

function world_class:reconcile_component(comp)
	if self._current_tick_group ~= nil then
		self:_queue_active_component(comp)
	else
		self:_reconcile_active_component(comp)
	end
end

function world_class:_flush_active_components()
	local pending<const> = self._pending_active_components
	for i = 1, #pending do
		local comp<const> = pending[i]
		comp._active_component_pending = nil
		self:_reconcile_active_component(comp)
		pending[i] = nil
	end
end

function world_class:_flush_active_objects()
	local pending<const> = self._pending_active_objects
	for i = 1, #pending do
		local obj<const> = pending[i]
		obj._active_object_pending = nil
		self:_reconcile_active_object(obj)
		pending[i] = nil
	end
end

function world_class:visual_depth_changed()
	self._visual_revision = self._visual_revision + 1
end

-- world:spawn(obj, pos?)
--   Registers obj in the world (and in the active space unless obj.space_id is
--   pre-set), sets position from pos, calls obj:onspawn(pos), then activates
--   the object and emits the 'spawn' event.
--   obj.id must be unique. Returns obj.
function world_class:spawn(obj, pos)
	local existing<const> = registry.instance:get(obj.id)
	if existing ~= nil and existing ~= obj then
		error('world.spawn duplicate id "' .. obj.id .. '".')
	end
	local space_id<const> = obj.space_id or self.active_space_id
	obj.world = self
	registry.instance:register(obj)
	self:_add_world_object(obj)
	self:set_object_space(obj, space_id)
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

function world_class:_commit_despawn(obj)
	obj.active = false
	local components<const> = obj.components
	for i = 1, #components do
		self:_reconcile_active_component(components[i])
	end
	self:_reconcile_active_object(obj)

	registry.instance:deregister(obj)
	self:_remove_space_object(obj)
	self:_remove_world_object(obj)

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
	return registry.instance:get(id)
end

function world_class:active_objects()
	return self._active_space.active_objects
end

function world_class:objects()
	return self._objects
end

function world_class:active_objects_by_type(type_name)
	return active_bucket_items(self._active_space.active_objects_by_type, type_name)
end

function world_class:objects_by_type(type_name)
	return registry.instance:entities_by_type(type_name)
end

function world_class:active_objects_by_tag(tag)
	return active_bucket_items(self._active_space.active_objects_by_tag, tag)
end

function world_class:objects_by_tag(tag)
	return registry.instance:entities_by_tag(tag)
end

function world_class:active_visuals()
	return self._active_space.active_visual_components, self._visual_revision
end

function world_class:_begin_tick_group(group)
	self._current_tick_group = group
end

function world_class:_commit_tick_group()
	self:_flush_active_objects()
	self:_flush_active_components()
	local pending_space_id<const> = self._pending_space_id
	if pending_space_id ~= nil then
		self._pending_space_id = nil
		self:_commit_active_space(pending_space_id)
	end
	self._current_tick_group = nil
	self:_flush_despawns()
end

function world_class:update()
	self._system_manager:update()
end

function world_class:clear()
	local objects<const> = self._objects
	while #objects > 0 do
		self:despawn(objects[#objects])
	end
	registry.instance:clear()
	self._system_manager:reset()
	self._visual_sequence = 0
	self:set_space(self._initial_space_id)
end
world = world_class.new()
world.id = 'world'
world.registrypersistent = true
registry.instance:register(world)

return world
