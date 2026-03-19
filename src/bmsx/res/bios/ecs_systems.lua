-- ecs_systems.lua
-- built-in ecs systems for lua engine
--
-- DESIGN PRINCIPLES — collision handling via overlap2dsystem
--
-- 1. NEVER WRITE CUSTOM COLLISION LOOPS IN CART CODE.
--    overlap2dsystem runs automatically every frame (tickgroup.physics, priority 42).
--    It detects all overlapping collider pairs in the active world space and emits
--    three events on BOTH owner objects' event ports:
--
--      overlap.begin  — first frame two colliders touch (phase = 'begin')
--      overlap.stay   — every subsequent frame they remain touching (phase = 'stay')
--      overlap.end    — first frame they separate (phase = 'end', contact = nil)
--
--    Subscribe in bind(), not in update():
--
--      WRONG — manual loop every frame:
--        function hero:update(dt)
--          for _, enemy in ipairs(world_instance:objects({tag='enemy'})) do
--            if collision2d.collides(self.collider, enemy.collider) then ...
--
--      RIGHT — reactive subscription:
--        function hero:bind()
--          self:on('overlap.begin', function(e)
--            if e.other_layer == LAYER_ENEMY then
--              self:take_damage()
--            end
--          end)
--        end
--
-- 2. OVERLAP EVENT PAYLOAD FIELDS
--    Every overlap event carries a table with the following fields:
--
--      e.other_id              — world ID of the other object
--      e.other_collider_id     — component handle of the other collider
--      e.other_collider_local_id — local slot index of the other collider
--      e.other_layer           — layer bitmask of the other collider
--      e.other_mask            — mask bitmask of the other collider
--      e.collider_id           — component handle of this object's collider
--      e.collider_local_id     — local slot index of this object's collider
--      e.collider_layer        — layer bitmask of this object's collider
--      e.collider_mask         — mask bitmask of this object's collider
--      e.contact               — { normal={x,y}, depth, point={x,y} } or nil (overlap.end)
--      e.phase                 — 'begin' | 'stay' | 'end'
--
-- 3. LAYER / MASK FILTERING
--    A pair is only tested when (a.layer & b.mask) != 0 OR (b.layer & a.mask) != 0.
--    Both colliders must also have hittable=true.
--    Use collision_profiles to assign named layer+mask presets rather than
--    setting layer/mask directly.

local ecs = require('ecs')
local collision2d = require('collision2d')
local world_instance = require('world').instance

local tickgroup = ecs.tickgroup
local ecsystem = ecs.ecsystem

local spritecomponent = 'spritecomponent'
local timelinecomponent = 'timelinecomponent'
local transformcomponent = 'transformcomponent'
local textcomponent = 'textcomponent'
local meshcomponent = 'meshcomponent'
local ambientlightcomponent = 'ambientlightcomponent'
local directionallightcomponent = 'directionallightcomponent'
local pointlightcomponent = 'pointlightcomponent'
local customvisualcomponent = 'customvisualcomponent'
local collider2dcomponent = 'collider2dcomponent'
local positionupdateaxiscomponent = 'positionupdateaxiscomponent'
local screenboundarycomponent = 'screenboundarycomponent'
local actioneffectcomponent = 'actioneffectcomponent'

-- Shared opts table to avoid per-frame allocation.
local active_scope = { scope = 'active' }

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
	self.__ecs_id = 'audioroutersystem'
	return self
end

function audioroutersystem:update()
end

function behaviortreesystem:update()
	for obj in world_instance:objects(active_scope) do
		if not (obj.active) then
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
	for _, component in world_instance:objects_with_components(actioneffectcomponent, active_scope) do
		component:update(dt_ms)
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
	for obj in world_instance:objects(active_scope) do
		if not (obj.active) then
			goto continue
		end
		obj.sc:update(dt_ms)
		::continue::
	end
end

local objectticksystem = {}
objectticksystem.__index = objectticksystem
setmetatable(objectticksystem, { __index = ecsystem })

local object_tick_orders = { 'early', 'normal', 'late' }
local object_tick_order_lookup = { early = true, normal = true, late = true }

