-- ecs_systems.lua
-- built-in ecs systems for lua engine

local ecs = require("ecs")
local action_effects = require("action_effects")
local audio_router = require("audio_router")
local registry = require("registry")

local tickgroup = ecs.tickgroup
local ecsystem = ecs.ecsystem

local spritecomponent = "spritecomponent"
local timelinecomponent = "timelinecomponent"
local transformcomponent = "transformcomponent"
local textcomponent = "textcomponent"
local meshcomponent = "meshcomponent"
local customvisualcomponent = "customvisualcomponent"
local positionupdateaxiscomponent = "positionupdateaxiscomponent"
local screenboundarycomponent = "screenboundarycomponent"
local actioneffectcomponent = "actioneffectcomponent"

local function is_in_active_space(world, obj, active_space)
	return world:_object_space_id(obj) == active_space
end

local behaviortreesystem = {}
behaviortreesystem.__index = behaviortreesystem
setmetatable(behaviortreesystem, { __index = ecsystem })

function behaviortreesystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.input, priority or 0), behaviortreesystem)
	return self
end

local audioroutersystem = {}
audioroutersystem.__index = audioroutersystem
setmetatable(audioroutersystem, { __index = ecsystem })

function audioroutersystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.input, priority or 5), audioroutersystem)
	self.__ecs_id = "audioroutersystem"
	return self
end

function audioroutersystem:update(_world)
	audio_router.tick()
end

function behaviortreesystem:update(world)
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

local actioneffectruntimesystem = {}
actioneffectruntimesystem.__index = actioneffectruntimesystem
setmetatable(actioneffectruntimesystem, { __index = ecsystem })

function actioneffectruntimesystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.actioneffect, priority or 32), actioneffectruntimesystem)
	return self
end

function actioneffectruntimesystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(actioneffectcomponent, { scope = "active" }) do
		component:advance_time(dt)
	end
end

local statemachinesystem = {}
statemachinesystem.__index = statemachinesystem
setmetatable(statemachinesystem, { __index = ecsystem })

function statemachinesystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 0), statemachinesystem)
	return self
end

function statemachinesystem:update(world)
	for obj in world:objects({ scope = "active" }) do
		if obj.tick_enabled == false then
			goto continue
		end
		obj.sc:tick(world.deltatime or 0)
		::continue::
	end
	for _, entity in pairs(registry.instance:get_registered_entities()) do
		if entity.type_name == "service" and entity.active and entity.tick_enabled then
			entity.sc:tick(world.deltatime or 0)
		end
	end
end

local objectticksystem = {}
objectticksystem.__index = objectticksystem
setmetatable(objectticksystem, { __index = ecsystem })

function objectticksystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 10), objectticksystem)
	return self
end

function objectticksystem:update(world)
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

local prepositionsystem = {}
prepositionsystem.__index = prepositionsystem
setmetatable(prepositionsystem, { __index = ecsystem })

function prepositionsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), prepositionsystem)
	return self
end

function prepositionsystem:update(world)
	for _, component in world:objects_with_components(positionupdateaxiscomponent, { scope = "active" }) do
		if component.enabled then
			component:preprocess_update()
		end
	end
end

local boundarysystem = {}
boundarysystem.__index = boundarysystem
setmetatable(boundarysystem, { __index = ecsystem })

function boundarysystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), boundarysystem)
	return self
end

function boundarysystem:update(world)
	local width = world.gamewidth
	local height = world.gameheight
	for obj, component in world:objects_with_components(screenboundarycomponent, { scope = "active" }) do
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

local tilecollisionsystem = {}
tilecollisionsystem.__index = tilecollisionsystem
setmetatable(tilecollisionsystem, { __index = ecsystem })

function tilecollisionsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), tilecollisionsystem)
	return self
end

function tilecollisionsystem:update(_world)
end

local physicssyncbeforestepsystem = {}
physicssyncbeforestepsystem.__index = physicssyncbeforestepsystem
setmetatable(physicssyncbeforestepsystem, { __index = ecsystem })

function physicssyncbeforestepsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncbeforestepsystem)
	return self
end

function physicssyncbeforestepsystem:update(_world)
end

local physicsworldstepsystem = {}
physicsworldstepsystem.__index = physicsworldstepsystem
setmetatable(physicsworldstepsystem, { __index = ecsystem })

function physicsworldstepsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicsworldstepsystem)
	return self
end

function physicsworldstepsystem:update(_world)
end

local physicspostsystem = {}
physicspostsystem.__index = physicspostsystem
setmetatable(physicspostsystem, { __index = ecsystem })

function physicspostsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicspostsystem)
	return self
end

function physicspostsystem:update(_world)
end

local physicscollisioneventsystem = {}
physicscollisioneventsystem.__index = physicscollisioneventsystem
setmetatable(physicscollisioneventsystem, { __index = ecsystem })

function physicscollisioneventsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicscollisioneventsystem)
	return self
end

function physicscollisioneventsystem:update(_world)
end

local physicssyncafterworldcollisionsystem = {}
physicssyncafterworldcollisionsystem.__index = physicssyncafterworldcollisionsystem
setmetatable(physicssyncafterworldcollisionsystem, { __index = ecsystem })

function physicssyncafterworldcollisionsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncafterworldcollisionsystem)
	return self
end

function physicssyncafterworldcollisionsystem:update(_world)
end

local overlap2dsystem = {}
overlap2dsystem.__index = overlap2dsystem
setmetatable(overlap2dsystem, { __index = ecsystem })

function overlap2dsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), overlap2dsystem)
	return self
end

function overlap2dsystem:update(_world)
end

