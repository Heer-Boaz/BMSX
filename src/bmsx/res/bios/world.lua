-- world.lua
-- central world: owns all objects, spaces, and the ECS system manager
--
-- DESIGN PRINCIPLES
--
-- 1. SPACES partition the world into independently-updated subsets.
--    There is always a "main" space. Add more with world:add_space(id).
--    The "active" space is set with world:set_space(id); only objects in the
--    active space are returned by world:objects({scope="active"}).
--    Use spaces for: UI layer, background layer, loading screens, etc.
--    Objects default to the active space at spawn unless they set .space_id.
--
-- 2. SPAWN / DESPAWN IS THE ONLY WAY TO ADD OR REMOVE OBJECTS.
--    Never add objects to the internal tables directly.
--    world:spawn(obj)         — calls obj:onspawn(), adds to active space
--    world:despawn(id_or_obj) — calls obj:ondespawn() + obj:dispose()
--
-- 3. SCOPE PARAMETER IN objects() / objects_with_components()
--    "all"    — every object regardless of active space or active state
--    "active" — only objects in the current active space that are active
--    Always pass scope="active" for gameplay logic; use "all" only for
--    serialization or global queries.
--
-- 4. world_instance IS THE GLOBAL SINGLETON.
--    Access via  require("world").instance. Do not create extra world.new().
--
-- 5. NEVER ITERATE AND MUTATE at the same time.
--    Do not spawn/despawn while iterating world:objects(). If you need to
--    defer a spawn/despawn, use a queue and process it after the loop.

local ecs = require("ecs")
local registry = require("registry")

local tickgroup = ecs.tickgroup
local world_instance

local world_class = {}
world_class.__index = world_class

local tickgroup_names = {}
for name, value in pairs(tickgroup) do
	tickgroup_names[value] = name
end

local phase_order = {
	tickgroup.input,
	tickgroup.actioneffect,
	tickgroup.moderesolution,
	tickgroup.physics,
	tickgroup.animation,
	tickgroup.presentation,
	tickgroup.eventflush,
}

-- local perf = {
-- 	acc_sim_ms = 0,
-- 	acc_frames = 0,
-- 	acc_update_ms = 0,
-- 	acc_draw_ms = 0,
-- 	acc_cleanup_ms = 0,
-- 	phase_ms = {},
-- 	system_ms = {},
-- 	system_name = {},
-- 	system_group = {},
-- 	last_stat_index = 1,
-- }

-- for _, group in pairs(tickgroup) do
-- 	perf.phase_ms[group] = 0
-- end

-- local function reset_perf_accumulators(p)
-- 	p.acc_sim_ms = 0
-- 	p.acc_frames = 0
-- 	p.acc_update_ms = 0
-- 	p.acc_draw_ms = 0
-- 	p.acc_cleanup_ms = 0
-- 	for group, _ in pairs(p.phase_ms) do
-- 		p.phase_ms[group] = 0
-- 	end
-- 	for id in pairs(p.system_ms) do
-- 		p.system_ms[id] = nil
-- 		p.system_name[id] = nil
-- 		p.system_group[id] = nil
-- 	end
-- end

-- local function record_phase_stats(p, systems, group)
-- 	local stats = systems:get_stats()
-- 	local total = 0
-- 	for i = p.last_stat_index, #stats do
-- 		local stat = stats[i]
-- 		total = total + stat.ms
-- 		local id = stat.id
-- 		local current = p.system_ms[id]
-- 		if current then
-- 			p.system_ms[id] = current + stat.ms
-- 		else
-- 			p.system_ms[id] = stat.ms
-- 			p.system_name[id] = stat.name
-- 			p.system_group[id] = stat.group
-- 		end
-- 	end
-- 	p.phase_ms[group] = p.phase_ms[group] + total
-- 	p.last_stat_index = #stats + 1
-- 	return total
-- end

