-- ecs_systems.lua
-- built-in ecs systems for lua engine

local ecs = require("ecs")
local action_effects = require("action_effects")
local audio_router = require("audio_router")
local registry = require("registry")
local collision2d = require("collision2d")
local world_instance = require("world").instance

local tickgroup = ecs.tickgroup
local ecsystem = ecs.ecsystem

local spritecomponent = "spritecomponent"
local timelinecomponent = "timelinecomponent"
local transformcomponent = "transformcomponent"
local textcomponent = "textcomponent"
local meshcomponent = "meshcomponent"
local customvisualcomponent = "customvisualcomponent"
local collider2dcomponent = "collider2dcomponent"
local positionupdateaxiscomponent = "positionupdateaxiscomponent"
local screenboundarycomponent = "screenboundarycomponent"
local actioneffectcomponent = "actioneffectcomponent"

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

function audioroutersystem:update()
	audio_router.tick()
end

function behaviortreesystem:update()
	for obj in world_instance:objects({ scope = "active" }) do
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

function actioneffectruntimesystem:update(dt_ms)
	for _, component in world_instance:objects_with_components(actioneffectcomponent, { scope = "active" }) do
		component:tick(dt_ms)
	end
end

local statemachinesystem = {}
statemachinesystem.__index = statemachinesystem
setmetatable(statemachinesystem, { __index = ecsystem })

function statemachinesystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 0), statemachinesystem)
	return self
end

function statemachinesystem:update(dt_ms)
	for obj in world_instance:objects({ scope = "active" }) do
		if obj.tick_enabled == false then
			goto continue
		end
		obj.sc:tick(dt_ms)
		::continue::
	end
	for _, entity in pairs(registry.instance:get_registered_entities()) do
		if entity.type_name == "service" and not entity.dispose_flag and entity.active and entity.tick_enabled then
			entity.sc:tick(dt_ms)
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

function objectticksystem:update(dt_ms)
	for obj in world_instance:objects({ scope = "active" }) do
		if obj.tick_enabled then
			obj:tick(dt_ms)
		end
		for i = 1, #obj.components do
			local comp = obj.components[i]
			if comp.enabled then
				comp:tick(dt_ms)
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

function prepositionsystem:update()
	for _, component in world_instance:objects_with_components(positionupdateaxiscomponent, { scope = "active" }) do
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

function boundarysystem:update()
	local width = world_instance.gamewidth
	local height = world_instance.gameheight
	for obj, component in world_instance:objects_with_components(screenboundarycomponent, { scope = "active" }) do
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

function tilecollisionsystem:update()
end

local physicssyncbeforestepsystem = {}
physicssyncbeforestepsystem.__index = physicssyncbeforestepsystem
setmetatable(physicssyncbeforestepsystem, { __index = ecsystem })

function physicssyncbeforestepsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncbeforestepsystem)
	return self
end

function physicssyncbeforestepsystem:update()
end

local physicsworldstepsystem = {}
physicsworldstepsystem.__index = physicsworldstepsystem
setmetatable(physicsworldstepsystem, { __index = ecsystem })

function physicsworldstepsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicsworldstepsystem)
	return self
end

function physicsworldstepsystem:update()
end

local physicspostsystem = {}
physicspostsystem.__index = physicspostsystem
setmetatable(physicspostsystem, { __index = ecsystem })

function physicspostsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicspostsystem)
	return self
end

function physicspostsystem:update()
end

local physicscollisioneventsystem = {}
physicscollisioneventsystem.__index = physicscollisioneventsystem
setmetatable(physicscollisioneventsystem, { __index = ecsystem })

function physicscollisioneventsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicscollisioneventsystem)
	return self
end

function physicscollisioneventsystem:update()
end

local physicssyncafterworldcollisionsystem = {}
physicssyncafterworldcollisionsystem.__index = physicssyncafterworldcollisionsystem
setmetatable(physicssyncafterworldcollisionsystem, { __index = ecsystem })

function physicssyncafterworldcollisionsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncafterworldcollisionsystem)
	return self
end

function physicssyncafterworldcollisionsystem:update()
end