local transformsystem = {}
transformsystem.__index = transformsystem
setmetatable(transformsystem, { __index = ecsystem })

function transformsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), transformsystem)
	return self
end

function transformsystem:update(world)
	for _, component in world:objects_with_components(transformcomponent, { scope = "active" }) do
		if component.enabled then
			component:post_update()
		end
	end
end

local timelinesystem = {}
timelinesystem.__index = timelinesystem
setmetatable(timelinesystem, { __index = ecsystem })

function timelinesystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0), timelinesystem)
	return self
end

function timelinesystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(timelinecomponent, { scope = "active" }) do
		if component.enabled then
			component:tick_active(dt)
		end
	end
end

local meshanimationsystem = {}
meshanimationsystem.__index = meshanimationsystem
setmetatable(meshanimationsystem, { __index = ecsystem })

function meshanimationsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0), meshanimationsystem)
	return self
end

function meshanimationsystem:update(world)
	local dt = world.deltatime or 0
	for _, component in world:objects_with_components(meshcomponent, { scope = "active" }) do
		if component.enabled then
			component:update_animation(dt)
		end
	end
end

local textrendersystem = {}
textrendersystem.__index = textrendersystem
setmetatable(textrendersystem, { __index = ecsystem })

function textrendersystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 7), textrendersystem)
	return self
end

function textrendersystem:update(world)
	local active_space = world:get_space()
	for obj, tc in world:objects_with_components(textcomponent, { scope = "active" }) do
		if not tc.enabled or not is_in_active_space(world, obj, active_space) then
			goto continue
		end
		local offset = tc.offset
		local x = obj.x + offset.x
		local y = obj.y + offset.y
		local z = obj.z + offset.z
		local t = obj:get_component(transformcomponent)
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		end
		put_glyphs(tc.text, x, y, z, {
			font = tc.font,
			color = tc.color,
			background_color = tc.background_color,
			wrap_chars = tc.wrap_chars,
			center_block_width = tc.center_block_width,
			align = tc.align,
			baseline = tc.baseline,
			layer = tc.layer,
		})
		::continue::
	end
end

local spriterendersystem = {}
spriterendersystem.__index = spriterendersystem
setmetatable(spriterendersystem, { __index = ecsystem })

function spriterendersystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 8), spriterendersystem)
	return self
end

function spriterendersystem:update(world)
	local active_space = world:get_space()
	for obj, sc in world:objects_with_components(spritecomponent, { scope = "active" }) do
		if obj.visible == false or not sc.enabled or not is_in_active_space(world, obj, active_space) then
			goto continue
		end
		local offset = sc.offset
		local x = obj.x + offset.x
		local y = obj.y + offset.y
		local z = obj.z + offset.z
		local t = obj:get_component("transformcomponent")
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		end
		put_sprite(sc.imgid, x, y, z, {
			scale = sc.scale,
			flip_h = sc.flip.flip_h,
			flip_v = sc.flip.flip_v,
			colorize = sc.colorize,
			parallax_weight = sc.parallax_weight,
		})
		::continue::
	end
end

local meshrendersystem = {}
meshrendersystem.__index = meshrendersystem
setmetatable(meshrendersystem, { __index = ecsystem })

function meshrendersystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 9), meshrendersystem)
	return self
end

function meshrendersystem:update(world)
	local active_space = world:get_space()
	for obj, mc in world:objects_with_components(meshcomponent, { scope = "active" }) do
		if obj.visible == false or not mc.enabled or not is_in_active_space(world, obj, active_space) then
			goto continue
		end
		put_mesh(mc.mesh, mc.matrix, {
			joint_matrices = mc.joint_matrices,
			morph_weights = mc.morph_weights,
			receive_shadow = mc.receive_shadow,
		})
		::continue::
	end
end

local rendersubmitsystem = {}
rendersubmitsystem.__index = rendersubmitsystem
setmetatable(rendersubmitsystem, { __index = ecsystem })

function rendersubmitsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 10), rendersubmitsystem)
	return self
end

function rendersubmitsystem:update(world)
	local active_space = world:get_space()
	for obj, rc in world:objects_with_components(customvisualcomponent, { scope = "active" }) do
		if obj.visible == false or not rc.enabled or not is_in_active_space(world, obj, active_space) then
			goto continue
		end
		rc:flush()
		::continue::
	end
end

local eventflushsystem = {}
eventflushsystem.__index = eventflushsystem
setmetatable(eventflushsystem, { __index = ecsystem })

function eventflushsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.eventflush, priority or 0), eventflushsystem)
	return self
end

function eventflushsystem:update(_world)
end

return {
	behaviortreesystem = behaviortreesystem,
	audioroutersystem = audioroutersystem,
	actioneffectruntimesystem = actioneffectruntimesystem,
	statemachinesystem = statemachinesystem,
	objectticksystem = objectticksystem,
	prepositionsystem = prepositionsystem,
	boundarysystem = boundarysystem,
	tilecollisionsystem = tilecollisionsystem,
	physicssyncbeforestepsystem = physicssyncbeforestepsystem,
	physicsworldstepsystem = physicsworldstepsystem,
	physicspostsystem = physicspostsystem,
	physicscollisioneventsystem = physicscollisioneventsystem,
	physicssyncafterworldcollisionsystem = physicssyncafterworldcollisionsystem,
	overlap2dsystem = overlap2dsystem,
	transformsystem = transformsystem,
	timelinesystem = timelinesystem,
	meshanimationsystem = meshanimationsystem,
	textrendersystem = textrendersystem,
	spriterendersystem = spriterendersystem,
	meshrendersystem = meshrendersystem,
	rendersubmitsystem = rendersubmitsystem,
	eventflushsystem = eventflushsystem,
}
