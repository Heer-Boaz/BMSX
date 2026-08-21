-- world.lua
-- central world: owns all objects, spaces, and structural mutation barriers
--
-- DESIGN PRINCIPLES
--
-- 1. SPACES partition the world into independently-updated subsets.
--    The cart world module declares the fixed space topology once.
--    The 'active' space is set with world:set_space(id); retained component and
--    definition views follow that selected space at its structural barrier.
--    Spaces are mutually exclusive world partitions, not render layers.
--    Objects default to the active space at spawn unless they set .space_id.
--
-- 2. SPAWN / DISPOSAL IS THE ONLY WAY TO ADD OR REMOVE OBJECTS.
--    Never add objects to the internal tables directly.
--    world:spawn(definition_id, options) — constructs and admits one object
--    world:mark_for_disposal(obj) — requests the one world-owned removal
--
-- 3. QUERY SCOPE IS EXPLICIT.
--    Systems and long-lived cart queries retain active_*_view() results; the
--    selected space swaps each view's dense backing array at its barrier.
--    Cart-wide identity and key queries address Registry directly.
--
-- 4. THE MODULE RETURNS THE CART WORLD.
--    Access it via require('cartlib/world/world'); carts do not create another world.
--
-- 5. STRUCTURAL MUTATIONS COMMIT AT TICK-GROUP BOUNDARIES.
--    Systems iterate retained dense arrays directly; world keeps active
--    membership stable until the current group completes.
--
-- 6. GAMEPLAY TIME BELONGS TO THE WORLD SCHEDULE.
--    gameplay_time_ms advances once before an admitted gameplay update and
--    remains unchanged while that clock lane is suspended. Cooldown owners can
--    retain absolute gameplay deadlines without ticking every component.

local command_list<const> = require('cartlib/gx/command_list')
local clock<const> = require('cartlib/clock')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local presentation_config<const> = require('bmsx/presentation_config')
local component_class_chain<const> = require('cartlib/component/component_class').chain
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local space<const> = require('cartlib/world/space')
local system_manager<const> = require('cartlib/world/system_manager')

local world
local clear_color<const> = 0xff000000
local render_command_capacity<const> = 4096
local empty_object_bucket<const> = {}
local mutation_admission<const> = 0x01
local mutation_component_attach<const> = 0x02
local mutation_object<const> = 0x04
local mutation_component<const> = 0x08
local mutation_tag<const> = 0x10
local mutation_component_detach<const> = 0x20
local mutation_active_space<const> = 0x40
local mutation_disposal<const> = 0x80
local mutation_clear<const> = 0x100
local mutation_gameplay_clock<const> = 0x200
local mutation_space_unload<const> = 0x400
local structural_mutation_mask<const> = mutation_admission
	| mutation_component_attach
	| mutation_object
	| mutation_component
	| mutation_tag
	| mutation_component_detach
	| mutation_active_space
	| mutation_gameplay_clock

bss cartlib_render_commands: word[render_command_capacity]

local world_class<const> = {}
world_class.__index = world_class

local visual_depth_less<const> = function(a, b)
	local a_depth<const> = a.parent.z + a.offset_z + a.draw_offset_z
	local b_depth<const> = b.parent.z + b.offset_z + b.draw_offset_z
	if a_depth ~= b_depth then
		return a_depth < b_depth
	end
	return a._visual_sequence < b._visual_sequence
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

