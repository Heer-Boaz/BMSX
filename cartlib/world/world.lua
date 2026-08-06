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
--    world:spawn(definition_id, options) — constructs and admits one object
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

local commandlist<const> = require('cartlib/gx/commandlist')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local presentation_config<const> = require('bmsx/presentation_config')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local space<const> = require('cartlib/world/space')
local systemmanager<const> = require('cartlib/world/systemmanager')

local world
local clear_color<const> = 0xff000000
local render_command_capacity<const> = 4096
local empty_object_bucket<const> = {}
local mutation_spawn<const> = 0x01
local mutation_component_attach<const> = 0x02
local mutation_object<const> = 0x04
local mutation_component<const> = 0x08
local mutation_tag<const> = 0x10
local mutation_component_detach<const> = 0x20
local mutation_active_space<const> = 0x40

bss cartlib_render_commands: word[render_command_capacity]

local worldclass<const> = {}
worldclass.__index = worldclass

local visual_depth_less<const> = function(a, b)
	local a_depth<const> = a.parent.z + a.offset_z + a.draw_offset_z
	local b_depth<const> = b.parent.z + b.offset_z + b.draw_offset_z
	if a_depth ~= b_depth then
		return a_depth < b_depth
	end
	return a._visual_sequence < b._visual_sequence
end

function worldclass:_add_worldobject(obj)
	local objects<const> = self._objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._worldobject_index = index
end

function worldclass:_remove_worldobject(obj)
	local objects<const> = self._objects
	local index<const> = obj._worldobject_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._worldobject_index = index
	end
	objects[last_index] = nil
	obj._worldobject_index = nil
end

function worldclass.new()
	local self<const> = setmetatable({}, worldclass)
	self._objects = {}
	self._spaces = {}
	self._space_order = {}
	self._pending_despawns = {}
	self._pending_despawn_count = 0
	self._flushing_despawns = false
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
	self._clear_pending = false
	self._active_component_views_by_class = {}
	self._active_component_view_list = {}
	self.active_space_id = nil
	self._active_space = nil
	self._pending_space_id = nil
	self._initial_space_id = nil
	self._system_manager = systemmanager.new(self)
	self._current_tick_group = nil
	self._visual_sequence = 0
	self._visual_revision = 0
	self._draw_commands = commandlist.new(cartlib_render_commands)
	self._render_visuals = {}
	self._render_visual_count = 0
	self._render_visual_revision = -1
	self._page_size = presentation_config.page_size
	local display_page<const> = presentation_config.display_page
	local draw_page<const> = presentation_config.draw_page
	self._draw_page = draw_page
	if display_page == draw_page then
		self.render = worldclass._render_single_page
		gx_display.origin(draw_page)
		gx_gpu.draw_target(draw_page, self._page_size)
		gx_gpu.clear_color(draw_page, self._page_size, clear_color)
	else
		self.render = worldclass._render_double_page
		self._display_page = display_page
		gx_display.origin(display_page)
		gx_gpu.draw_target(display_page, self._page_size)
		gx_gpu.clear_color(display_page, self._page_size, clear_color)
		gx_gpu.draw_target(draw_page, self._page_size)
		gx_gpu.clear_color(draw_page, self._page_size, clear_color)
	end
	return self
end

