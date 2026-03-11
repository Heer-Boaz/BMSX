-- ecs.lua
-- ecs core types and system manager for lua engine
--
-- DESIGN PRINCIPLES — ECS systems vs per-object logic
--
-- 1. TICK GROUPS (execution order within each frame).
--    Systems are assigned to a tick group; all systems in a lower-numbered
--    group run before those in a higher-numbered group.
--
--      input          (10) — read player/AI input, dispatch FSM input events
--      actioneffect   (20) — process queued action effects
--      moderesolution (30) — resolve mode / space switches
--      physics        (40) — movement, collision, position integration
--      animation      (50) — advance timelines, sprite frame selection
--      presentation   (60) — build draw calls / render all objects
--      eventflush     (70) — flush deferred events after all updates
--
-- 2. USE ECS SYSTEMS FOR SHARED PER-FRAME WORK.
--    Logic that runs the same way for every object of a given type (e.g.
--    sprite rendering, collision, timeline ticking) belongs in an ecsystem,
--    not in each object's update() method.  The system iterates all active
--    objects in one pass, which is cheaper than N separate update() calls
--    and avoids duplicating the iteration + filter logic.
--
--    WRONG — per-object rendering inside update():
--      function my_object:update()
--          put_sprite(self.x, self.y, self.sprite_id)  -- runs per-object
--      end
--    RIGHT — register a render system in the presentation group:
--      local mysystem = ecsystem.new(tickgroup.presentation, priority)
--      function mysystem:update()
--          for obj in world_instance:objects({ scope = 'active' }) do
--              if obj.components['spritecomponent'] then
--                  put_sprite(obj.x, obj.y, obj.sprite_id)
--              end
--          end
--      end
--
-- 3. OBJECT update() IS FOR OBJECT-SPECIFIC LOGIC ONLY.
--    An object's update() method is called by the FSM (as the current state's
--    `update` function) or directly if active = true.  Restrict it to
--    logic that is meaningfully different per object instance (e.g. custom AI,
--    state-specific physics).  Never put generic rendering or component
--    processing there.

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

function ecsystem:update(_dt_ms)
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
	local id = sys.__ecs_id or sys.id or 'system'
	self.stats[#self.stats + 1] = {
		id = id,
		name = sys.name or id,
		group = sys.group,
		priority = sys.priority,
		ms = t1 - t0,
	}
end

function ecsystemmanager:update_until(max_group)
	local dt_ms = $.get_frame_delta_ms()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group <= max_group then
			local t0 = $.platform.clock.perf_now()
			s:update(dt_ms)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:update_from(min_group)
	local dt_ms = $.get_frame_delta_ms()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group >= min_group then
			local t0 = $.platform.clock.perf_now()
			s:update(dt_ms)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:update_phase(group)
	local dt_ms = $.get_frame_delta_ms()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.group == group then
			local t0 = $.platform.clock.perf_now()
			s:update(dt_ms)
			local t1 = $.platform.clock.perf_now()
			self:record_stat(s, t0, t1)
		end
	end
end

function ecsystemmanager:run_paused()
	self:begin_frame()
	local dt_ms = $.get_frame_delta_ms()
	for i = 1, #self.systems do
		local s = self.systems[i]
		if s.runs_while_paused then
			local t0 = $.platform.clock.perf_now()
			s:update(dt_ms)
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