function world_class.new()
	local self<const> = setmetatable({}, world_class)
	self._objects = {}
	self._spaces = {}
	self._space_order = {}
	self._pending_disposals = {}
	self._pending_disposal_count = 0
	self._flushing_disposals = false
	self._pending_admissions = {}
	self._pending_admission_count = 0
	self._pending_space_unload_callbacks = {}
	self._pending_space_unload_contexts = {}
	self._pending_space_unload_count = 0
	self._pending_objects = {}
	self._pending_object_count = 0
	self._pending_components = {}
	self._pending_component_count = 0
	self._pending_component_attaches = {}
	self._pending_component_attach_count = 0
	self._pending_component_detaches = {}
	self._pending_component_detach_count = 0
	self._pending_tag_objects = {}
	self._pending_tag_names = {}
	self._pending_tag_count = 0
	self._pending_mutation_mask = 0
	self._active_definition_views = {}
	self._active_definition_view_list = {}
	self._active_component_views_by_class = {}
	self._active_component_view_list = {}
	self._active_tick_views_by_clock = {}
	self._active_tick_view_list = {}
	self.active_space_id = nil
	self._active_space = nil
	self._pending_space_id = nil
	self._pending_gameplay_clock_running = true
	self._initial_space_id = nil
	self._system_manager = system_manager.new(self)
	self.gameplay_clock_running = true
	self.gameplay_time_ms = 0
	self._mutation_barrier_open = false
	self._visual_sequence = 0
	self._visual_revision = 0
	self._draw_commands = command_list.new(cartlib_render_commands)
	self._render_visuals = {}
	self._render_visual_count = 0
	self._render_visual_revision = -1
	self._page_size = presentation_config.page_size
	local display_page<const> = presentation_config.display_page
	local draw_page<const> = presentation_config.draw_page
	self._draw_page = draw_page
	if display_page == draw_page then
		self.render = world_class._render_single_page
		gx_display.origin(draw_page)
		gx_gpu.draw_target(draw_page, self._page_size)
		gx_gpu.clear_color(draw_page, self._page_size, clear_color)
	else
		self.render = world_class._render_double_page
		self._display_page = display_page
		gx_display.origin(display_page)
		gx_gpu.draw_target(display_page, self._page_size)
		gx_gpu.clear_color(display_page, self._page_size, clear_color)
		gx_gpu.draw_target(draw_page, self._page_size)
		gx_gpu.clear_color(draw_page, self._page_size, clear_color)
	end
	return self
end

