-- ecs_systems.lua
-- Built-in ECS systems for Lua engine

local ecs = require("ecs")
local action_effects = require("action_effects")
local registry = require("registry")

local TickGroup = ecs.TickGroup
local ECSystem = ecs.ECSystem

local SpriteComponent = "SpriteComponent"
local TimelineComponent = "TimelineComponent"
local TransformComponent = "TransformComponent"
local TextComponent = "TextComponent"
local MeshComponent = "MeshComponent"
local CustomVisualComponent = "CustomVisualComponent"
local PositionUpdateAxisComponent = "PositionUpdateAxisComponent"
local ScreenBoundaryComponent = "ScreenBoundaryComponent"
local ActionEffectComponent = "ActionEffectComponent"

local BehaviorTreeSystem = {}
BehaviorTreeSystem.__index = BehaviorTreeSystem
setmetatable(BehaviorTreeSystem, { __index = ECSystem })

function BehaviorTreeSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Input, priority or 0), BehaviorTreeSystem)
	return self
end

function BehaviorTreeSystem:update(world)
	for obj in world:objects({ scope = "active" }) do
		if obj.tick_enabled == false then
			goto continue
		end
		local bts = obj.btreecontexts
		for id in pairs(bts) do
			obj:tick_tree(id)
		end
		::continue::
	end
end

local ActionEffectRuntimeSystem = {}
ActionEffectRuntimeSystem.__index = ActionEffectRuntimeSystem
setmetatable(ActionEffectRuntimeSystem, { __index = ECSystem })

function ActionEffectRuntimeSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.ActionEffect, priority or 32), ActionEffectRuntimeSystem)
	return self
end

function ActionEffectRuntimeSystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(ActionEffectComponent, { scope = "active" }) do
		component:advance_time(dt)
	end
end

local StateMachineSystem = {}
StateMachineSystem.__index = StateMachineSystem
setmetatable(StateMachineSystem, { __index = ECSystem })

function StateMachineSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.ModeResolution, priority or 0), StateMachineSystem)
	return self
end

function StateMachineSystem:update(world)
	for obj in world:objects({ scope = "active" }) do
		if obj.tick_enabled == false then
			goto continue
		end
		obj.sc:tick(world.deltatime or 0)
		::continue::
	end
	for _, entity in pairs(registry.instance:get_registered_entities()) do
		if entity.type_name == "Service" and entity.active and entity.tick_enabled then
			entity.sc:tick(world.deltatime or 0)
		end
	end
end

local ObjectTickSystem = {}
ObjectTickSystem.__index = ObjectTickSystem
setmetatable(ObjectTickSystem, { __index = ECSystem })

function ObjectTickSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.ModeResolution, priority or 10), ObjectTickSystem)
	return self
end

function ObjectTickSystem:update(world)
	local dt = world.deltatime or 0
	for obj in world:objects({ scope = "active" }) do
		if obj.tick_enabled then
			obj:tick(dt)
		end
		for i = 1, #obj.components do
			local comp = obj.components[i]
			if comp.enabled then
				comp:tick(dt)
			end
		end
	end
end

local PrePositionSystem = {}
PrePositionSystem.__index = PrePositionSystem
setmetatable(PrePositionSystem, { __index = ECSystem })

function PrePositionSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PrePositionSystem)
	return self
end

function PrePositionSystem:update(world)
	for _, component in world:objects_with_components(PositionUpdateAxisComponent, { scope = "active" }) do
		if component.enabled then
			component:preprocess_update()
		end
	end
end

local BoundarySystem = {}
BoundarySystem.__index = BoundarySystem
setmetatable(BoundarySystem, { __index = ECSystem })

function BoundarySystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), BoundarySystem)
	return self
end

function BoundarySystem:update(world)
	local width = world.gamewidth
	local height = world.gameheight
	for obj, component in world:objects_with_components(ScreenBoundaryComponent, { scope = "active" }) do
		if not component.enabled then
			goto continue
		end
		local oldx = component.old_pos.x
		local oldy = component.old_pos.y
		local newx = obj.x
		local newy = obj.y
		local sx = obj.sx or 0
		local sy = obj.sy or 0
		if newx < oldx then
			if newx + sx < 0 then
				obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx })
			elseif newx < 0 then
				obj.events:emit("screen.leaving", { d = "left", old_x_or_y = oldx })
			end
		elseif newx > oldx then
			if newx >= width then
				obj.events:emit("screen.leave", { d = "right", old_x_or_y = oldx })
			elseif newx + sx > width then
				obj.events:emit("screen.leaving", { d = "right", old_x_or_y = oldx })
			end
		end
		if newy < oldy then
			if newy + sy < 0 then
				obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy })
			elseif newy < 0 then
				obj.events:emit("screen.leaving", { d = "up", old_x_or_y = oldy })
			end
		elseif newy > oldy then
			if newy >= height then
				obj.events:emit("screen.leave", { d = "down", old_x_or_y = oldy })
			elseif newy + sy > height then
				obj.events:emit("screen.leaving", { d = "down", old_x_or_y = oldy })
			end
		end
		::continue::
	end
