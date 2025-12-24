-- ecs_builtin.lua
-- Built-in ECS pipeline registration for Lua engine

local ecs = require("ecs")
local ecs_pipeline = require("ecs_pipeline")
local ecs_systems = require("ecs_systems")
local input_action_effect_system = require("input_action_effect_system")

local registered = false

local function register_builtin_ecs()
	if registered then
		return
	end
	local R = ecs_pipeline.DefaultECSPipelineRegistry
	R:register_many({
		{ id = "behaviorTrees", group = ecs.TickGroup.Input, create = function(p) return ecs_systems.BehaviorTreeSystem.new(p) end },
		{ id = "inputActionEffects", group = ecs.TickGroup.Input, default_priority = 10, create = function(p) return input_action_effect_system.InputActionEffectSystem.new(p) end },
		{ id = "actionEffectRuntime", group = ecs.TickGroup.ActionEffect, create = function(p) return ecs_systems.ActionEffectRuntimeSystem.new(p) end },
		{ id = "objectFSM", group = ecs.TickGroup.ModeResolution, create = function(p) return ecs_systems.StateMachineSystem.new(p) end },
		{ id = "objectTick", group = ecs.TickGroup.ModeResolution, default_priority = 10, create = function(p) return ecs_systems.ObjectTickSystem.new(p) end },
		{ id = "prePosition", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PrePositionSystem.new(p) end },
		{ id = "physicsSyncBefore", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PhysicsSyncBeforeStepSystem.new(p) end },
		{ id = "physicsStep", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PhysicsWorldStepSystem.new(p) end },
		{ id = "physicsPost", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PhysicsPostSystem.new(p) end },
		{ id = "tileCollision", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.TileCollisionSystem.new(p) end },
		{ id = "boundary", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.BoundarySystem.new(p) end },
		{ id = "physicsCollisionEvents", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PhysicsCollisionEventSystem.new(p) end },
		{ id = "physicsSyncAfterWorld", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.PhysicsSyncAfterWorldCollisionSystem.new(p) end },
		{ id = "overlapEvents", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.Overlap2DSystem.new(p) end },
		{ id = "transform", group = ecs.TickGroup.Physics, create = function(p) return ecs_systems.TransformSystem.new(p) end },
		{ id = "timeline", group = ecs.TickGroup.Animation, create = function(p) return ecs_systems.TimelineSystem.new(p) end },
		{ id = "meshAnim", group = ecs.TickGroup.Animation, create = function(p) return ecs_systems.MeshAnimationSystem.new(p) end },
		{ id = "textRender", group = ecs.TickGroup.Presentation, create = function(p) return ecs_systems.TextRenderSystem.new(p) end },
		{ id = "spriteRender", group = ecs.TickGroup.Presentation, create = function(p) return ecs_systems.SpriteRenderSystem.new(p) end },
		{ id = "meshRender", group = ecs.TickGroup.Presentation, create = function(p) return ecs_systems.MeshRenderSystem.new(p) end },
		{ id = "renderSubmit", group = ecs.TickGroup.Presentation, create = function(p) return ecs_systems.RenderSubmitSystem.new(p) end },
		{ id = "eventFlush", group = ecs.TickGroup.EventFlush, create = function(p) return ecs_systems.EventFlushSystem.new(p) end },
	})
	registered = true
end

local function default_pipeline_spec()
	return {
		{ ref = "behaviorTrees" },
		{ ref = "inputActionEffects" },
		{ ref = "actionEffectRuntime" },
		{ ref = "objectFSM" },
		{ ref = "objectTick" },
		{ ref = "prePosition" },
		{ ref = "physicsSyncBefore" },
		{ ref = "physicsStep" },
		{ ref = "physicsPost" },
		{ ref = "tileCollision" },
		{ ref = "boundary" },
		{ ref = "physicsCollisionEvents" },
		{ ref = "physicsSyncAfterWorld" },
		{ ref = "overlapEvents" },
		{ ref = "transform" },
		{ ref = "timeline" },
		{ ref = "meshAnim" },
		{ ref = "textRender" },
		{ ref = "spriteRender" },
		{ ref = "meshRender" },
		{ ref = "renderSubmit" },
		{ ref = "eventFlush" },
	}
end

return {
	register_builtin_ecs = register_builtin_ecs,
	default_pipeline_spec = default_pipeline_spec,
}