local overlap2dsystem = {}
overlap2dsystem.__index = overlap2dsystem
setmetatable(overlap2dsystem, { __index = ecsystem })

local function make_pair_key(a, b)
	if a < b then
		return a .. "|" .. b
	end
	return b .. "|" .. a
end

local function build_overlap_payload(self_col, other_col, other_owner, contact, phase)
	return {
		other_id = other_owner.id,
		other_collider_id = other_col.id,
		collider_id = self_col.id,
		contact = contact,
		phase = phase,
	}
end

local function clone_contact_with_flipped_normal(contact)
	if contact == nil then
		return nil
	end
	local flipped = {}
	for k, v in pairs(contact) do
		flipped[k] = v
	end
	if contact.normal ~= nil then
		flipped.normal = {
			x = -contact.normal.x,
			y = -contact.normal.y,
		}
	end
	return flipped
end

function overlap2dsystem:space_match(scope, owner_space, other_space)
	if scope == "all" then
		return true
	end
	local ui_id = world_instance.ui_space_id or "ui"
	local current = world_instance.active_space_id
	if scope == "current" or scope == nil then
		return other_space == owner_space and other_space == current
	end
	if scope == "ui" then
		return other_space == ui_id
	end
	if scope == "both" then
		return (other_space == owner_space and other_space == current) or other_space == ui_id
	end
	error("[overlap2dsystem] unknown spaceevents scope '" .. tostring(scope) .. "'")
end

function overlap2dsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 42), overlap2dsystem)
	self.prev_pairs = {}
	self.grid_cell_size = 64
	return self
end

