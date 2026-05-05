-- ecs_builtin.lua
-- built-in ecs pipeline registration for the system ROM runtime

local ecs<const> = require('bios/ecs/index')
local ecs_pipeline<const> = require('bios/ecs/pipeline')
local ecs_systems<const> = require('bios/ecs/systems')
local input_action_effect_system<const> = require('bios/input/action_effect/system')

local registered = false

local register_builtin_ecs<const> = function()
	if registered then
		return
	end
	local r<const> = ecs_pipeline.defaultecspipelineregistry
	-- Keep the built-in pipeline focused on systems that perform real frame work.
	-- Empty placeholder stages only add dispatch and bucket-walk overhead on the
	-- fantasy CPU, so they stay out of the default schedule until they gain
	-- concrete logic.
	r:register_many({
		{ id = 'preposition', group = ecs.tickgroup.input, default_priority = -100, create = function(p) return ecs_systems.prepositionsystem.new(p) end },
		{ id = 'behaviortrees', group = ecs.tickgroup.input, create = function(p) return ecs_systems.behaviortreesystem.new(p) end },
		{ id = 'inputactioneffects', group = ecs.tickgroup.input, default_priority = 10, create = function(p) return input_action_effect_system.inputactioneffectsystem.new(p) end },
		{ id = 'actioneffectruntime', group = ecs.tickgroup.actioneffect, default_priority = 32, create = function(p) return ecs_systems.actioneffectruntimesystem.new(p) end },
		{ id = 'objectfsm', group = ecs.tickgroup.moderesolution, create = function(p) return ecs_systems.statemachinesystem.new(p) end },
		{ id = 'boundary', group = ecs.tickgroup.physics, default_priority = 30, create = function(p) return ecs_systems.boundarysystem.new(p) end },
		{ id = 'overlapevents', group = ecs.tickgroup.physics, default_priority = 42, create = function(p) return ecs_systems.overlap2dsystem.new(p) end },
		{ id = 'tilecollision', group = ecs.tickgroup.physics, default_priority = 45, create = function(p) return ecs_systems.tilecollisionsystem.new(p) end },
		{ id = 'timeline', group = ecs.tickgroup.animation, create = function(p) return ecs_systems.timelinesystem.new(p) end },
		{ id = 'textrender', group = ecs.tickgroup.presentation, default_priority = 7, create = function(p) return ecs_systems.textrendersystem.new(p) end },
		{ id = 'spriterender', group = ecs.tickgroup.presentation, default_priority = 8, create = function(p) return ecs_systems.spriterendersystem.new(p) end },
		{ id = 'lightrender', group = ecs.tickgroup.presentation, default_priority = 8.5, create = function(p) return ecs_systems.lightrendersystem.new(p) end },
		{ id = 'meshrender', group = ecs.tickgroup.presentation, default_priority = 9, create = function(p) return ecs_systems.meshrendersystem.new(p) end },
		{ id = 'rendersubmit', group = ecs.tickgroup.presentation, default_priority = 10, create = function(p) return ecs_systems.rendersubmitsystem.new(p) end },
	})
	registered = true
end

local default_pipeline_spec<const> = function()
	return {
		{ ref = 'preposition' },
		{ ref = 'behaviortrees' },
		{ ref = 'inputactioneffects' },
		{ ref = 'actioneffectruntime' },
		{ ref = 'objectfsm' },
		{ ref = 'boundary' },
		{ ref = 'tilecollision' },
		{ ref = 'timeline' },
		{ ref = 'textrender' },
		{ ref = 'spriterender' },
		{ ref = 'lightrender' },
		{ ref = 'meshrender' },
		{ ref = 'rendersubmit' },
	}
end

return {
	register_builtin_ecs = register_builtin_ecs,
	default_pipeline_spec = default_pipeline_spec,
}
