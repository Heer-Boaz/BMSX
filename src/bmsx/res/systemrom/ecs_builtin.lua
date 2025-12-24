-- ecs_builtin.lua
-- built-in ecs pipeline registration for lua engine

local ecs = require("ecs")
local ecs_pipeline = require("ecs_pipeline")
local ecs_systems = require("ecs_systems")
local input_action_effect_system = require("input_action_effect_system")

local registered = false

local function register_builtin_ecs()
	if registered then
		return
	end
	local r = ecs_pipeline.defaultecspipelineregistry
	r:register_many({
		{ id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behaviortreesystem.new(p) end },
		{ id = "inputactioneffects", group = ecs.tickgroup.input, default_priority = 10, create = function(p) return input_action_effect_system.inputactioneffectsystem.new(p) end },
		{ id = "actioneffectruntime", group = ecs.tickgroup.actioneffect, create = function(p) return ecs_systems.actioneffectruntimesystem.new(p) end },
		{ id = "objectfsm", group = ecs.tickgroup.moderesolution, create = function(p) return ecs_systems.statemachinesystem.new(p) end },
		{ id = "objecttick", group = ecs.tickgroup.moderesolution, default_priority = 10, create = function(p) return ecs_systems.objectticksystem.new(p) end },
		{ id = "preposition", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.prepositionsystem.new(p) end },
		{ id = "physicssyncbefore", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncbeforestepsystem.new(p) end },
		{ id = "physicsstep", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicsworldstepsystem.new(p) end },
		{ id = "physicspost", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicspostsystem.new(p) end },
		{ id = "tilecollision", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.tilecollisionsystem.new(p) end },
		{ id = "boundary", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.boundarysystem.new(p) end },
		{ id = "physicscollisionevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicscollisioneventsystem.new(p) end },
		{ id = "physicssyncafterworld", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncafterworldcollisionsystem.new(p) end },
		{ id = "overlapevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.overlap2dsystem.new(p) end },
		{ id = "transform", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.transformsystem.new(p) end },
		{ id = "timeline", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.timelinesystem.new(p) end },
		{ id = "meshanim", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.meshanimationsystem.new(p) end },
		{ id = "textrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.textrendersystem.new(p) end },
		{ id = "spriterender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.spriterendersystem.new(p) end },
		{ id = "meshrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.meshrendersystem.new(p) end },
		{ id = "rendersubmit", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.rendersubmitsystem.new(p) end },
		{ id = "eventflush", group = ecs.tickgroup.eventflush, create = function(p) return ecs_systems.eventflushsystem.new(p) end },
	})
	registered = true
end

local function default_pipeline_spec()
	return {
		{ ref = "behaviortrees" },
		{ ref = "inputactioneffects" },
		{ ref = "actioneffectruntime" },
		{ ref = "objectfsm" },
		{ ref = "objecttick" },
		{ ref = "preposition" },
		{ ref = "physicssyncbefore" },
		{ ref = "physicsstep" },
		{ ref = "physicspost" },
		{ ref = "tilecollision" },
		{ ref = "boundary" },
		{ ref = "physicscollisionevents" },
		{ ref = "physicssyncafterworld" },
		{ ref = "overlapevents" },
		{ ref = "transform" },
		{ ref = "timeline" },
		{ ref = "meshanim" },
		{ ref = "textrender" },
		{ ref = "spriterender" },
		{ ref = "meshrender" },
		{ ref = "rendersubmit" },
		{ ref = "eventflush" },
	}
end

return {
	register_builtin_ecs = register_builtin_ecs,
	default_pipeline_spec = default_pipeline_spec,
}
