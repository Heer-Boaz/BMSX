-- world.lua
-- minimal lua world manager for system rom

local ecs = require("ecs")
local ecs_pipeline = require("ecs_pipeline")

local tickgroup = ecs.tickgroup

local world = {}
world.__index = world

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

local perf = {
	acc_sim_ms = 0,
	acc_frames = 0,
	acc_update_ms = 0,
	acc_draw_ms = 0,
	acc_cleanup_ms = 0,
	phase_ms = {},
	system_ms = {},
	system_name = {},
	system_group = {},
	last_stat_index = 1,
}

for _, group in pairs(tickgroup) do
	perf.phase_ms[group] = 0
end

local function reset_perf_accumulators(p)
	p.acc_sim_ms = 0
	p.acc_frames = 0
	p.acc_update_ms = 0
	p.acc_draw_ms = 0
	p.acc_cleanup_ms = 0
	for group, _ in pairs(p.phase_ms) do
		p.phase_ms[group] = 0
	end
	for id in pairs(p.system_ms) do
		p.system_ms[id] = nil
		p.system_name[id] = nil
		p.system_group[id] = nil
	end
end

local function record_phase_stats(p, systems, group)
	local stats = systems:get_stats()
	local total = 0
	for i = p.last_stat_index, #stats do
		local stat = stats[i]
		total = total + stat.ms
		local id = stat.id
		local current = p.system_ms[id]
		if current then
			p.system_ms[id] = current + stat.ms
		else
			p.system_ms[id] = stat.ms
			p.system_name[id] = stat.name
			p.system_group[id] = stat.group
		end
	end
	p.phase_ms[group] = p.phase_ms[group] + total
	p.last_stat_index = #stats + 1
	return total
end

local function emit_perf_log(p)
	local inv_frames = 1 / p.acc_frames
	local avg_dt = p.acc_sim_ms * inv_frames
	-- print(string.format(
	-- 	"[World] perf avg dt=%.2fms update=%.2f draw=%.2f cleanup=%.2f frames=%d",
	-- 	avg_dt,
	-- 	p.acc_update_ms * inv_frames,
	-- 	p.acc_draw_ms * inv_frames,
	-- 	p.acc_cleanup_ms * inv_frames,
	-- 	p.acc_frames
	-- ))

	local phase_parts = {}
	for i = 1, #phase_order do
		local group = phase_order[i]
		local name = tickgroup_names[group] or tostring(group)
		phase_parts[#phase_parts + 1] = string.format("%s=%.2f", name, p.phase_ms[group] * inv_frames)
	end
	-- print("[World] phases avg " .. table.concat(phase_parts, " "))

	local top = {}
	for id, ms in pairs(p.system_ms) do
		local entry = { id = id, ms = ms }
		local inserted = false
		for i = 1, #top do
			if ms > top[i].ms then
				table.insert(top, i, entry)
				inserted = true
				break
			end
		end
		if not inserted then
			top[#top + 1] = entry
		end
		if #top > 5 then
			top[#top] = nil
		end
	end
	if #top > 0 then
		local out = {}
		for i = 1, #top do
			local entry = top[i]
			local name = p.system_name[entry.id] or entry.id
			local group = p.system_group[entry.id]
			local group_name = tickgroup_names[group] or tostring(group)
			out[#out + 1] = string.format("%s(%s)=%.2f", name, group_name, entry.ms * inv_frames)
		end
		-- print("[World] top systems avg " .. table.concat(out, " "))
	end
	reset_perf_accumulators(p)
end

function world.new()
	local self = setmetatable({}, world)
	self._objects = {}
	self._by_id = {}
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.paused = false
	self.gamewidth = display_width()
	self.gameheight = display_height()
	return self
end

function world:configure_pipeline(nodes)
	return ecs_pipeline.defaultecspipelineregistry:build(self, nodes)
end

function world:apply_default_pipeline()
	local ecs_builtin = require("ecs_builtin")
	ecs_builtin.register_builtin_ecs()
	return self:configure_pipeline(ecs_builtin.default_pipeline_spec())
end

function world:spawn(obj, pos)
	self._by_id[obj.id] = obj
	self._objects[#self._objects + 1] = obj
	obj:onspawn(pos)
	return obj
end

function world:despawn(id_or_obj)
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

function world:get(id)
	return self._by_id[id]
end

function world:objects(opts)
	local scope = opts and opts.scope or "all"
	local reverse = opts and opts.reverse or false
	local index = reverse and (#self._objects + 1) or 0
	return function()
		while true do
			index = index + (reverse and -1 or 1)
			local obj = self._objects[index]
			if not obj then
				return nil
			end
			if scope == "active" then
				if obj.active then
					return obj
				end
			else
				return obj
			end
		end
	end
end

function world:objects_with_components(type_name, opts)
	local scope = opts and opts.scope or "all"
	local obj_index = 0
	local comp_index = 0
	local comp_list = nil
	local current_obj = nil

	return function()
		while true do
			if not comp_list or comp_index >= #comp_list then
				comp_list = nil
				comp_index = 0
				obj_index = obj_index + 1
				current_obj = self._objects[obj_index]
				if not current_obj then
					return nil
				end
				if scope == "active" and not current_obj.active then
					current_obj = nil
				else
					comp_list = current_obj:get_components(type_name)
					if #comp_list == 0 then
						comp_list = nil
						current_obj = nil
					end
				end
			else
				comp_index = comp_index + 1
				local comp = comp_list[comp_index]
				if comp then
					return current_obj, comp
				end
				comp_list = nil
				current_obj = nil
			end
		end
	end
end

function world:update(dt)
	self.deltatime = dt
	self.systems:begin_frame()
	perf.last_stat_index = 1
	self.current_phase = tickgroup.input
	self.systems:update_phase(self, tickgroup.input)
	perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.input)
	self.current_phase = tickgroup.actioneffect
	self.systems:update_phase(self, tickgroup.actioneffect)
	perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.actioneffect)
	self.current_phase = tickgroup.moderesolution
	self.systems:update_phase(self, tickgroup.moderesolution)
	perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.moderesolution)
	self.current_phase = tickgroup.physics
	self.systems:update_phase(self, tickgroup.physics)
	perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.physics)
	self.current_phase = tickgroup.animation
	self.systems:update_phase(self, tickgroup.animation)
	perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.animation)
	self.current_phase = nil

	local cleanup_start = $.platform.clock.perf_now()
	for i = #self._objects, 1, -1 do
		local obj = self._objects[i]
		if obj._dispose_flag then
			self._by_id[obj.id] = nil
			obj:ondespawn()
			obj:dispose()
			table.remove(self._objects, i)
		end
	end
	local cleanup_end = $.platform.clock.perf_now()
	perf.acc_cleanup_ms = perf.acc_cleanup_ms + (cleanup_end - cleanup_start)
	perf.acc_sim_ms = perf.acc_sim_ms + dt
	perf.acc_frames = perf.acc_frames + 1
end

function world:draw()
	self.current_phase = tickgroup.presentation
	self.systems:update_phase(self, tickgroup.presentation)
	perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.presentation)
	self.current_phase = tickgroup.eventflush
	self.systems:update_phase(self, tickgroup.eventflush)
	perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.eventflush)
	self.current_phase = nil
	if perf.acc_sim_ms >= 1000 then
		emit_perf_log(perf)
	end
end

function world:clear()
	for i = #self._objects, 1, -1 do
		self._objects[i]:dispose()
	end
	self._objects = {}
	self._by_id = {}
end

return {
	world = world,
	instance = world.new(),
}