end

local TileCollisionSystem = {}
TileCollisionSystem.__index = TileCollisionSystem
setmetatable(TileCollisionSystem, { __index = ECSystem })

function TileCollisionSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), TileCollisionSystem)
	return self
end

function TileCollisionSystem:update(_world)
end

local PhysicsSyncBeforeStepSystem = {}
PhysicsSyncBeforeStepSystem.__index = PhysicsSyncBeforeStepSystem
setmetatable(PhysicsSyncBeforeStepSystem, { __index = ECSystem })

function PhysicsSyncBeforeStepSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PhysicsSyncBeforeStepSystem)
	return self
end

function PhysicsSyncBeforeStepSystem:update(_world)
end

local PhysicsWorldStepSystem = {}
PhysicsWorldStepSystem.__index = PhysicsWorldStepSystem
setmetatable(PhysicsWorldStepSystem, { __index = ECSystem })

function PhysicsWorldStepSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PhysicsWorldStepSystem)
	return self
end

function PhysicsWorldStepSystem:update(_world)
end

local PhysicsPostSystem = {}
PhysicsPostSystem.__index = PhysicsPostSystem
setmetatable(PhysicsPostSystem, { __index = ECSystem })

function PhysicsPostSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PhysicsPostSystem)
	return self
end

function PhysicsPostSystem:update(_world)
end

local PhysicsCollisionEventSystem = {}
PhysicsCollisionEventSystem.__index = PhysicsCollisionEventSystem
setmetatable(PhysicsCollisionEventSystem, { __index = ECSystem })

function PhysicsCollisionEventSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PhysicsCollisionEventSystem)
	return self
end

function PhysicsCollisionEventSystem:update(_world)
end

local PhysicsSyncAfterWorldCollisionSystem = {}
PhysicsSyncAfterWorldCollisionSystem.__index = PhysicsSyncAfterWorldCollisionSystem
setmetatable(PhysicsSyncAfterWorldCollisionSystem, { __index = ECSystem })

function PhysicsSyncAfterWorldCollisionSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), PhysicsSyncAfterWorldCollisionSystem)
	return self
end

function PhysicsSyncAfterWorldCollisionSystem:update(_world)
end

local Overlap2DSystem = {}
Overlap2DSystem.__index = Overlap2DSystem
setmetatable(Overlap2DSystem, { __index = ECSystem })

function Overlap2DSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), Overlap2DSystem)
	return self
end

function Overlap2DSystem:update(_world)
end

local TransformSystem = {}
TransformSystem.__index = TransformSystem
setmetatable(TransformSystem, { __index = ECSystem })

function TransformSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Physics, priority or 0), TransformSystem)
	return self
end

function TransformSystem:update(world)
	for _, component in world:objects_with_components(TransformComponent, { scope = "active" }) do
		if component.enabled then
			component:post_update()
		end
	end
end

local TimelineSystem = {}
TimelineSystem.__index = TimelineSystem
setmetatable(TimelineSystem, { __index = ECSystem })

function TimelineSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Animation, priority or 0), TimelineSystem)
	return self
end

function TimelineSystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(TimelineComponent, { scope = "active" }) do
		if component.enabled then
			component:tick_active(dt)
		end
	end
end

local MeshAnimationSystem = {}
MeshAnimationSystem.__index = MeshAnimationSystem
setmetatable(MeshAnimationSystem, { __index = ECSystem })

function MeshAnimationSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Animation, priority or 0), MeshAnimationSystem)
	return self
end

function MeshAnimationSystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(MeshComponent, { scope = "active" }) do
		if component.enabled then
			component:update_animation(dt)
		end
	end
end

local TextRenderSystem = {}
TextRenderSystem.__index = TextRenderSystem
setmetatable(TextRenderSystem, { __index = ECSystem })

function TextRenderSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Presentation, priority or 7), TextRenderSystem)
	return self
