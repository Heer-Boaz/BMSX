-- ecs.lua
-- ecs core types and system manager for lua engine

local tickgroup = {
	input = 10,
	actioneffect = 20,
	moderesolution = 30,
	physics = 40,
	animation = 50,
	presentation = 60,
	eventflush = 70,
}

local ecsystem = {}
ecsystem.__index = ecsystem

function ecsystem.new(group, priority)
	local self = setmetatable({}, ecsystem)
	self.group = group
	self.priority = priority or 0
	self.__ecs_id = nil
	self.runs_while_paused = false
	return self
end

function ecsystem:update(_world)
end

local ecsystemmanager = {}
ecsystemmanager.__index = ecsystemmanager

function ecsystemmanager.new()
	local self = setmetatable({}, ecsystemmanager)
	self.systems = {}
	self.stats = {}
	return self
end

function ecsystemmanager:register(sys)
	self.systems[#self.systems + 1] = sys
	table.sort(self.systems, function(a, b)
		if a.group ~= b.group then
			return a.group < b.group
		end
		if a.priority ~= b.priority then
			return a.priority < b.priority
		end
		return false
	end)
end

function ecsystemmanager:unregister(sys)
	for i = #self.systems, 1, -1 do
		if self.systems[i] == sys then
			table.remove(self.systems, i)
			break
		end
	end
end

function ecsystemmanager:clear()
	self.systems = {}
	self.stats = {}
end

function ecsystemmanager:begin_frame()
	self.stats = {}
end

function ecsystemmanager:get_stats()
	return self.stats
end

function ecsystemmanager:record_stat(sys, t0, t1)
	local id = sys.__ecs_id or sys.id or "system"
	self.stats[#self.stats + 1] = {
		id = id,
		name = sys.name or id,
		group = sys.group,
		priority = sys.priority,
		ms = t1 - t0,
	}
end

function ecsystemmanager:update_until(world, max_group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group <= max_group then
			local t0 = $.platform.clock.perf_now()
			s:update(world)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:update_from(world, min_group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group >= min_group then
			local t0 = $.platform.clock.perf_now()
			s:update(world)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:update_phase(world, group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group == group then
			local t0 = $.platform.clock.perf_now()
			s:update(world)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:run_paused(world)
	self:begin_frame()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.runs_while_paused then
			local t0 = $.platform.clock.perf_now()
			s:update(world)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

return {
	tickgroup = tickgroup,
	ecsystem = ecsystem,
	ecsystemmanager = ecsystemmanager,
}