local function resolve_object_tick_order(obj)
	local order = obj.tick_order
	if order == nil then
		return 'normal'
	end
	if object_tick_order_lookup[order] then
		return order
	end
	error('[objectticksystem] unknown tick_order '' .. tostring(order) .. '' on '' .. tostring(obj.id) .. ''.')
end

function objectticksystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 10), objectticksystem)
	return self
end

function objectticksystem:update(dt_ms)
	for order_index = 1, #object_tick_orders do
		local tick_order = object_tick_orders[order_index]
		for obj in world_instance:objects(active_scope) do
			if resolve_object_tick_order(obj) == tick_order then
				for i = 1, #obj.components do
					local comp = obj.components[i]
					if comp.enabled then
						comp:update(dt_ms)
					end
				end
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
	for _, component in world_instance:objects_with_components(positionupdateaxiscomponent, active_scope) do
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
	for obj, component in world_instance:objects_with_components(screenboundarycomponent, active_scope) do
		if not component.enabled then
			goto continue
		end
		local left = component.boundary_left
		local top = component.boundary_top
		local right = component.boundary_right
		local bottom = component.boundary_bottom
		local oldx = component.old_pos.x
		local oldy = component.old_pos.y
		local newx = obj.x
		local newy = obj.y
		local sx = obj.sx or 0
		local sy = obj.sy or 0
		if newx < oldx then
			if newx + sx < left then
				obj.events:emit('screen.leave', { d = 'left', old_x_or_y = oldx })
			elseif newx < left then
				obj.events:emit('screen.leaving', { d = 'left', old_x_or_y = oldx })
			end
		elseif newx > oldx then
			if newx >= right then
				obj.events:emit('screen.leave', { d = 'right', old_x_or_y = oldx })
			elseif newx + sx > right then
				obj.events:emit('screen.leaving', { d = 'right', old_x_or_y = oldx })
			end
		end
		if newy < oldy then
			if newy + sy < top then
				obj.events:emit('screen.leave', { d = 'up', old_x_or_y = oldy })
			elseif newy < top then
				obj.events:emit('screen.leaving', { d = 'up', old_x_or_y = oldy })
			end
		elseif newy > oldy then
			if newy >= bottom then
				obj.events:emit('screen.leave', { d = 'down', old_x_or_y = oldy })
			elseif newy + sy > bottom then
				obj.events:emit('screen.leaving', { d = 'down', old_x_or_y = oldy })
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

local function add_pair(set, a, b)
	if b < a then
		a, b = b, a
	end
	local row = set[a]
	if row == nil then
		row = {}
		set[a] = row
	end
	row[b] = true
end

local function build_overlap_event(event_name, owner, self_col, other_col, other_owner, contact, phase)
	return {
		type = event_name,
		emitter = owner,
		other_id = other_owner.id,
		other_collider_id = other_col.id,
		other_collider_local_id = other_col.id_local,
		other_layer = other_col.layer,
		other_mask = other_col.mask,
		collider_id = self_col.id,
		collider_local_id = self_col.id_local,
		collider_layer = self_col.layer,
		collider_mask = self_col.mask,
		contact = contact,
		phase = phase,
	}
end

local function contact_with_flipped_normal(contact)
	if contact == nil then
		return nil
	end
	local normal = contact.normal
	if normal == nil then
		return {
			depth = contact.depth,
			point = contact.point,
		}
	end
	return {
		depth = contact.depth,
		point = contact.point,
		normal = {
			x = -normal.x,
			y = -normal.y,
		},
	}
end

function overlap2dsystem:space_match(scope, owner_space, other_space)
	if scope == 'all' then
		return true
	end
	local current = world_instance.active_space_id
	if scope == 'current' or scope == nil then
		return other_space == owner_space and other_space == current
	end
	if scope == 'ui' then
		return other_space == 'ui'
	end
	if scope == 'both' then
		return (other_space == owner_space and other_space == current) or other_space == 'ui'
	end
	error('[overlap2dsystem] unknown spaceevents scope '' .. tostring(scope) .. ''')
end

-- overlap2dsystem.new(priority?)
--   Creates the system. Priority defaults to 42 inside tickgroup.physics.
--   Instantiated once by the engine; cart code should not create a second instance.
--   The system iterates every active object's collider2dcomponents, builds a
--   broadphase grid, tests exact shapes with collision2d, and fires the three
--   overlap events described in the file header.
function overlap2dsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 42), overlap2dsystem)
	self.prev_pairs = {}
	self.prev_collider_lookup = {}
	self.grid_cell_size = 64
	return self