-- local function emit_perf_log(p)
-- 	local inv_frames = 1 / p.acc_frames
-- 	local avg_dt = p.acc_sim_ms * inv_frames
	-- print(string.format(
	-- 	"[World] perf avg dt=%.2fms update=%.2f draw=%.2f cleanup=%.2f frames=%d",
	-- 	avg_dt,
	-- 	p.acc_update_ms * inv_frames,
	-- 	p.acc_draw_ms * inv_frames,
	-- 	p.acc_cleanup_ms * inv_frames,
	-- 	p.acc_frames
	-- ))

	-- local phase_parts = {}
	-- for i = 1, #phase_order do
	-- 	local group = phase_order[i]
	-- 	local name = tickgroup_names[group] or tostring(group)
	-- 	phase_parts[#phase_parts + 1] = string.format("%s=%.2f", name, p.phase_ms[group] * inv_frames)
	-- end
	-- print("[World] phases avg " .. table.concat(phase_parts, " "))

-- 	local top = {}
-- 	for id, ms in pairs(p.system_ms) do
-- 		local entry = { id = id, ms = ms }
-- 		local inserted = false
-- 		for i = 1, #top do
-- 			if ms > top[i].ms then
-- 				table.insert(top, i, entry)
-- 				inserted = true
-- 				break
-- 			end
-- 		end
-- 		if not inserted then
-- 			top[#top + 1] = entry
-- 		end
-- 		if #top > 5 then
-- 			top[#top] = nil
-- 		end
-- 	end
-- 	if #top > 0 then
-- 		local out = {}
-- 		for i = 1, #top do
-- 			local entry = top[i]
-- 			local name = p.system_name[entry.id] or entry.id
-- 			local group = p.system_group[entry.id]
-- 			local group_name = tickgroup_names[group] or tostring(group)
-- 			out[#out + 1] = string.format("%s(%s)=%.2f", name, group_name, entry.ms * inv_frames)
-- 		end
-- 		-- print("[World] top systems avg " .. table.concat(out, " "))
-- 	end
-- 	reset_perf_accumulators(p)
-- end

local function iter_objects(state, _)
	local list = state.list
	local scope = state.scope
	local index = state.index + state.step
	while true do
		local obj = list[index]
		if not obj then
			return nil
		end
		if state.world:_object_in_scope(obj, scope) then
			state.index = index
			return obj
		end
		index = index + state.step
	end
end

local function iter_objects_with_components(state, _)
	local objects = state.list
	while true do
		local comp_list = state.comp_list
		if comp_list then
			local comp_index = state.comp_index + 1
			local comp = comp_list[comp_index]
			if comp then
				state.comp_index = comp_index
				return state.current_obj, comp
			end
			state.comp_list = nil
			state.current_obj = nil
			state.comp_index = 0
		end

		local obj_index = state.obj_index + 1
		local obj = objects[obj_index]
		if not obj then
			return nil
		end
		state.obj_index = obj_index
		if state.world:_object_in_scope(obj, state.scope) then
			local list = obj:get_components(state.type_name)
			if #list > 0 then
				state.current_obj = obj
				state.comp_list = list
				state.comp_index = 0
			end
		end
	end
end

function world_class.new()
	local self = setmetatable({}, world_class)
	self._objects = {}
	self._by_id = {}
	self._spaces = {}
	self._space_order = {}
	self._obj_to_space = {}
	self.active_space_id = "main"
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.paused = false
	self.gamewidth = display_width()
	self.gameheight = display_height()
	-- id counter for unique id generation
	self.idcounter = 0
	self:add_space("main")
	return self
end

-- world:add_space(space_id)
--   Registers a new named space. Returns false if the space already exists.
--   Must be called before any object is spawned into that space.
function world_class:add_space(space_id)
	if type(space_id) ~= "string" then
		error("world.add_space expects a non-empty space id")
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
--   Affects the "active" scope in objects() / objects_with_components().
--   Errors if space_id is not registered.
function world_class:set_space(space_id)
	if self._spaces[space_id] == nil then
		error("world.set_space unknown space id '" .. tostring(space_id) .. "'.")
	end
	self.active_space_id = space_id
	return self.active_space_id
end

function world_class:get_space()
	return self.active_space_id
end

function world_class:list_spaces()
	return self._space_order
end

function world_class:set_object_space(obj, space_id)
	local target_space = self._spaces[space_id]
	if target_space == nil then
		error("world.set_object_space unknown space id '" .. tostring(space_id) .. "'.")
	end

	local object_id = obj.id
	if self._by_id[object_id] == nil then
		obj.space_id = space_id
		return space_id
	end

	local current_space_id = self._obj_to_space[object_id]
	if current_space_id == space_id then
		obj.space_id = space_id
		return space_id
	end

	if current_space_id ~= nil then
		local current_space = self._spaces[current_space_id]
		current_space.by_id[object_id] = nil
		local current_space_objects = current_space.objects
		for i = #current_space_objects, 1, -1 do
			if current_space_objects[i] == obj then
				table.remove(current_space_objects, i)
				break
			end
		end
	end

	local target_space_objects = target_space.objects
	target_space_objects[#target_space_objects + 1] = obj
	target_space.by_id[object_id] = obj
	self._obj_to_space[object_id] = space_id
	obj.space_id = space_id
	return space_id
end

function world_class:_object_in_scope(obj, scope)
	if obj.dispose_flag then
		return false
	end
	if scope == "active" then
		if not obj.active then
			return false
		end
		return self._obj_to_space[obj.id] == self.active_space_id
	end
	return true
end

-- world:spawn(obj, pos?)
--   Registers obj in the world (and in the active space unless obj.space_id is
--   pre-set) then calls obj:onspawn(pos).
--   obj.id must be unique. Returns obj.
function world_class:spawn(obj, pos)
	local space_id = obj.space_id
	if space_id == nil then
		space_id = self.active_space_id
	end
	self._by_id[obj.id] = obj
	self._objects[#self._objects + 1] = obj
	self:set_object_space(obj, space_id)
	registry.instance:register(obj)
	obj:onspawn(pos)
	return obj
end

-- world:despawn(id_or_obj)
--   Removes the object from the world and its space, then calls
--   obj:ondespawn() and obj:dispose(). Does nothing if obj is nil.
--   Do not call during an objects() iteration loop.
function world_class:despawn(id_or_obj)
	local obj
	if type(id_or_obj) ~= "table" then
		obj = self._by_id[id_or_obj]
	else
		obj = id_or_obj
	end

	local object_id = obj.id
	local space_id = self._obj_to_space[object_id]
	if space_id ~= nil then
		local space = self._spaces[space_id]
		space.by_id[object_id] = nil
		local space_objects = space.objects
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
	local obj = self._by_id[id]
	if obj == nil then
		return nil
	end
	if obj.dispose_flag then
		return nil
	end
	return obj
end

-- world:objects(opts?)
--   Iterator over all objects matching opts:
--     opts.scope   — "all" (default) or "active" (current space + active flag)
--     opts.reverse — iterate in reverse order when true
--   Usage:  for obj in world_instance:objects({scope="active"}) do … end
--   Do NOT spawn or despawn inside this loop.
function world_class:objects(opts)
	local scope = opts and opts.scope or "all"
	local reverse = opts and opts.reverse or false
	local step = reverse and -1 or 1
	local start = reverse and (#self._objects + 1) or 0
	return iter_objects, { world = self, list = self._objects, scope = scope, step = step, index = start }, nil
end

-- world:objects_with_components(type_name, opts?)
--   Iterator that yields (obj, component_handle) for every component of the
--   given type on every matching object. opts.scope follows the same rules as
--   world:objects(). Used by ECS systems; rarely needed in cart code.
function world_class:objects_with_components(type_name, opts)
	local scope = opts and opts.scope or "all"
	return iter_objects_with_components,
		{ world = self, list = self._objects, type_name = type_name, scope = scope, obj_index = 0, comp_index = 0, comp_list = nil, current_obj = nil },
		nil
end

function world_class:update()
	self.systems:begin_frame()
	-- perf.last_stat_index = 1
	self.current_phase = tickgroup.input
	self.systems:update_phase(tickgroup.input)
	-- perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.input)
	self.current_phase = tickgroup.actioneffect
	self.systems:update_phase(tickgroup.actioneffect)
	-- perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.actioneffect)
	self.current_phase = tickgroup.moderesolution
	self.systems:update_phase(tickgroup.moderesolution)
	-- perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.moderesolution)
	self.current_phase = tickgroup.physics
	self.systems:update_phase(tickgroup.physics)
	-- perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.physics)
	self.current_phase = tickgroup.animation
	self.systems:update_phase(tickgroup.animation)
	-- perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.animation)
	self.current_phase = nil

	-- local cleanup_start = $.platform.clock.perf_now()
	for i = #self._objects, 1, -1 do
		local obj = self._objects[i]
		if obj.dispose_flag then
			local object_id = obj.id
			local space_id = self._obj_to_space[object_id]
			if space_id ~= nil then
				local space = self._spaces[space_id]
				space.by_id[object_id] = nil
				local space_objects = space.objects
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
			obj:dispose()
			table.remove(self._objects, i)
		end
	end
	-- local cleanup_end = $.platform.clock.perf_now()
	-- perf.acc_cleanup_ms = perf.acc_cleanup_ms + (cleanup_end - cleanup_start)
	-- perf.acc_sim_ms = perf.acc_sim_ms + dt
	-- perf.acc_frames = perf.acc_frames + 1
end

function world_class:draw()
	self.current_phase = tickgroup.presentation
	self.systems:update_phase(tickgroup.presentation)
	-- perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.presentation)
	self.current_phase = tickgroup.eventflush
	self.systems:update_phase(tickgroup.eventflush)
	-- perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.eventflush)
	self.current_phase = nil
	-- if perf.acc_sim_ms >= 1000 then
	-- 	emit_perf_log(perf)
	-- end
end

function world_class:clear()
	for i = #self._objects, 1, -1 do
		self._objects[i]:dispose()
	end
	self._objects = {}
	self._by_id = {}
	self._spaces = {}
	self._space_order = {}
	self._obj_to_space = {}
	registry.instance:clear()
	self:add_space("main")
	self.active_space_id = "main"
end
world_instance = world_class.new()
world_instance.id = "world"
world_instance.registrypersistent = true
registry.instance:register(world_instance)

return {
	world = world_class,
	instance = world_instance,
}
