-- ecs.lua
-- ECS core types and system manager for Lua engine

local TickGroup = {
	Input = 10,
	ActionEffect = 20,
	ModeResolution = 30,
	Physics = 40,
	Animation = 50,
	Presentation = 60,
	EventFlush = 70,
}

local ECSystem = {}
ECSystem.__index = ECSystem

function ECSystem.new(group, priority)
	local self = setmetatable({}, ECSystem)
	self.group = group
	self.priority = priority or 0
	self.__ecs_id = nil
	self.runs_while_paused = false
	return self
end

function ECSystem:update(_world)
end

local ECSystemManager = {}
ECSystemManager.__index = ECSystemManager

function ECSystemManager.new()
	local self = setmetatable({}, ECSystemManager)
	self.systems = {}
	self.stats = {}
	return self
end

function ECSystemManager:register(sys)
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

function ECSystemManager:unregister(sys)
	for i = #self.systems, 1, -1 do
		if self.systems[i] == sys then
			table.remove(self.systems, i)
			break
		end
	end
end

function ECSystemManager:clear()
	self.systems = {}
	self.stats = {}
end

function ECSystemManager:begin_frame()
	self.stats = {}
end

function ECSystemManager:get_stats()
	return self.stats
end

function ECSystemManager:record_stat(sys, t0, t1)
	local id = sys.__ecs_id or sys.id or "system"
	self.stats[#self.stats + 1] = {
		id = id,
		name = sys.name or id,
		group = sys.group,
		priority = sys.priority,
		ms = t1 - t0,
	}
end

function ECSystemManager:update_until(world, max_group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group <= max_group then
			local t0 = $.platform.clock.now()
			s:update(world)
			local t1 = $.platform.clock.now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ECSystemManager:update_from(world, min_group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group >= min_group then
			local t0 = $.platform.clock.now()
			s:update(world)
			local t1 = $.platform.clock.now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ECSystemManager:update_phase(world, group)
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group == group then
			local t0 = $.platform.clock.now()
			s:update(world)
			local t1 = $.platform.clock.now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ECSystemManager:run_paused(world)
	self:begin_frame()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.runs_while_paused then
			local t0 = $.platform.clock.now()
			s:update(world)
			local t1 = $.platform.clock.now()
			self:record_stat(s, t0, t1)
		end
	end
end

return {
	TickGroup = TickGroup,
	ECSystem = ECSystem,
	ECSystemManager = ECSystemManager,
}