function worldclass:_add_space(space_id)
	local created<const> = space.new(space_id)
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		created:register_component_class(component_views[view_index].component_class)
	end
	self._spaces[space_id] = created
	self._space_order[#self._space_order + 1] = space_id
end

function worldclass:_commit_active_space(space_id)
	local active_space<const> = self._spaces[space_id]
	self._active_space = active_space
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		local view<const> = component_views[view_index]
		view.items = active_space:component_bucket(view.component_class)
	end
	self._visual_revision = self._visual_revision + 1
end

function worldclass:configure(world_module)
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

function worldclass:_active_component_view(component_class)
	local views<const> = self._active_component_views_by_class
	local view<const> = views[component_class]
	if view then
		return view
	end
	local created<const> = {
		component_class = component_class,
		items = empty_object_bucket,
	}
	views[component_class] = created
	local view_list<const> = self._active_component_view_list
	view_list[#view_list + 1] = created
	local spaces<const> = self._spaces
	local space_order<const> = self._space_order
	for space_index = 1, #space_order do
		local partition<const> = spaces[space_order[space_index]]
		partition:register_component_class(component_class)
	end
	if self._active_space ~= nil then
		created.items = self._active_space:component_bucket(component_class)
	end
	return created
end

-- The semantic active-space value changes immediately. Retained membership
-- views switch only at the current tick-group barrier.
function worldclass:set_space(space_id)
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

function worldclass:reconcile_object_tag(obj, tag)
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

function worldclass:set_object_space(obj, space_id)
	if obj.space_id == space_id then
		return space_id
	end
	obj.space_id = space_id
	self:reconcile_object(obj)
	return space_id
end

function worldclass:_queue_object_reconcile(obj)
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
function worldclass:_reconcile_active_object(obj)
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

function worldclass:_reconcile_object(obj)
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

function worldclass:reconcile_object(obj)
	if self._current_tick_group ~= nil then
		self:_queue_object_reconcile(obj)
	else
		self:_reconcile_object(obj)
	end
end

function worldclass:_queue_component_reconcile(comp)
	if comp._component_reconcile_pending then
		return
	end
	local pending<const> = self._pending_components
	pending[#pending + 1] = comp
	comp._component_reconcile_pending = true
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component
end

function worldclass:_reconcile_active_component(comp)
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

function worldclass:reconcile_component(comp)
	if self._current_tick_group ~= nil then
		self:_queue_component_reconcile(comp)
	else
		self:_reconcile_active_component(comp)
	end
end

function worldclass:_commit_component_attach(comp)
	comp._attach_pending = nil
	registry:register_component(comp)
	comp._published = true
	self:_reconcile_active_component(comp)
end

function worldclass:_cancel_component_attach(comp)
	comp._attach_pending = nil
	registry:deregister(comp)
	comp.parent:_commit_component_detach(comp)
end

function worldclass:attach_component(comp)
	registry:reserve(comp)
	if self._current_tick_group == nil then
		self:_commit_component_attach(comp)
		return
	end
	comp._attach_pending = true
	local index<const> = self._pending_component_attach_count + 1
	self._pending_component_attach_count = index
	self._pending_component_attaches[index] = comp
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component_attach
end

function worldclass:_commit_component_detach(comp)
	self:_reconcile_active_component(comp)
	comp.parent:_commit_component_detach(comp)
	registry:deregister_component(comp)
	comp._published = nil
end

function worldclass:detach_component(comp)
	if comp._attach_pending then
		return
	end
	if self._current_tick_group == nil then
		self:_commit_component_detach(comp)
		return
	end
	local index<const> = self._pending_component_detach_count + 1
	self._pending_component_detach_count = index
	self._pending_component_detaches[index] = comp
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component_detach
end

function worldclass:_flush_component_attaches()
	local pending<const> = self._pending_component_attaches
	local index = 1
	while index <= self._pending_component_attach_count do
		local comp<const> = pending[index]
		pending[index] = nil
		if comp._attached then
			self:_commit_component_attach(comp)
		else
			self:_cancel_component_attach(comp)
		end
		index = index + 1
	end
	self._pending_component_attach_count = 0
end

function worldclass:_flush_component_detaches()
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

function worldclass:_flush_components()
	local pending<const> = self._pending_components
	for i = 1, #pending do
		local comp<const> = pending[i]
		comp._component_reconcile_pending = nil
		self:_reconcile_active_component(comp)
		pending[i] = nil
	end
end

function worldclass:_flush_objects()
	local pending<const> = self._pending_objects
	for i = 1, #pending do
		local obj<const> = pending[i]
		obj._object_reconcile_pending = nil
		self:_reconcile_object(obj)
		pending[i] = nil
	end
end

function worldclass:_flush_tags()
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

function worldclass:visual_depth_changed()
	self._visual_revision = self._visual_revision + 1
end

function worldclass:_reserve_object(obj)
	registry:reserve(obj)
	obj.world = self
	obj.space_id = obj.space_id or self.active_space_id
end

local apply_construction_values<const> = function(target, values)
	for key, value in pairs(values) do
		if key ~= 'pos' then
			target[key] = value
		end
	end
end

function worldclass:_commit_spawn(obj)
	obj._spawn_pending = nil
	registry:register_object(obj)
	local components<const> = obj._components
	for i = 1, #components do
		registry:register_component(components[i])
		components[i]._published = true
	end
	obj._published = true
	self:_add_worldobject(obj)
	self:_reconcile_object(obj)
	obj.events:emit('spawn', { pos = obj._spawn_position })
	obj._spawn_position = nil
end

function worldclass:_flush_spawns()
	local pending<const> = self._pending_spawns
	local index = 1
	while index <= self._pending_spawn_count do
		local obj<const> = pending[index]
		pending[index] = nil
		-- A spawn canceled in the same structural scope never enters the
		-- published Registry, space, or system views.
		if obj._despawn_pending then
			self:_commit_despawn(obj)
		else
			self:_commit_spawn(obj)
		end
		index = index + 1
	end
	self._pending_spawn_count = 0
end

-- A prefab instance is fully constructed before Registry, space and system
-- views publish it. During a tick group that publication or cancellation
-- happens at the group barrier.
function worldclass:spawn(definition_id, options)
	local definition<const> = prefab.definition(definition_id)
	local construction_options<const> = {}
	apply_construction_values(construction_options, definition.defaults)
	apply_construction_values(construction_options, options)
	construction_options.definition_id = definition_id
	construction_options.id = construction_options.id or registry:next_id(definition_id)

	local obj<const> = definition.base.new(construction_options)
	self:_reserve_object(obj)
	apply_construction_values(obj, construction_options)
	setmetatable(obj, definition.instance_metatable)
	local component_options<const> = { parent = obj }
	local component_factories<const> = definition.components
	for index = 1, #component_factories do
		obj:add_component(component_factories[index](component_options))
	end
	local ctor<const> = definition.ctor
	if ctor then
		ctor(obj, options, definition_id)
	end

	local deferred<const> = self._current_tick_group ~= nil
	if deferred then
		obj._spawn_pending = true
		local index<const> = self._pending_spawn_count + 1
		self._pending_spawn_count = index
		self._pending_spawns[index] = obj
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_spawn
	end
	local pos<const> = options.pos
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
	if not deferred then
		self:_commit_spawn(obj)
	end
	return obj
end

function worldclass:_commit_despawn(obj)
	obj.active = false
	local components<const> = obj._components
	if obj._spawn_pending then
		for i = 1, #components do
			registry:deregister(components[i])
		end
		registry:deregister(obj)
		obj._spawn_pending = nil
	else
		for i = 1, #components do
			self:_reconcile_active_component(components[i])
		end
		self:_reconcile_active_object(obj)

		for i = 1, #components do
			local comp<const> = components[i]
			registry:deregister_component(comp)
			comp._published = nil
		end
		registry:deregister_object(obj)
		obj._space:remove_object(obj)
		self:_remove_worldobject(obj)
		obj._published = nil
	end

	obj:ondespawn()
	obj:dispose()
	obj._despawn_pending = nil
	obj.world = nil
end

-- world:despawn(obj)
--   Requests the object's terminal lifecycle transition. During a tick group
--   the command commits at the group barrier; outside one it commits directly
--   through the same operation.
function worldclass:despawn(obj)
	if obj._despawn_pending then
		return
	end
	obj._despawn_pending = true
	if obj._spawn_pending then
		return
	end
	if self._current_tick_group == nil and not self._flushing_despawns then
		self:_commit_despawn(obj)
		return
	end
	local pending_count<const> = self._pending_despawn_count + 1
	self._pending_despawn_count = pending_count
	self._pending_despawns[pending_count] = obj
end

function worldclass:_flush_despawns()
	local pending<const> = self._pending_despawns
	self._flushing_despawns = true
	local index = 1
	while index <= self._pending_despawn_count do
		local obj<const> = pending[index]
		pending[index] = nil
		self:_commit_despawn(obj)
		index = index + 1
	end
	self._pending_despawn_count = 0
	self._flushing_despawns = false
end

-- world:get(id): returns the current live object with this id, or nil.
--   The central Registry owns this direct lookup. A despawn requested during a
--   tick group remains part of that group's retained snapshot until its barrier.
function worldclass:get(id)
	return registry:get_object(id)
end

function worldclass:active_objects()
	return self._active_space:active_objects()
end

function worldclass:objects()
	return self._objects
end

function worldclass:active_objects_by_definition(definition_id)
	return self._active_space:active_objects_by_definition(definition_id) or empty_object_bucket
end

function worldclass:objects_by_definition(definition_id)
	return registry:objects_by_definition(definition_id)
end

function worldclass:active_objects_by_tag(tag)
	return self._active_space:active_objects_by_tag(tag) or empty_object_bucket
end

function worldclass:objects_by_tag(tag)
	return registry:objects_by_tag(tag)
end

function worldclass:_begin_tick_group(group)
	self._current_tick_group = group
end

function worldclass:_flush_structural_mutations()
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

function worldclass:_commit_tick_group()
	if self._pending_mutation_mask ~= 0 then
		self:_flush_structural_mutations()
	end
	self._current_tick_group = nil
	if self._pending_despawn_count ~= 0 then
		self:_flush_despawns()
	end
	if self._clear_pending then
		self._clear_pending = false
		self:_commit_clear()
		return true
	end
end

function worldclass:update()
	self._system_manager:update()
end

function worldclass:_rebuild_render_visuals()
	local revision<const> = self._visual_revision
	if revision == self._render_visual_revision then
		return
	end

	local active_visuals<const> = self._active_space:active_visuals()
	local visuals<const> = self._render_visuals
	local visual_count<const> = #active_visuals
	for i = 1, visual_count do
		visuals[i] = active_visuals[i]
	end
	for i = visual_count + 1, self._render_visual_count do
		visuals[i] = nil
	end
	table.sort(visuals, visual_depth_less)
	self._render_visual_count = visual_count
	self._render_visual_revision = revision
end

function worldclass:_build_render_commands(draw_page)
	local draw_commands<const> = self._draw_commands
	commandlist.begin(draw_commands, gp0.draw_mode_blend_half)
	draw_commands:clear(draw_page, self._page_size, clear_color)
	self:_rebuild_render_visuals()
	local visuals<const> = self._render_visuals
	for i = 1, self._render_visual_count do
		local visual<const> = visuals[i]
		if visual.parent.visible and visual.visible then
			visual:draw(draw_commands)
		end
	end
end

function worldclass:_render_single_page()
	self:_build_render_commands(self._draw_page)
	commandlist.submit(self._draw_commands)
end

function worldclass:_render_double_page()
	local draw_page<const> = self._draw_page
	self:_build_render_commands(draw_page)
	commandlist.submit_fenced(self._draw_commands)
	gx_display.origin(draw_page)
	self._draw_page = self._display_page
	self._display_page = draw_page
	gx_gpu.draw_target(self._draw_page, self._page_size)
end

function worldclass:_recompute_visual_sequence()
	local sequence = 0
	local objects<const> = self._objects
	for object_index = 1, #objects do
		local components<const> = objects[object_index]._components
		for component_index = 1, #components do
			local component<const> = components[component_index]
			if component.is_visual and component._active_space ~= nil and component._visual_sequence > sequence then
				sequence = component._visual_sequence
			end
		end
	end
	self._visual_sequence = sequence
end

function worldclass:_commit_clear()
	self._visual_sequence = 0
	local objects<const> = self._objects
	while #objects > 0 do
		self:despawn(objects[#objects])
	end
	self._system_manager:reset()
	self:_recompute_visual_sequence()
	self:set_space(self._initial_space_id)
end

function worldclass:clear()
	if self._current_tick_group ~= nil or self._flushing_despawns then
		local objects<const> = self._objects
		for i = #objects, 1, -1 do
			self:despawn(objects[i])
		end
		local pending_spawns<const> = self._pending_spawns
		for i = 1, self._pending_spawn_count do
			self:despawn(pending_spawns[i])
		end
		self._clear_pending = true
		return
	end
	self:_commit_clear()
end
world = worldclass.new()
world.id = 'world'
registry:register(world)

return world
