local ecs = require("ecs")
local ecs_pipeline = require("ecs_pipeline")

local tickgroup = ecs.tickgroup

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

-- returns next id number and increments the internal counter.
-- accepts being called either as an instance method (world:getnextidnumber())
-- or as a function on the module/instance (world.getnextidnumber()).
function world_class.getnextidnumber(self)
	local w = self
	-- support being called without passing self (e.g. world.getnextidnumber())
	if type(w) ~= "table" or rawget(w, "idcounter") == nil then
		w = require("world").instance
	end
	if not w.idcounter then
		w.idcounter = 1
	end
	if w.idcounter >= math.maxinteger then
		error("id counter exhausted: max safe integer reached")
	end
	local nextnumber = w.idcounter
	w.idcounter = nextnumber + 1
	return nextnumber
end

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
	self._spaces = { default = true }
	self._space_order = { "default" }
	self.active_space_id = "default"
	self.ui_space_id = "ui"
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.paused = false
	self.gamewidth = display_width()
	self.gameheight = display_height()
	-- id counter for unique id generation
	self.idcounter = 1
	return self
end

function world_class:add_space(space_id)
	if type(space_id) ~= "string" or space_id == "" then
		error("world.add_space expects a non-empty space id")
	end
	if self._spaces[space_id] then
		return false
	end
	self._spaces[space_id] = true
	self._space_order[#self._space_order + 1] = space_id
	return true
end

function world_class:set_space(space_id)
	self:add_space(space_id)
	self.active_space_id = space_id
	return self.active_space_id
end

function world_class:get_space()
	return self.active_space_id
end

function world_class:list_spaces()
	return self._space_order
end

function world_class:_object_space_id(obj)
	local space_id = obj.space_id
	if space_id == nil or space_id == "" then
		return "default"
	end
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
		local space_id = self:_object_space_id(obj)
		if space_id == self.active_space_id then
			return true
		end
		return space_id == self.ui_space_id
	end
	return true
end

function world_class:configure_pipeline(nodes)
	return ecs_pipeline.defaultecspipelineregistry:build(nodes)
end

function world_class:apply_default_pipeline()
	local ecs_builtin = require("ecs_builtin")
	ecs_builtin.register_builtin_ecs()
	return self:configure_pipeline(ecs_builtin.default_pipeline_spec())
end

function world_class:spawn(obj, pos)
	local space_id = self:_object_space_id(obj)
	self:add_space(space_id)
	obj.space_id = space_id
	self._by_id[obj.id] = obj
	self._objects[#self._objects + 1] = obj
	obj:onspawn(pos)
	return obj
end

function world_class:despawn(id_or_obj)
	local obj = id_or_obj
	if type(id_or_obj) ~= "table" then
		obj = self._by_id[id_or_obj]
	end
	obj:ondespawn()
	obj:dispose()
	self._by_id[obj.id] = nil
	for i = #self._objects, 1, -1 do
		if self._objects[i] == obj then
			table.remove(self._objects, i)
			break
		end
	end
end

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

function world_class:objects(opts)
	local scope = opts and opts.scope or "all"
	local reverse = opts and opts.reverse or false
	local step = reverse and -1 or 1
	local start = reverse and (#self._objects + 1) or 0
	return iter_objects, { world = self, list = self._objects, scope = scope, step = step, index = start }, nil
end

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
			self._by_id[obj.id] = nil
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
	self._spaces = { default = true }
	self._space_order = { "default" }
	self.active_space_id = "default"
end

return {
	world = world_class,
	instance = world_class.new(),
}