function overlap2dsystem:update()
	local new_pairs = {}
	local collider_lookup = {}

	local broadphase = collision2d.ensure_index(self.grid_cell_size)
	broadphase:clear()

	local event_colliders = {}
	for obj in world_instance:objects({ scope = "active" }) do
		local colliders = obj:get_components(collider2dcomponent)
		for i = 1, #colliders do
			local collider = colliders[i]
			if collider.enabled and not obj.dispose_flag then
				broadphase:add_or_update(collider)
				collider_lookup[collider.id] = collider
				if collider.generateoverlapevents then
					event_colliders[#event_colliders + 1] = collider
				end
			end
		end
	end

	if #event_colliders == 0 then
		self.prev_pairs = {}
		return
	end

	for i = 1, #event_colliders do
		local collider = event_colliders[i]
		local owner = collider.parent
		-- if owner == nil then
		-- 	error("[overlap2dsystem] collider '" .. tostring(collider.id) .. "' has no parent")
		-- end
		if owner.dispose_flag or not owner.active then
			goto continue_event_collider
		end
		local owner_space = world_instance:_object_space_id(owner)
		local candidates = broadphase:query_aabb(collider:get_world_area())
		for j = 1, #candidates do
			local other = candidates[j]
			if other ~= collider then
				local other_owner = other.parent
				-- if other_owner == nil then
				-- 	error("[overlap2dsystem] collider '" .. tostring(other.id) .. "' has no parent")
				-- end
				if other_owner.dispose_flag or not other_owner.active then
					goto continue_candidate
				end
				collider_lookup[other.id] = other
				local a_hits_b = (collider.mask & other.layer) ~= 0
				local b_hits_a = (other.mask & collider.layer) ~= 0
				if a_hits_b and b_hits_a then
					local other_space = world_instance:_object_space_id(other_owner)
					if self:space_match(collider.spaceevents, owner_space, other_space) then
						if not (other.generateoverlapevents and other.id < collider.id) then
							if collision2d.collides(collider, other) then
								local key = make_pair_key(collider.id, other.id)
								new_pairs[key] = true
							end
						end
					end
				end
			end
			::continue_candidate::
		end
		::continue_event_collider::
	end

	local begins = {}
	local stays = {}
	local ends = {}
	for key in pairs(new_pairs) do
		if self.prev_pairs[key] then
			stays[#stays + 1] = key
		else
			begins[#begins + 1] = key
		end
	end
	for key in pairs(self.prev_pairs) do
		if not new_pairs[key] then
			ends[#ends + 1] = key
		end
	end

	local function resolve_pair(key)
		local sep = string.find(key, "|", 1, true)
		local a_id = string.sub(key, 1, sep - 1)
		local b_id = string.sub(key, sep + 1)
		local a = collider_lookup[a_id] or registry.instance:get(a_id)
		local b = collider_lookup[b_id] or registry.instance:get(b_id)
		return a, b
	end

	local function emit_pair(event_name, col_a, col_b, contact, phase)
		local owner_a = col_a.parent
		local owner_b = col_b.parent
		if owner_a == nil or owner_b == nil then
			error("[overlap2dsystem] attempted to emit overlap event without collider parents")
		end
		if owner_a.dispose_flag or owner_b.dispose_flag then
			return
		end
		if not owner_a.active or not owner_b.active then
			return
		end
		local emit_a = col_a.generateoverlapevents
		local emit_b = col_b.generateoverlapevents
		if not emit_a and not emit_b then
			return
		end
		local resolved_contact = contact
		if resolved_contact == nil and event_name ~= "overlap.end" then
			resolved_contact = collision2d.get_contact2d(col_a, col_b)
		end
		if emit_a then
			owner_a.events:emit(event_name, build_overlap_payload(col_a, col_b, owner_b, resolved_contact, phase))
		end
		if emit_b then
			owner_b.events:emit(event_name, build_overlap_payload(col_b, col_a, owner_a, clone_contact_with_flipped_normal(resolved_contact), phase))
		end
	end

	for i = 1, #begins do
		local a, b = resolve_pair(begins[i])
		if a ~= nil and b ~= nil then
			local contact = collision2d.get_contact2d(a, b)
			emit_pair("overlap.begin", a, b, contact, "begin")
			emit_pair("overlap", a, b, contact, "begin")
		end
	end
	for i = 1, #stays do
		local a, b = resolve_pair(stays[i])
		if a ~= nil and b ~= nil then
			local contact = collision2d.get_contact2d(a, b)
			emit_pair("overlap.stay", a, b, contact, "stay")
			emit_pair("overlap", a, b, contact, "stay")
		end
	end
	for i = 1, #ends do
		local a, b = resolve_pair(ends[i])
		if a ~= nil and b ~= nil then
			emit_pair("overlap.end", a, b, nil, "end")
		end
	end

	self.prev_pairs = new_pairs
end

local transformsystem = {}
transformsystem.__index = transformsystem
setmetatable(transformsystem, { __index = ecsystem })

function transformsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), transformsystem)
	return self
end

function transformsystem:update()
	for _, component in world_instance:objects_with_components(transformcomponent, { scope = "active" }) do
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

function timelinesystem:update(dt_ms)
	for _, component in world_instance:objects_with_components(timelinecomponent, { scope = "active" }) do
		if component.enabled then
			component:tick_active(dt_ms)
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

function meshanimationsystem:update(dt_ms)
	for _, component in world_instance:objects_with_components(meshcomponent, { scope = "active" }) do
		if component.enabled then
			component:update_animation(dt_ms)
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

function textrendersystem:update()
	local active_space = world_instance:get_space()
	for obj, tc in world_instance:objects_with_components(textcomponent, { scope = "active" }) do
		if not tc.enabled or world_instance:_object_space_id(obj) ~= active_space then
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

function spriterendersystem:update()
	local active_space = world_instance:get_space()
	for obj, sc in world_instance:objects_with_components(spritecomponent, { scope = "active" }) do
		if obj.visible == false or not sc.enabled or world_instance:_object_space_id(obj) ~= active_space then
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

function meshrendersystem:update()
	local active_space = world_instance:get_space()
	for obj, mc in world_instance:objects_with_components(meshcomponent, { scope = "active" }) do
		if obj.visible == false or not mc.enabled or world_instance:_object_space_id(obj) ~= active_space then
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

function rendersubmitsystem:update()
	local active_space = world_instance:get_space()
	for obj, rc in world_instance:objects_with_components(customvisualcomponent, { scope = "active" }) do
		if obj.visible == false or not rc.enabled or world_instance:_object_space_id(obj) ~= active_space then
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

function eventflushsystem:update()
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