end

function overlap2dsystem:update()
	local new_pairs = {}
	local collider_lookup = {}

	local broadphase = collision2d.ensure_index(self.grid_cell_size)
	broadphase:clear()

	local event_colliders = {}
	for obj, collider in world_instance:objects_with_components(collider2dcomponent, active_scope) do
		if collider.enabled and not obj.dispose_flag then
			broadphase:add_or_update(collider)
			collider_lookup[collider.id] = collider
			event_colliders[#event_colliders + 1] = collider
		end
	end

	if #event_colliders == 0 then
		self.prev_pairs = {}
		self.prev_collider_lookup = {}
		return
	end

	for i = 1, #event_colliders do
		local collider = event_colliders[i]
		local owner = collider.parent
		-- if owner == nil then
		-- 	error('[overlap2dsystem] collider '' .. tostring(collider.id) .. '' has no parent')
		-- end
		if owner.dispose_flag or not owner.active then
			goto continue_event_collider
		end
		local owner_space = owner.space_id
		local candidates = broadphase:query_aabb(collider:get_world_area())
		for j = 1, #candidates do
			local other = candidates[j]
			if other ~= collider then
				local other_owner = other.parent
				-- if other_owner == nil then
				-- 	error('[overlap2dsystem] collider '' .. tostring(other.id) .. '' has no parent')
				-- end
				if other_owner.dispose_flag or not other_owner.active then
					goto continue_candidate
				end
				collider_lookup[other.id] = other
				local a_hits_b = (collider.mask & other.layer) ~= 0
				local b_hits_a = (other.mask & collider.layer) ~= 0
				if a_hits_b and b_hits_a then
					local other_space = other_owner.space_id
					if self:space_match(collider.spaceevents, owner_space, other_space) then
						if not (other.id < collider.id) then
							if collision2d.collides(collider, other) then
								add_pair(new_pairs, collider.id, other.id)
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
	for a_id, row in pairs(new_pairs) do
		local prev_row = self.prev_pairs[a_id]
		for b_id in pairs(row) do
			if prev_row ~= nil and prev_row[b_id] then
				stays[#stays + 1] = a_id
				stays[#stays + 1] = b_id
			else
				begins[#begins + 1] = a_id
				begins[#begins + 1] = b_id
			end
		end
	end
	for a_id, row in pairs(self.prev_pairs) do
		local new_row = new_pairs[a_id]
		for b_id in pairs(row) do
			if not (new_row ~= nil and new_row[b_id]) then
				ends[#ends + 1] = a_id
				ends[#ends + 1] = b_id
			end
		end
	end

	local prev_collider_lookup = self.prev_collider_lookup

	local function resolve_pair(a_id, b_id)
		local a = collider_lookup[a_id] or prev_collider_lookup[a_id]
		local b = collider_lookup[b_id] or prev_collider_lookup[b_id]
		if a == nil or b == nil then
			return nil, nil
		end
		if a.parent == nil or b.parent == nil then
			return nil, nil
		end
		return a, b
	end

	local function emit_pair(event_name, col_a, col_b, contact, phase)
		local owner_a = col_a.parent
		local owner_b = col_b.parent
		if owner_a == nil or owner_b == nil then
			error('[overlap2dsystem] attempted to emit overlap event without collider parents')
		end
		if owner_a.dispose_flag or owner_b.dispose_flag then
			return
		end
		if not owner_a.active or not owner_b.active then
			return
		end
		local resolved_contact = contact
		if resolved_contact == nil and event_name ~= 'overlap.end' then
			resolved_contact = collision2d.get_contact2d(col_a, col_b)
		end
		owner_a.events:emit_event(build_overlap_event(event_name, owner_a, col_a, col_b, owner_b, resolved_contact, phase))
		owner_b.events:emit_event(build_overlap_event(event_name, owner_b, col_b, col_a, owner_a, contact_with_flipped_normal(resolved_contact), phase))
	end

	for i = 1, #begins, 2 do
		local a, b = resolve_pair(begins[i], begins[i + 1])
		if a ~= nil and b ~= nil then
			local contact = collision2d.get_contact2d(a, b)
			emit_pair('overlap.begin', a, b, contact, 'begin')
			emit_pair('overlap', a, b, contact, 'begin')
		end
	end
	for i = 1, #stays, 2 do
		local a, b = resolve_pair(stays[i], stays[i + 1])
		if a ~= nil and b ~= nil then
			local contact = collision2d.get_contact2d(a, b)
			emit_pair('overlap.stay', a, b, contact, 'stay')
			emit_pair('overlap', a, b, contact, 'stay')
		end
	end
	for i = 1, #ends, 2 do
		local a, b = resolve_pair(ends[i], ends[i + 1])
		if a ~= nil and b ~= nil then
			emit_pair('overlap.end', a, b, nil, 'end')
		end
	end

	self.prev_pairs = new_pairs
	self.prev_collider_lookup = collider_lookup
end

local transformsystem = {}
transformsystem.__index = transformsystem
setmetatable(transformsystem, { __index = ecsystem })

function transformsystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), transformsystem)
	return self
end

function transformsystem:update()
	for _, component in world_instance:objects_with_components(transformcomponent, active_scope) do
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
	for _, component in world_instance:objects_with_components(timelinecomponent, active_scope) do
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
	for _, component in world_instance:objects_with_components(meshcomponent, active_scope) do
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
	for obj, tc in world_instance:objects_with_components(textcomponent, active_scope) do
		if not tc.enabled then
			goto continue
		end
		local offset = tc.offset
		local x
		local y
		local z
		local t = obj:get_component(transformcomponent)
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		else
			x = obj.x + offset.x
			y = obj.y + offset.y
			z = obj.z + offset.z
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
	for obj, sc in world_instance:objects_with_components(spritecomponent, active_scope) do
		if not obj.visible or not sc.enabled then
			goto continue
		end
		local offset = sc.offset
		local x
		local y
		local z
		local t = obj:get_component('transformcomponent')
		if t then
			x = t.position.x + offset.x
			y = t.position.y + offset.y
			z = t.position.z + offset.z
		else
			x = obj.x + offset.x
			y = obj.y + offset.y
			z = obj.z + offset.z
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

local function resolve_world_position(obj, offset)
	local x
	local y
	local z
	local t = obj:get_component(transformcomponent)
	if t then
		x = t.position.x + offset.x
		y = t.position.y + offset.y
		z = t.position.z + offset.z
	else
		x = obj.x + offset.x
		y = obj.y + offset.y
		z = obj.z + offset.z
	end
	return x, y, z
end

local lightrendersystem = {}
lightrendersystem.__index = lightrendersystem
setmetatable(lightrendersystem, { __index = ecsystem })

function lightrendersystem.new(priority)
	local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 8.5), lightrendersystem)
	return self
end

function lightrendersystem:update()
	for obj, lc in world_instance:objects_with_components(ambientlightcomponent, active_scope) do
		if not obj.visible or not lc.enabled then
			goto continue_ambient
		end
		put_ambient_light(lc.id, lc.color, lc.intensity)
		::continue_ambient::
	end

	for obj, lc in world_instance:objects_with_components(directionallightcomponent, active_scope) do
		if not obj.visible or not lc.enabled then
			goto continue_directional
		end
		put_directional_light(lc.id, lc.orientation, lc.color, lc.intensity)
		::continue_directional::
	end

	for obj, lc in world_instance:objects_with_components(pointlightcomponent, active_scope) do
		if not obj.visible or not lc.enabled then
			goto continue_point
		end
		local x, y, z = resolve_world_position(obj, lc.offset)
		put_point_light(lc.id, { x = x, y = y, z = z }, lc.color, lc.range, lc.intensity)
		::continue_point::
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
	for obj, mc in world_instance:objects_with_components(meshcomponent, active_scope) do
		if not obj.visible or not mc.enabled then
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
	for obj, rc in world_instance:objects_with_components(customvisualcomponent, active_scope) do
		if not obj.visible or not rc.enabled then
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
	lightrendersystem = lightrendersystem,
	meshrendersystem = meshrendersystem,
	rendersubmitsystem = rendersubmitsystem,
	eventflushsystem = eventflushsystem,
}
