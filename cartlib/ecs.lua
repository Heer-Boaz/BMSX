-- ECS core types and system manager for the cart runtime.
--
-- DESIGN PRINCIPLES — ECS systems vs per-object logic
--
-- 1. TICK GROUPS (execution order within each frame).
--    Systems are assigned to a tick group; all systems in a lower-numbered
--    group run before those in a higher-numbered group.
--
--      input          (10) — read player/AI input, dispatch FSM input events
--      action_effects (20) — process queued action effects
--      gameplay       (30) — update state machines and game-specific systems
--      physics        (40) — movement, collision, position integration
--      animation      (50) — advance timelines, sprite frame selection
--      presentation   (60) — submit retained visual components
--
-- 2. USE ECS SYSTEMS FOR SHARED PER-FRAME WORK.
--    Logic that runs the same way for every object of a given type (e.g.
--    sprite rendering, collision, timeline ticking) belongs in an ECS system,
--    not in each object's update() method.  The system iterates all active
--    objects in one pass, which is cheaper than N separate update() calls
--    and avoids duplicating the iteration + filter logic.
--
--    WRONG — per-object rendering inside update():
--      function my_object:update()
--          blit(self.x, self.y, self.sprite_id)  -- runs per-object
--      end
--    RIGHT — attach a visual component. The retained visual list sorts all
--    visual kinds by effective z and the single visual system submits them.
--
-- 3. OBJECT update() IS FOR OBJECT-SPECIFIC LOGIC ONLY.
--    An object's update() method is called by the FSM (as the current state's
--    `update` function) or directly if active = true.  Restrict it to
--    logic that is meaningfully different per object instance (e.g. custom AI,
--    state-specific physics).  Never put generic rendering or component
--    processing there.

local tick_group<const> = {
	input = 10,
	action_effects = 20,
	gameplay = 30,
	physics = 40,
	animation = 50,
	presentation = 60,
}

local system<const> = {}
system.__index = system

function system.new(group, priority)
	local self<const> = setmetatable({}, system)
	self.group = group
	self.priority = priority or 0
	return self
end

local system_manager<const> = {}
system_manager.__index = system_manager

local new_phase_buckets<const> = function()
	return {
		[tick_group.input] = {},
		[tick_group.action_effects] = {},
		[tick_group.gameplay] = {},
		[tick_group.physics] = {},
		[tick_group.animation] = {},
		[tick_group.presentation] = {},
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
		[tick_group.input] = 0,
		[tick_group.action_effects] = 0,
		[tick_group.gameplay] = 0,
		[tick_group.physics] = 0,
		[tick_group.animation] = 0,
		[tick_group.presentation] = 0,
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

function system_manager.new()
	local self<const> = setmetatable({}, system_manager)
	self:clear()
	return self
end

function system_manager:replace(system_factories)
	local systems<const> = {}
	local component_types<const> = {}
	for i = 1, #system_factories do
		local system<const> = system_factories[i]()
		system.__ecs_reg_index = i
		systems[i] = system
		local query_types<const> = system.component_types
		if query_types then
			for type_index = 1, #query_types do
				component_types[#component_types + 1] = query_types[type_index]
			end
		end
	end
	self.systems = systems
	self.component_types = component_types
	rebuild_system_views(self)
end

function system_manager:clear()
	self.systems = {}
	self.component_types = {}
	self.phase_systems = new_phase_buckets()
	self.phase_counts = {
		[tick_group.input] = 0,
		[tick_group.action_effects] = 0,
		[tick_group.gameplay] = 0,
		[tick_group.physics] = 0,
		[tick_group.animation] = 0,
		[tick_group.presentation] = 0,
	}
end

function system_manager:update_phase(group, dt_ms)
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
	tick_group = tick_group,
	system = system,
	system_manager = system_manager,
}
