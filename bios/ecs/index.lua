-- ecs.lua
-- ecs core types and system manager for the system ROM runtime
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
--      presentation   (60) — emit 2D blits / submit render work
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
--          blit(self.x, self.y, self.sprite_id)  -- runs per-object
--      end
--    RIGHT — register a render system in the presentation group:
--      local mysystem = ecsystem.new(tickgroup.presentation, priority)
--      function mysystem:update()
--          for obj in world_instance:objects() do
--              if obj.components['spritecomponent'] then
--                  blit(obj.x, obj.y, obj.sprite_id)
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

local tickgroup<const> = {
	input = 10,
	actioneffect = 20,
	moderesolution = 30,
	physics = 40,
	animation = 50,
	presentation = 60,
	eventflush = 70,
}

local ecsystem<const> = {}
ecsystem.__index = ecsystem

function ecsystem.new(group, priority)
	local self<const> = setmetatable({}, ecsystem)
	self.group = group
	self.priority = priority or 0
	self.__ecs_id = nil
	return self
end

local ecsystemmanager<const> = {}
ecsystemmanager.__index = ecsystemmanager

local new_phase_buckets<const> = function()
	return {
		[tickgroup.input] = {},
		[tickgroup.actioneffect] = {},
		[tickgroup.moderesolution] = {},
		[tickgroup.physics] = {},
		[tickgroup.animation] = {},
		[tickgroup.presentation] = {},
		[tickgroup.eventflush] = {},
	}
end

-- Build phase-local views when the system graph changes, not every frame.
-- That keeps the frame hot path as a straight iteration over the systems that
-- actually belong to the requested phase, instead of rescanning the full
-- system list and re-checking each group's membership over and over. Keep the
-- sort stable on registration order so removing or adding one system does not
-- silently reshuffle equal-priority siblings elsewhere in the phase.
local rebuild_system_views<const> = function(self)
	table.sort(self.systems, function(a, b)
		if a.group ~= b.group then
			return a.group < b.group
		end
		if a.priority ~= b.priority then
			return a.priority < b.priority
		end
		return a.__ecs_reg_index < b.__ecs_reg_index
	end)

	local phase_systems<const> = new_phase_buckets()
	local phase_counts<const> = {
		[tickgroup.input] = 0,
		[tickgroup.actioneffect] = 0,
		[tickgroup.moderesolution] = 0,
		[tickgroup.physics] = 0,
		[tickgroup.animation] = 0,
		[tickgroup.presentation] = 0,
		[tickgroup.eventflush] = 0,
	}
	for i = 1, #self.systems do
		local sys<const> = self.systems[i]
		local group<const> = sys.group
		local bucket<const> = phase_systems[group]
		local bucket_index<const> = phase_counts[group] + 1
		phase_counts[group] = bucket_index
		bucket[bucket_index] = sys
	end
	self.phase_systems = phase_systems
	self.phase_counts = phase_counts
end

function ecsystemmanager.new()
	local self<const> = setmetatable({}, ecsystemmanager)
	self:clear()
	return self
end

function ecsystemmanager:register(sys)
	self.registration_serial = self.registration_serial + 1
	sys.__ecs_reg_index = self.registration_serial
	self.systems[#self.systems + 1] = sys
	rebuild_system_views(self)
end

function ecsystemmanager:unregister(sys)
	for i = #self.systems, 1, -1 do
		if self.systems[i] == sys then
			table.remove(self.systems, i)
			break
		end
	end
	rebuild_system_views(self)
end

function ecsystemmanager:clear()
	self.systems = {}
	self.registration_serial = 0
	self.phase_systems = new_phase_buckets()
	self.phase_counts = {
		[tickgroup.input] = 0,
		[tickgroup.actioneffect] = 0,
		[tickgroup.moderesolution] = 0,
		[tickgroup.physics] = 0,
		[tickgroup.animation] = 0,
		[tickgroup.presentation] = 0,
		[tickgroup.eventflush] = 0,
	}
end

function ecsystemmanager:update_phase(group, dt_ms)
	-- update_phase is a frame hot path. It must walk a prefiltered phase bucket
	-- instead of filtering self.systems every time. Keep the bucket layout flat:
	-- nested records and cached method arrays added more table traffic than they
	-- saved on this VM, while one shared frame dt still removes repeated host
	-- clock calls from every phase dispatch.
	local systems<const> = self.phase_systems[group]
	for i = 1, self.phase_counts[group] do
		systems[i]:update(dt_ms)
	end
end

return {
	tickgroup = tickgroup,
	ecsystem = ecsystem,
	ecsystemmanager = ecsystemmanager,
}