end

function TextRenderSystem:update(world)
	for obj, tc in world:objects_with_components(TextComponent, { scope = "active" }) do
		if not tc.enabled then
			goto continue
		end
		local offset = tc.offset
		local x = obj.x + offset.x
		local y = obj.y + offset.y
		local z = obj.z + offset.z
		local t = obj:get_component(TransformComponent)
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		end
		if tc.font and type(tc.color) == "number" then
			write_with_font(tc.text, x, y, z, tc.color, tc.font)
		elseif type(tc.color) == "table" then
			write_color(tc.text, x, y, z, tc.color)
		else
			write(tc.text, x, y, z, tc.color)
		end
		::continue::
	end
end

local SpriteRenderSystem = {}
SpriteRenderSystem.__index = SpriteRenderSystem
setmetatable(SpriteRenderSystem, { __index = ECSystem })

function SpriteRenderSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Presentation, priority or 8), SpriteRenderSystem)
	return self
end

function SpriteRenderSystem:update(world)
	for obj, sc in world:objects_with_components(SpriteComponent, { scope = "active" }) do
		if obj.visible == false or not sc.enabled then
			goto continue
		end
		local offset = sc.offset
		local x = obj.x + offset.x
		local y = obj.y + offset.y
		local z = obj.z + offset.z
		local t = obj:get_component("TransformComponent")
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		end
		sprite(sc.imgid, x, y, z, {
			scale = sc.scale,
			flip_h = sc.flip.flip_h,
			flip_v = sc.flip.flip_v,
			colorize = sc.colorize,
		})
		::continue::
	end
end

local MeshRenderSystem = {}
MeshRenderSystem.__index = MeshRenderSystem
setmetatable(MeshRenderSystem, { __index = ECSystem })

function MeshRenderSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Presentation, priority or 9), MeshRenderSystem)
	return self
end

function MeshRenderSystem:update(world)
	for obj, mc in world:objects_with_components(MeshComponent, { scope = "active" }) do
		if obj.visible == false or not mc.enabled then
			goto continue
		end
		mesh(mc.mesh, mc.matrix, {
			joint_matrices = mc.joint_matrices,
			morph_weights = mc.morph_weights,
			receive_shadow = mc.receive_shadow,
		})
		::continue::
	end
end

local RenderSubmitSystem = {}
RenderSubmitSystem.__index = RenderSubmitSystem
setmetatable(RenderSubmitSystem, { __index = ECSystem })

function RenderSubmitSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.Presentation, priority or 10), RenderSubmitSystem)
	return self
end

function RenderSubmitSystem:update(world)
	for obj, rc in world:objects_with_components(CustomVisualComponent, { scope = "active" }) do
		if obj.visible == false or not rc.enabled then
			goto continue
		end
		rc:flush()
		::continue::
	end
end

local EventFlushSystem = {}
EventFlushSystem.__index = EventFlushSystem
setmetatable(EventFlushSystem, { __index = ECSystem })

function EventFlushSystem.new(priority)
	local self = setmetatable(ECSystem.new(TickGroup.EventFlush, priority or 0), EventFlushSystem)
	return self
end

function EventFlushSystem:update(_world)
end

return {
	BehaviorTreeSystem = BehaviorTreeSystem,
	ActionEffectRuntimeSystem = ActionEffectRuntimeSystem,
	StateMachineSystem = StateMachineSystem,
	ObjectTickSystem = ObjectTickSystem,
	PrePositionSystem = PrePositionSystem,
	BoundarySystem = BoundarySystem,
	TileCollisionSystem = TileCollisionSystem,
	PhysicsSyncBeforeStepSystem = PhysicsSyncBeforeStepSystem,
	PhysicsWorldStepSystem = PhysicsWorldStepSystem,
	PhysicsPostSystem = PhysicsPostSystem,
	PhysicsCollisionEventSystem = PhysicsCollisionEventSystem,
	PhysicsSyncAfterWorldCollisionSystem = PhysicsSyncAfterWorldCollisionSystem,
	Overlap2DSystem = Overlap2DSystem,
	TransformSystem = TransformSystem,
	TimelineSystem = TimelineSystem,
	MeshAnimationSystem = MeshAnimationSystem,
	TextRenderSystem = TextRenderSystem,
	SpriteRenderSystem = SpriteRenderSystem,
	MeshRenderSystem = MeshRenderSystem,
	RenderSubmitSystem = RenderSubmitSystem,
	EventFlushSystem = EventFlushSystem,
}
