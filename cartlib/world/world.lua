local clock<const> = require('cartlib/clock')
local frame_delta_ms<const> = clock.frame_milliseconds()
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

local ecs<const> = require('cartlib/ecs')
local registry<const> = require('cartlib/registry')
local dense_set<const> = require('cartlib/util/dense_set')

local tick_group<const> = ecs.tick_group
local world
local world_id_max<const> = 0x7fffffff
local empty_component_bucket<const> = {}
local empty_object_bucket<const> = {}

local world_class<const> = {}
world_class.__index = world_class

local active_bucket_items<const> = function(buckets, key)
	local bucket<const> = buckets[key]
	return bucket and bucket.items or empty_object_bucket
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

local add_active_object<const> = function(obj, space)
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

local remove_active_object<const> = function(obj, space)
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

local visual_depth_less<const> = function(a, b)
	local a_depth<const> = a.parent.z + a.offset_z + a.draw_offset_z
	local b_depth<const> = b.parent.z + b.offset_z + b.draw_offset_z
	if a_depth ~= b_depth then
		return a_depth < b_depth
	end
	return a._visual_sequence < b._visual_sequence
end

local add_active_visual<const> = function(world, comp, space)
	local visuals<const> = space.active_visual_components
	world._visual_sequence = world._visual_sequence + 1
	comp._visual_sequence = world._visual_sequence
	local index = #visuals + 1
	while index > 1 and visual_depth_less(comp, visuals[index - 1]) do
		local moved<const> = visuals[index - 1]
		visuals[index] = moved
		moved._active_visual_index = index
		index = index - 1
	end
	visuals[index] = comp
	comp._active_visual_index = index
end

local remove_active_visual<const> = function(comp, space)
	local visuals<const> = space.active_visual_components
	local index<const> = comp._active_visual_index
	local last_index<const> = #visuals
	for moved_index = index + 1, last_index do
		local moved<const> = visuals[moved_index]
		visuals[moved_index - 1] = moved
		moved._active_visual_index = moved_index - 1
	end
	visuals[last_index] = nil
	comp._active_visual_index = nil
	comp._visual_sequence = nil
end

local add_active_component<const> = function(world, comp, space)
	local component_type<const> = comp.type_name
	local bucket = space.active_components_by_type[component_type]
	if not bucket or bucket == empty_component_bucket then
		bucket = {}
		space.active_components_by_type[component_type] = bucket
	end
	local index<const> = #bucket + 1
	bucket[index] = comp
	comp._active_component_index = index
	comp._active_component_space_id = space.id
	if comp.is_visual then
		add_active_visual(world, comp, space)
	end
end

local remove_active_component<const> = function(comp, space)
	if comp.is_visual then
		remove_active_visual(comp, space)
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
	self._pending_object_disposals = {}
	self._pending_active_objects = {}
	self._pending_active_components = {}
	self.active_space_id = 'main'
	self.active_space = nil
	self.systems = ecs.system_manager.new()
	self.current_phase = nil
	self._visual_sequence = 0
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

-- world:add_space(space_id)
--   Registers a new named space. Returns false if the space already exists.
--   Must be called before any object is spawned into that space.
function world_class:add_space(space_id)
	if self._spaces[space_id] ~= nil then
		return false
	end
	local active_components_by_type<const> = {}
	local system_component_types<const> = self.systems.component_types
	for i = 1, #system_component_types do
		active_components_by_type[system_component_types[i]] = empty_component_bucket
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
	return true
end

-- world:set_space(space_id): makes space_id the active space.
--   Objects subsequently spawned without an explicit .space_id go here.
--   Affects active_* query helpers and component views.
function world_class:set_space(space_id)
	self.active_space_id = space_id
	self.active_space = self._spaces[space_id]
	return self.active_space_id
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
	local target_space<const> = self._spaces[space_id]
	if registry.instance:get(obj.id) ~= obj then
		obj.space_id = space_id
		return space_id
	end

	local current_space_id<const> = obj.space_id
	if obj._space_object_index ~= nil and current_space_id == space_id then
		return space_id
	end

	if obj._space_object_index ~= nil then
		local current_space<const> = self._spaces[current_space_id]
		if obj.active then
			self:deactivate_object(obj)
		end
		remove_space_object(obj, current_space)
	end

	obj.space_id = space_id
	add_space_object(obj, target_space)
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
	if obj.active and registry.instance:get(obj.id) == obj then
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
		self:reconcile_component(components[i])
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
		self:reconcile_component(components[i])
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
	if comp._attached and comp.enabled and parent.active then
		target_space_id = parent.space_id
	end
	local active_space_id<const> = comp._active_component_space_id
	if active_space_id ~= target_space_id then
		if active_space_id ~= nil then
			remove_active_component(comp, world._spaces[active_space_id])
		end
		if target_space_id ~= nil then
			add_active_component(world, comp, world._spaces[target_space_id])
		end
	end