function world_class:_add_space(space_id)
	local created<const> = space.new(space_id)
	local definition_views<const> = self._active_definition_view_list
	for view_index = 1, #definition_views do
		created:register_definition(definition_views[view_index].definition_id)
	end
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		created:register_component_class(component_views[view_index].component_class)
	end
	local tick_views<const> = self._active_tick_view_list
	for view_index = 1, #tick_views do
		local view<const> = tick_views[view_index]
		created:register_tick_class(view.component_class, view.clock_source)
	end
	self._spaces[space_id] = created
	self._space_order[#self._space_order + 1] = space_id
end

function world_class:_commit_active_space(space_id)
	local active_space<const> = self._spaces[space_id]
	self._active_space = active_space
	local definition_views<const> = self._active_definition_view_list
	for view_index = 1, #definition_views do
		local view<const> = definition_views[view_index]
		view.objects = active_space:definition_bucket(view.definition_id)
	end
	local component_views<const> = self._active_component_view_list
	for view_index = 1, #component_views do
		local view<const> = component_views[view_index]
		view.components = active_space:component_bucket(view.component_class)
	end
	local tick_views<const> = self._active_tick_view_list
	for view_index = 1, #tick_views do
		local view<const> = tick_views[view_index]
		view.components = active_space:tick_bucket(view.component_class, view.clock_source)
	end
	self._visual_revision = self._visual_revision + 1
end

function world_class:configure(world_module)
	local gameplay_delta_milliseconds<const>, frame_delta_milliseconds<const> = clock.configure_tick_intervals(
		world_module.gameplay_interval_vblanks,
		world_module.frame_interval_vblanks
	)
	self._update_with_gameplay, self._update_without_gameplay = self._system_manager:configure(
		world_module.systems,
		gameplay_delta_milliseconds,
		frame_delta_milliseconds,
		world_module.gameplay_clock_rate
	)
	self.update = self._update_with_gameplay
	local spaces<const> = world_module.spaces
	for space_index = 1, #spaces do
		self:_add_space(spaces[space_index])
	end
	local initial_space_id<const> = spaces[1]
	self._initial_space_id = initial_space_id
	self.active_space_id = initial_space_id
	self:_commit_active_space(initial_space_id)
end

function world_class:active_component_view(component_class)
	local views<const> = self._active_component_views_by_class
	local view<const> = views[component_class]
	if view then
		return view
	end
	local created<const> = {
		component_class = component_class,
		components = empty_object_bucket,
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
		created.components = self._active_space:component_bucket(component_class)
	end
	return created
end

-- Systems retain one dense component lane for each clock-bound tick function.
-- Component lifecycle stays independent: dormant FSMs remain subscribed while
-- absent from gameplay time, and frame-clock sequences remain independently
-- schedulable.
function world_class:active_tick_view(component_class, clock_source)
	local views = self._active_tick_views_by_clock[clock_source]
	if views == nil then
		views = {}
		self._active_tick_views_by_clock[clock_source] = views
	end
	local view<const> = views[component_class]
	if view then
		return view
	end
	local created<const> = {
		component_class = component_class,
		clock_source = clock_source,
		components = empty_object_bucket,
	}
	views[component_class] = created
	local view_list<const> = self._active_tick_view_list
	view_list[#view_list + 1] = created
	local spaces<const> = self._spaces
	local space_order<const> = self._space_order
	for space_index = 1, #space_order do
		local partition<const> = spaces[space_order[space_index]]
		partition:register_tick_class(component_class, clock_source)
	end
	if self._active_space ~= nil then
		created.components = self._active_space:tick_bucket(component_class, clock_source)
	end
	return created
end

-- Gameplay suspension changes only the clock schedule. It does not classify
-- objects, rewrite component state or turn a cinematic into a special pause
-- mode. Frame-clock tick functions continue on each cart-owned world update.
function world_class:_commit_gameplay_clock(running)
	if self.gameplay_clock_running == running then
		return false
	end
	self.gameplay_clock_running = running
	if running then
		self.update = self._update_with_gameplay
	else
		self.update = self._update_without_gameplay
	end
	return true
end

-- Clock changes requested from scheduled work commit at its tick-group
-- barrier. The compiled runner then stops before executing work selected by
-- the schedule it just displaced.
function world_class:set_gameplay_clock_running(running)
	if self._mutation_barrier_open then
		self._pending_gameplay_clock_running = running
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_gameplay_clock
		return
	end
	self:_commit_gameplay_clock(running)
end

-- Systems bind active definition views once at configuration time.
-- The world swaps the retained bucket only when the active space commits.
function world_class:active_definition_view(definition_id)
	local views<const> = self._active_definition_views
	local view<const> = views[definition_id]
	if view then
		return view
	end
	local created<const> = {
		definition_id = definition_id,
		objects = empty_object_bucket,
	}
	views[definition_id] = created
	local view_list<const> = self._active_definition_view_list
	view_list[#view_list + 1] = created
	local spaces<const> = self._spaces
	local space_order<const> = self._space_order
	for space_index = 1, #space_order do
		local partition<const> = spaces[space_order[space_index]]
		partition:register_definition(definition_id)
	end
	if self._active_space ~= nil then
		created.objects = self._active_space:definition_bucket(definition_id)
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
	if self._mutation_barrier_open then
		self._pending_space_id = space_id
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_active_space
	else
		self:_commit_active_space(space_id)
	end
	return space_id
end

function world_class:reconcile_object_tag(obj, tag)
	if self._mutation_barrier_open then
		local index<const> = self._pending_tag_count + 1
		self._pending_tag_count = index
		self._pending_tag_objects[index] = obj
		self._pending_tag_names[index] = tag
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_tag
	else
		registry:reconcile_index(obj, tag, obj.tags[tag])
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
	local index<const> = self._pending_object_count + 1
	self._pending_object_count = index
	pending[index] = obj
	obj._object_reconcile_pending = true
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_object
end

-- Keep active_objects stable for the whole tick group. Structural mutations
-- are deferred to the tick-group boundary so gameplay systems can iterate the dense
-- active list directly instead of relying on reverse-loop/remove workarounds.
function world_class:_reconcile_active_object(obj)
	local target_space = nil
	if obj._world_object_index ~= nil and obj.active then
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
	if obj._world_object_index ~= nil then
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
				local visual_was_active<const> = comp._active_visual_index ~= nil
				component_space:deactivate_component(comp)
				if visual_was_active and component_space == self._active_space then
					self._visual_revision = self._visual_revision + 1
				end
			end
		end
		obj._space = target_space
	end
	self:_reconcile_active_object(obj)
	local components<const> = obj._components
	for i = 1, #components do
		self:_reconcile_active_component(components[i])
	end
end

function world_class:reconcile_object(obj)
	if self._mutation_barrier_open then
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
	local index<const> = self._pending_component_count + 1
	self._pending_component_count = index
	pending[index] = comp
	comp._component_reconcile_pending = true
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component
end

function world_class:_reconcile_active_component(comp)
	local parent<const> = comp.parent
	local target_space = nil
	if comp._attached and comp.enabled and parent._world_object_index ~= nil and parent.active then
		target_space = parent._space
	end
	local active_space<const> = comp._active_space
	if active_space ~= target_space then
		if active_space ~= nil then
			local visual_was_active<const> = comp._active_visual_index ~= nil
			active_space:deactivate_component(comp)
			if visual_was_active and active_space == self._active_space then
				self._visual_revision = self._visual_revision + 1
			end
		end
		if target_space ~= nil then
			if comp.is_visual then
				self._visual_sequence = self._visual_sequence + 1
			end
			target_space:activate_component(comp, self._visual_sequence)
			if comp._active_visual_index ~= nil and target_space == self._active_space then
				self._visual_revision = self._visual_revision + 1
			end
		end
	elseif target_space ~= nil then
		target_space:reconcile_component_tick(comp)
		if comp.is_visual
		and target_space:reconcile_component_visual(comp)
		and target_space == self._active_space then
			self._visual_revision = self._visual_revision + 1
		end
	end
end

function world_class:reconcile_component(comp)
	if self._mutation_barrier_open then
		self:_queue_component_reconcile(comp)
	else
		self:_reconcile_active_component(comp)
	end
end

function world_class:_commit_component_attach(comp)
	local parent<const> = comp.parent
	parent:_attach_component(comp)
	if comp.id == nil then
		comp.id = registry:next_id()
	end
	registry:register(comp)
	local classes<const> = component_class_chain(getmetatable(comp))
	for class_index = 1, #classes do
		registry:index(comp, classes[class_index])
	end
	self:_reconcile_active_component(comp)
	comp._attach_pending = nil
	if parent.active then
		comp:on_activate()
	end
end

function world_class:attach_component(comp)
	comp._attach_pending = true
	if not self._mutation_barrier_open then
		self:_commit_component_attach(comp)
		return comp
	end
	local index<const> = self._pending_component_attach_count + 1
	self._pending_component_attach_count = index
	self._pending_component_attaches[index] = comp
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_component_attach
	return comp
end

function world_class:_commit_component_detach(comp)
	self:_reconcile_active_component(comp)
	comp.parent:_detach_component(comp)
	registry:deregister(comp)
end

function world_class:detach_component(comp)
	if comp._attach_pending then
		comp._attach_pending = nil
		return
	end
	if not self._mutation_barrier_open then
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
		if comp._attach_pending then
			self:_commit_component_attach(comp)
		end
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
	local index = 1
	while index <= self._pending_component_count do
		local comp<const> = pending[index]
		pending[index] = nil
		comp._component_reconcile_pending = nil
		self:_reconcile_active_component(comp)
		index = index + 1
	end
	self._pending_component_count = 0
end

function world_class:_flush_objects()
	local pending<const> = self._pending_objects
	local index = 1
	while index <= self._pending_object_count do
		local obj<const> = pending[index]
		pending[index] = nil
		obj._object_reconcile_pending = nil
		self:_reconcile_object(obj)
		index = index + 1
	end
	self._pending_object_count = 0
end

function world_class:_flush_tags()
	local objects<const> = self._pending_tag_objects
	local names<const> = self._pending_tag_names
	for index = 1, self._pending_tag_count do
		local obj<const> = objects[index]
		local tag<const> = names[index]
		objects[index] = nil
		names[index] = nil
		registry:reconcile_index(obj, tag, obj.tags[tag])
	end
	self._pending_tag_count = 0
end

function world_class:visual_depth_changed()
	self._visual_revision = self._visual_revision + 1
end

local apply_spawn_values<const> = function(target, values)
	for key, value in pairs(values) do
		if key ~= 'pos' then
			target[key] = value
		end
	end
end

function world_class:_commit_spawn(obj)
	registry:register(obj)
	for tag in pairs(obj.tags) do
		registry:index(obj, tag)
	end
	local components<const> = obj._components
	for i = 1, #components do
		local comp<const> = components[i]
		if comp.id == nil then
			comp.id = registry:next_id()
		end
		registry:register(comp)
		local classes<const> = component_class_chain(getmetatable(comp))
		for class_index = 1, #classes do
			registry:index(comp, classes[class_index])
		end
	end
	self:_add_world_object(obj)
	self:_reconcile_object(obj)
end

function world_class:_flush_admissions()
	local pending<const> = self._pending_admissions
	local index = 1
	while index <= self._pending_admission_count do
		local obj<const> = pending[index]
		pending[index] = nil
		-- A spawn canceled in the same structural scope never enters the
		-- published Registry, space, or system views.
		if obj.marked_for_disposal then
			self:_commit_disposal(obj)
		else
			self:_commit_spawn(obj)
		end
		index = index + 1
	end
	self._pending_admission_count = 0
end

-- A prefab instance is fully constructed before Registry, space and system
-- views publish it. During a tick group that publication or cancellation
-- happens at the group barrier.
function world_class:spawn(definition_id, options)
	local definition<const> = prefab.definition(definition_id)
	local obj<const> = {}
	apply_spawn_values(obj, definition.defaults)
	apply_spawn_values(obj, options)
	obj.definition_id = definition_id
	obj.id = obj.id or registry:next_id()

	setmetatable(obj, definition.instance_metatable)
	definition.initialize(obj)
	obj.world = self
	obj.space_id = obj.space_id or self.active_space_id
	local component_options<const> = { parent = obj }
	local component_factories<const> = definition.components
	for index = 1, #component_factories do
		obj:add_component(component_factories[index](component_options))
	end
	local ctor<const> = definition.ctor
	if ctor then
		ctor(obj, options, definition_id)
	end

	local deferred<const> = self._mutation_barrier_open
	if deferred then
		local index<const> = self._pending_admission_count + 1
		self._pending_admission_count = index
		self._pending_admissions[index] = obj
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_admission
	end
	local pos<const> = options.pos
	if pos then
		obj.x = pos.x or obj.x
		obj.y = pos.y or obj.y
		obj.z = pos.z or obj.z
	end
	obj:onspawn(pos)
	obj:activate()
	if not deferred then
		if obj.marked_for_disposal then
			self:_commit_disposal(obj)
		else
			self:_commit_spawn(obj)
		end
	end
	return obj
end

function world_class:_commit_disposal(obj)
	local components<const> = obj._components
	if obj._world_object_index ~= nil then
		for i = 1, #components do
			self:_reconcile_active_component(components[i])
		end
		self:_reconcile_active_object(obj)

		for i = 1, #components do
			local comp<const> = components[i]
			registry:deregister(comp)
		end
		registry:deregister(obj)
		obj._space = nil
		self:_remove_world_object(obj)
	end

	obj:ondespawn()
	obj:_dispose()
	obj.world = nil
end

-- world:mark_for_disposal(obj)
--   Requests the object's terminal lifecycle transition. During a tick group
--   the command commits at the group barrier; outside one it commits directly
--   through the same operation.
function world_class:mark_for_disposal(obj)
	if obj.marked_for_disposal then
		return
	end
	obj.marked_for_disposal = true
	obj.active = false
	if obj._world_object_index == nil then
		return
	end
	if not self._mutation_barrier_open and not self._flushing_disposals then
		self:_commit_disposal(obj)
		return
	end
	local pending_count<const> = self._pending_disposal_count + 1
	self._pending_disposal_count = pending_count
	self._pending_disposals[pending_count] = obj
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_disposal
end

function world_class:_flush_disposals()
	local pending<const> = self._pending_disposals
	self._flushing_disposals = true
	local index = 1
	while index <= self._pending_disposal_count do
		local obj<const> = pending[index]
		pending[index] = nil
		self:_commit_disposal(obj)
		index = index + 1
	end
	self._pending_disposal_count = 0
	self._flushing_disposals = false
end

function world_class:_open_mutation_barrier()
	self._mutation_barrier_open = true
end

function world_class:_flush_structural_mutations()
	-- Lifecycle hooks may enqueue an earlier mutation kind while a later kind
	-- commits. Claim each kind before applying it and drain the whole cascade at
	-- this barrier so no Registry or space index remains stale for another group.
	local schedule_changed = false
	repeat
		if (self._pending_mutation_mask & mutation_admission) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_admission
			self:_flush_admissions()
		end
		if (self._pending_mutation_mask & mutation_object) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_object
			self:_flush_objects()
		end
		if (self._pending_mutation_mask & mutation_component) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_component
			self:_flush_components()
		end
		if (self._pending_mutation_mask & mutation_tag) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_tag
			self:_flush_tags()
		end
		if (self._pending_mutation_mask & mutation_component_detach) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_component_detach
			self:_flush_component_detaches()
		end
		if (self._pending_mutation_mask & mutation_component_attach) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_component_attach
			self:_flush_component_attaches()
		end
		if (self._pending_mutation_mask & mutation_active_space) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_active_space
			local pending_space_id<const> = self._pending_space_id
			self._pending_space_id = nil
			self:_commit_active_space(pending_space_id)
		end
		if (self._pending_mutation_mask & mutation_gameplay_clock) ~= 0 then
			self._pending_mutation_mask = self._pending_mutation_mask - mutation_gameplay_clock
			if self:_commit_gameplay_clock(self._pending_gameplay_clock_running) then
				schedule_changed = true
			end
		end
	until (self._pending_mutation_mask & structural_mutation_mask) == 0
	return schedule_changed
end

function world_class:_commit_mutation_barrier()
	local pending_mutation_mask<const> = self._pending_mutation_mask
	if pending_mutation_mask == 0 then
		self._mutation_barrier_open = false
		return
	end
	local schedule_changed = false
	if (pending_mutation_mask & structural_mutation_mask) ~= 0 then
		schedule_changed = self:_flush_structural_mutations()
	end
	self._mutation_barrier_open = false
	if (self._pending_mutation_mask & mutation_disposal) ~= 0 then
		self:_flush_disposals()
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_disposal
	end
	if (self._pending_mutation_mask & mutation_clear) ~= 0 then
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_clear
		self:_commit_clear()
		return true
	end
	if (self._pending_mutation_mask & mutation_space_unload) ~= 0 then
		self._pending_mutation_mask = self._pending_mutation_mask - mutation_space_unload
		local callbacks<const> = self._pending_space_unload_callbacks
		local contexts<const> = self._pending_space_unload_contexts
		local count<const> = self._pending_space_unload_count
		self._pending_space_unload_count = 0
		for index = 1, count do
			local callback<const> = callbacks[index]
			local context<const> = contexts[index]
			callbacks[index] = nil
			contexts[index] = nil
			callback(context)
		end
	end
	return schedule_changed
end

function world_class:_rebuild_render_visuals()
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

function world_class:_build_render_commands(draw_page)
	local draw_commands<const> = self._draw_commands
	command_list.begin(draw_commands, gp0.draw_mode_blend_half, draw_page)
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

function world_class:_render_single_page()
	self:_build_render_commands(self._draw_page)
	command_list.submit(self._draw_commands)
end

function world_class:_render_double_page()
	local draw_page<const> = self._draw_page
	self:_build_render_commands(draw_page)
	command_list.submit_fenced(self._draw_commands)
	gx_display.origin(draw_page)
	self._draw_page = self._display_page
	self._display_page = draw_page
	gx_gpu.draw_target(self._draw_page, self._page_size)
end

-- Removes every object owned by one space through the normal structural
-- disposal boundary. Space teardown is a lifecycle operation, not an active
-- query: inactive objects and admissions from the current tick group belong to
-- the same teardown.
function world_class:clear_space(space_id)
	local objects<const> = self._objects
	for index = #objects, 1, -1 do
		local obj<const> = objects[index]
		if obj.space_id == space_id then
			self:mark_for_disposal(obj)
		end
	end
	local admissions<const> = self._pending_admissions
	for index = 1, self._pending_admission_count do
		local obj<const> = admissions[index]
		if obj.space_id == space_id then
			self:mark_for_disposal(obj)
		end
	end
end

-- Unloads one space and invokes its retained completion only after every
-- disposal from the current structural scope has committed. Scene owners use
-- this boundary to construct the incoming scene without retaining both object
-- graphs at once.
function world_class:unload_space(space_id, on_unloaded, context)
	self:clear_space(space_id)
	if not self._mutation_barrier_open and not self._flushing_disposals then
		on_unloaded(context)
		return
	end
	local count<const> = self._pending_space_unload_count + 1
	self._pending_space_unload_count = count
	self._pending_space_unload_callbacks[count] = on_unloaded
	self._pending_space_unload_contexts[count] = context
	self._pending_mutation_mask = self._pending_mutation_mask | mutation_space_unload
end

function world_class:_commit_clear()
	local unload_callbacks<const> = self._pending_space_unload_callbacks
	local unload_contexts<const> = self._pending_space_unload_contexts
	for index = 1, self._pending_space_unload_count do
		unload_callbacks[index] = nil
		unload_contexts[index] = nil
	end
	self._pending_space_unload_count = 0
	self._pending_mutation_mask = self._pending_mutation_mask & ~mutation_space_unload
	self:_commit_gameplay_clock(true)
	self._visual_sequence = 0
	local objects<const> = self._objects
	while #objects > 0 do
		self:mark_for_disposal(objects[#objects])
	end
	self._system_manager:reset()
	self:set_space(self._initial_space_id)
end

function world_class:clear()
	if self._mutation_barrier_open or self._flushing_disposals then
		local objects<const> = self._objects
		for i = #objects, 1, -1 do
			self:mark_for_disposal(objects[i])
		end
		local pending_admissions<const> = self._pending_admissions
		for i = 1, self._pending_admission_count do
			self:mark_for_disposal(pending_admissions[i])
		end
		self._pending_mutation_mask = self._pending_mutation_mask | mutation_clear
		return
	end
	self:_commit_clear()
end
world = world_class.new()
world.id = 'world'
registry:register(world)

return world