end

function world_class:reconcile_component(comp)
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

function world_class:sort_active_visuals()
	local visuals<const> = self.active_space.active_visual_components
	table.sort(visuals, visual_depth_less)
	for i = 1, #visuals do
		visuals[i]._active_visual_index = i
	end
end

-- Queue disposal work at mutation time so the frame loop only touches objects
-- that actually requested teardown. Low-end hardware benefits much more from a
-- short dirty list than from proving every frame that almost everything is alive.
function world_class:queue_object_disposal(obj)
	local pending<const> = self._pending_object_disposals
	pending[#pending + 1] = obj
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
	add_world_object(self, obj)
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

-- world:despawn(id_or_obj)
--   Removes the object from the world and its space, then calls
--   obj:ondespawn() and obj:dispose(). Does nothing if obj is nil.
--   Do not call during an objects() iteration loop.
function world_class:despawn(id_or_obj)
	local obj
	if type(id_or_obj) ~= 'table' then
		obj = registry.instance:get(id_or_obj)
	else
		obj = id_or_obj
	end

	if obj._space_object_index ~= nil then
		local space<const> = self._spaces[obj.space_id]
		remove_space_object(obj, space)
	end

	registry.instance:deregister(obj)
	obj:ondespawn()
	obj:dispose()
	remove_world_object(self, obj)
end

-- world:get(id): returns the current live object with this id, or nil.
--   Pending-disposal objects are removed from the id map up front, so get()
--   stays a direct lookup instead of re-checking lifecycle flags on every call.
function world_class:get(id)
	return registry.instance:get(id)
end

function world_class:active_objects()
	return self.active_space.active_objects
end

function world_class:objects()
	return self._objects
end

function world_class:active_objects_by_type(type_name)
	return active_bucket_items(self.active_space.active_objects_by_type, type_name)
end

function world_class:objects_by_type(type_name)
	return registry.instance:entities_by_type(type_name)
end

function world_class:active_objects_by_tag(tag)
	return active_bucket_items(self.active_space.active_objects_by_tag, tag)
end

function world_class:objects_by_tag(tag)
	return registry.instance:entities_by_tag(tag)
end

function world_class:active_components(type_name)
	return self.active_space.active_components_by_type[type_name] or empty_component_bucket
end

local run_phase<const> = function(self, group, dt_ms)
	self.current_phase = group
	self.systems:update_phase(group, dt_ms)
	self.current_phase = nil
	self:flush_active_objects()
	self:flush_active_components()
end

function world_class:update()
	run_phase(self, tick_group.input, frame_delta_ms)
	run_phase(self, tick_group.action_effects, frame_delta_ms)
	run_phase(self, tick_group.gameplay, frame_delta_ms)
	run_phase(self, tick_group.physics, frame_delta_ms)
	run_phase(self, tick_group.animation, frame_delta_ms)

	local pending_objects<const> = self._pending_object_disposals
	for i = 1, #pending_objects do
		local obj<const> = pending_objects[i]
		if obj.dispose_flag then
			local space_object_index<const> = obj._space_object_index
			if space_object_index ~= nil then
				remove_space_object(obj, self._spaces[obj.space_id])
			end
			registry.instance:deregister(obj)
			obj:ondespawn()
			obj:dispose()
			remove_world_object(self, obj)
		end
		pending_objects[i] = nil
	end

end

function world_class:render()
	run_phase(self, tick_group.presentation, frame_delta_ms)
end

function world_class:clear()
	for i = #self._objects, 1, -1 do
		local obj<const> = self._objects[i]
		if obj.active then
			obj:deactivate()
		end
		obj:dispose()
	end
	self._objects = {}
	self._spaces = {}
	self._space_order = {}
	self._pending_object_disposals = {}
	self._pending_active_objects = {}
	self._pending_active_components = {}
	self._visual_sequence = 0
	self.current_phase = nil
	registry.instance:clear()
	self:add_space('main')
	self.active_space_id = 'main'
	self.active_space = self._spaces.main
end
world = world_class.new()
world.id = 'world'
world.registrypersistent = true
registry.instance:register(world)

return world
