-- ecs_systems.lua
-- built-in ecs systems for lua engine

local wrap_text_lines<const> = require('util/wrap_text_lines')
--
-- DESIGN PRINCIPLES — collision handling via overlap2dsystem
--
-- 1. NEVER WRITE CUSTOM COLLISION LOOPS IN CART CODE WHEN YOU WANT
--    EVENT-STYLE OVERLAPS.
--    overlap2dsystem is an opt-in ECS stage. Carts that want automatic
--    overlap events add it to their pipeline; carts that do not can stick to
--    targeted collision queries. When enabled, it detects all overlapping
--    enabled+hittable collider pairs in the active world space and emits
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
--          for enemy in objects_by_tag('enemy') do
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

local ecs<const> = require('ecs')
local clear_map<const> = require('clear_map')
local collision2d<const> = require('collision2d')
local scratchrecordbatch<const> = require('scratchrecordbatch')
local world_instance<const> = require('world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local spritecomponent<const> = 'spritecomponent'
local timelinecomponent<const> = 'timelinecomponent'
local textcomponent<const> = 'textcomponent'
local meshcomponent<const> = 'meshcomponent'
local ambientlightcomponent<const> = 'ambientlightcomponent'
local directionallightcomponent<const> = 'directionallightcomponent'
local pointlightcomponent<const> = 'pointlightcomponent'
local customvisualcomponent<const> = 'customvisualcomponent'
local collider2dcomponent<const> = 'collider2dcomponent'
local positionupdateaxiscomponent<const> = 'positionupdateaxiscomponent'
local screenboundarycomponent<const> = 'screenboundarycomponent'
local tilecollisioncomponent<const> = 'tilecollisioncomponent'
local prohibitleavingscreencomponent<const> = 'prohibitleavingscreencomponent'
local actioneffectcomponent<const> = 'actioneffectcomponent'
local render_scratch_items<const> = scratchrecordbatch.new(2):reserve(2)
local mesh_render_options<const> = render_scratch_items[1]
local point_light_position<const> = render_scratch_items[2]

local resolve_text_draw_position<const> = function(obj, offset)
	local x<const> = obj.x + offset.x
	local y<const> = obj.y + offset.y
	local z<const> = obj.z + offset.z
	return x, y, z
end

local resolve_text_lines<const> = function(tc)
	local glyphs<const> = tc.text
	if type(glyphs) == 'string' then
		if tc.wrap_chars ~= nil and tc.wrap_chars > 0 then
			return wrap_text_lines(glyphs, tc.wrap_chars)
		end
		return { glyphs }
	end
	return glyphs
end

local behaviortreesystem<const> = {}
behaviortreesystem.__index = behaviortreesystem
setmetatable(behaviortreesystem, { __index = ecsystem })

function behaviortreesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.input, priority), behaviortreesystem)
	return self
end

function behaviortreesystem:update()
	local objects<const> = world_instance.active_space.active_objects
	for i = #objects, 1, -1 do
		local obj<const> = objects[i]
		local ids<const> = obj.btree_ids
		local contexts<const> = obj.btreecontexts
		for j = 1, #ids do
			local context<const> = contexts[ids[j]]
			if context.running then
				context.root:tick(obj, context.blackboard)
			end
		end
	end
end

local actioneffectruntimesystem<const> = {}
actioneffectruntimesystem.__index = actioneffectruntimesystem
setmetatable(actioneffectruntimesystem, { __index = ecsystem })

function actioneffectruntimesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.actioneffect, priority), actioneffectruntimesystem)
	return self
end

function actioneffectruntimesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[actioneffectcomponent]
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + dt_ms
		for id, until_time in pairs(component.cooldown_until) do
			if component.time_ms >= until_time then
				component.cooldown_until[id] = nil
			end
		end
	end
end

local statemachinesystem<const> = {}
statemachinesystem.__index = statemachinesystem
setmetatable(statemachinesystem, { __index = ecsystem })

function statemachinesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.moderesolution, priority), statemachinesystem)
	return self
end

function statemachinesystem:update(dt_ms)
	local objects<const> = world_instance.active_space.active_objects
	for i = #objects, 1, -1 do
		objects[i].sc:update(dt_ms)
	end
end

local prepositionsystem<const> = {}
prepositionsystem.__index = prepositionsystem
setmetatable(prepositionsystem, { __index = ecsystem })

function prepositionsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.input, priority), prepositionsystem)
	return self
end

function prepositionsystem:update()
	-- These components all share the same old-position sync, and none of them
	-- use per-component custom preprocess logic. Open-code the copy here so the
	-- frame loop stays a dense data pass instead of paying a tiny method call on
	-- every component every frame.
	local position_components<const> = world_instance.active_space.active_components_by_type[positionupdateaxiscomponent]
	for i = 1, #position_components do
		local component<const> = position_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local boundary_components<const> = world_instance.active_space.active_components_by_type[screenboundarycomponent]
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local tile_components<const> = world_instance.active_space.active_components_by_type[tilecollisioncomponent]
	for i = 1, #tile_components do
		local component<const> = tile_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
	local prohibit_components<const> = world_instance.active_space.active_components_by_type[prohibitleavingscreencomponent]
	for i = 1, #prohibit_components do
		local component<const> = prohibit_components[i]
		local parent<const> = component.parent
		local old_pos<const> = component.old_pos
		old_pos.x = parent.x
		old_pos.y = parent.y
	end
end

local boundarysystem<const> = {}
boundarysystem.__index = boundarysystem
setmetatable(boundarysystem, { __index = ecsystem })

function boundarysystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), boundarysystem)
	return self
end

local emit_boundary_events<const> = function(obj, component)
	local left<const> = component.boundary_left
	local top<const> = component.boundary_top
	local right<const> = component.boundary_right
	local bottom<const> = component.boundary_bottom
	local oldx<const> = component.old_pos.x
	local oldy<const> = component.old_pos.y
	local newx<const> = obj.x
	local newy<const> = obj.y
	local sx<const> = obj.sx or 0
	local sy<const> = obj.sy or 0
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
end

function boundarysystem:update()
	local screen_boundary_components<const> = world_instance.active_space.active_components_by_type[screenboundarycomponent]
	for i = #screen_boundary_components, 1, -1 do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component)
	end
	local prohibit_leave_components<const> = world_instance.active_space.active_components_by_type[prohibitleavingscreencomponent]
	for i = #prohibit_leave_components, 1, -1 do
		local component<const> = prohibit_leave_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component)
	end
end

local tilecollisionsystem<const> = {}
tilecollisionsystem.__index = tilecollisionsystem
setmetatable(tilecollisionsystem, { __index = ecsystem })

local emit_tilecollision_event<const> = function(owner, component, suffix, phase, collision_key, payload)
	local event<const> = component._event
	event.type = component.event_base .. '.' .. suffix
	event.emitter = owner
	event.phase = phase
	event.component_id = component.id
	event.component_local_id = component.id_local
	event.collision_key = collision_key
	event.payload = payload
	owner.events:emit_event(event)
end

function tilecollisionsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), tilecollisionsystem)
	return self
end

function tilecollisionsystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[tilecollisioncomponent]
	for i = #components, 1, -1 do
		local component<const> = components[i]
		local obj<const> = component.parent
		local current_payload<const> = component.current_payload
		local previous_payload<const> = component.previous_payload
		clear_map(current_payload)
		local current_key<const> = component.query(component, obj, current_payload)
		local previous_key<const> = component.previous_collision_key
		if current_key == nil then
			if previous_key ~= nil then
				emit_tilecollision_event(obj, component, 'end', 'end', previous_key, previous_payload)
				component.previous_collision_key = nil
			end
		else
			if previous_key == nil then
				emit_tilecollision_event(obj, component, 'begin', 'begin', current_key, current_payload)
			elseif previous_key ~= current_key then
				emit_tilecollision_event(obj, component, 'end', 'end', previous_key, previous_payload)
				emit_tilecollision_event(obj, component, 'begin', 'begin', current_key, current_payload)
			else
				emit_tilecollision_event(obj, component, 'stay', 'stay', current_key, current_payload)
			end
			component.previous_payload = current_payload
			component.current_payload = previous_payload
			component.previous_collision_key = current_key
		end
	end
end

local overlap2dsystem<const> = {}
overlap2dsystem.__index = overlap2dsystem
setmetatable(overlap2dsystem, { __index = ecsystem })

-- Keep overlap history as canonical collider-pair keys. That keeps the frame
-- loop to one current-pass map fill plus one previous-pass diff, instead of
-- maintaining row pools, id->collider side maps, and buffered begin/stay/end
-- lists around the actual overlap work.
local clear_pair_map<const> = function(set)
	for key, row in pairs(set) do
		clear_map(row)
		set[key] = nil
	end
end

local emit_overlap_event<const> = function(event_name, phase, owner, self_col, other_owner, other_col, contact)
	owner.events:emit_event({
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
	})
end

function overlap2dsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), overlap2dsystem)
	self.prev_pairs = {}
	self.next_pairs = {}
	self.event_colliders = {}
	self.overlap_pairs = scratchrecordbatch.new(64)
	return self
end

function overlap2dsystem:update()
	local prev_pairs<const> = self.prev_pairs
	local new_pairs<const> = self.next_pairs
	local overlap_pairs<const> = self.overlap_pairs
	clear_pair_map(new_pairs)

	local event_colliders<const> = self.event_colliders
	local colliders<const> = world_instance.active_space.active_components_by_type[collider2dcomponent]
	local event_collider_count = 0
	for i = 1, #colliders do
		local collider<const> = colliders[i]
		if collider.enabled and collider.hittable then
			event_collider_count = event_collider_count + 1
			event_colliders[event_collider_count] = collider
		end
	end
	event_colliders[event_collider_count + 1] = nil

	if event_collider_count == 0 then
		clear_pair_map(prev_pairs)
		return
	end

	local overlap_pair_count<const> = event_collider_count > 1 and collision2d.collect_overlaps(event_colliders, event_collider_count, overlap_pairs) or 0
	for i = 1, overlap_pair_count do
		local pair<const> = overlap_pairs.items[i]
		local a<const> = pair.a
		local b<const> = pair.b
		local key_a
		local key_b
		if a.id < b.id then
			key_a = a
			key_b = b
		else
			key_a = b
			key_b = a
		end
		local row = new_pairs[key_a]
		if row == nil then
			row = {}
			new_pairs[key_a] = row
		end
		row[key_b] = true
		local prev_row<const> = prev_pairs[key_a]
		local owner_a<const> = a.parent
		local owner_b<const> = b.parent
		if prev_row ~= nil and prev_row[key_b] then
			if owner_a.active and owner_b.active then
				emit_overlap_event('overlap.stay', 'stay', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event('overlap.stay', 'stay', owner_b, b, owner_a, a, pair.contact_other)
				emit_overlap_event('overlap', 'stay', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event('overlap', 'stay', owner_b, b, owner_a, a, pair.contact_other)
			end
		else
			if owner_a.active and owner_b.active then
				emit_overlap_event('overlap.begin', 'begin', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event('overlap.begin', 'begin', owner_b, b, owner_a, a, pair.contact_other)
				emit_overlap_event('overlap', 'begin', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event('overlap', 'begin', owner_b, b, owner_a, a, pair.contact_other)
			end
		end
	end

	for a, row in pairs(prev_pairs) do
		local new_row<const> = new_pairs[a]
		for b in pairs(row) do
			if not (new_row ~= nil and new_row[b]) then
				local owner_a<const> = a.parent
				local owner_b<const> = b.parent
				if owner_a.active and owner_b.active then
					emit_overlap_event('overlap.end', 'end', owner_a, a, owner_b, b, nil)
					emit_overlap_event('overlap.end', 'end', owner_b, b, owner_a, a, nil)
				end
			end
		end
	end

	self.prev_pairs = new_pairs
	self.next_pairs = prev_pairs
	for i = 1, event_collider_count do
		local collider<const> = event_colliders[i]
		collider._overlap_cache_valid = false
		collider._world_polys_cache_valid = false
	end
end

local timelinesystem<const> = {}
timelinesystem.__index = timelinesystem
setmetatable(timelinesystem, { __index = ecsystem })

function timelinesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.animation, priority), timelinesystem)
	return self
end

function timelinesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[timelinecomponent]
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component.active_count ~= 0 then
			component:tick_active(dt_ms)
		end
	end
end

local textrendersystem<const> = {}
textrendersystem.__index = textrendersystem
setmetatable(textrendersystem, { __index = ecsystem })

function textrendersystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, priority), textrendersystem)
	return self
end

function textrendersystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[textcomponent]
	for i = 1, #components do
		local tc<const> = components[i]
		local obj<const> = tc.parent
		if not tc.enabled then
			goto continue_text_render
		end
		local x<const>, y<const>, z<const> = resolve_text_draw_position(obj, tc.offset)
		tc:render(x, y, z, resolve_text_lines(tc))
		::continue_text_render::
	end
end

local spriterendersystem<const> = {}
spriterendersystem.__index = spriterendersystem
setmetatable(spriterendersystem, { __index = ecsystem })

function spriterendersystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, priority), spriterendersystem)
	return self
end

function spriterendersystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[spritecomponent]
	for i = 1, #components do
		local sc<const> = components[i]
		local obj<const> = sc.parent
		if not obj.visible or not sc.enabled then
			goto continue_sprite_render
		end
		local offset<const> = sc.offset
		local x<const> = obj.x + offset.x
		local y<const> = obj.y + offset.y
		local z<const> = obj.z + offset.z
		local flip_flags = 0
		if sc.flip.flip_h then
			flip_flags = flip_flags | 1
		end
		if sc.flip.flip_v then
			flip_flags = flip_flags | 2
		end
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
			sys_vdp_cmd_blit,
			 13,
			0,
			sc.image_handle,
			x,
			y,
			z,
			sc.layer,
			sc.scale.x,
			sc.scale.y,
			flip_flags,
			sc.colorize.r,
			sc.colorize.g,
			sc.colorize.b,
				sc.colorize.a,
				sc.parallax_weight
			)
		::continue_sprite_render::
	end
end

local resolve_world_position<const> = function(obj, offset)
	local x
	local y
	local z
	local t<const> = obj.transform_component
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

local lightrendersystem<const> = {}
lightrendersystem.__index = lightrendersystem
setmetatable(lightrendersystem, { __index = ecsystem })

function lightrendersystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, priority), lightrendersystem)
	return self
end

function lightrendersystem:update()
	local ambient_components<const> = world_instance.active_space.active_components_by_type[ambientlightcomponent]
	for i = 1, #ambient_components do
		local lc<const> = ambient_components[i]
		local obj<const> = lc.parent
		if obj.visible and lc.enabled then
			put_ambient_light(lc.id, lc.color, lc.intensity)
		end
	end

	local directional_components<const> = world_instance.active_space.active_components_by_type[directionallightcomponent]
	for i = 1, #directional_components do
		local lc<const> = directional_components[i]
		local obj<const> = lc.parent
		if obj.visible and lc.enabled then
			put_directional_light(lc.id, lc.orientation, lc.color, lc.intensity)
		end
	end

	local point_components<const> = world_instance.active_space.active_components_by_type[pointlightcomponent]
	for i = 1, #point_components do
		local lc<const> = point_components[i]
		local obj<const> = lc.parent
		if obj.visible and lc.enabled then
			local x<const>, y<const>, z<const> = resolve_world_position(obj, lc.offset)
			point_light_position.x = x
			point_light_position.y = y
			point_light_position.z = z
			put_point_light(lc.id, point_light_position, lc.color, lc.range, lc.intensity)
		end
	end
end

local meshrendersystem<const> = {}
meshrendersystem.__index = meshrendersystem
setmetatable(meshrendersystem, { __index = ecsystem })

function meshrendersystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, priority), meshrendersystem)
	return self
end

function meshrendersystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[meshcomponent]
	for i = 1, #components do
		local mc<const> = components[i]
		local obj<const> = mc.parent
		if obj.visible and mc.enabled then
			mesh_render_options.joint_matrices = mc.joint_matrices
			mesh_render_options.morph_weights = mc.morph_weights
			mesh_render_options.receive_shadow = mc.receive_shadow
			put_mesh(mc.mesh, mc.matrix, mesh_render_options)
		end
	end
end

local rendersubmitsystem<const> = {}
rendersubmitsystem.__index = rendersubmitsystem
setmetatable(rendersubmitsystem, { __index = ecsystem })

function rendersubmitsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, priority), rendersubmitsystem)
	return self
end

function rendersubmitsystem:update()
	local components<const> = world_instance.active_space.active_components_by_type[customvisualcomponent]
	for i = 1, #components do
		local rc<const> = components[i]
		local obj<const> = rc.parent
		if obj.visible and rc.enabled then
			rc:flush()
		end
	end
end

return {
	behaviortreesystem = behaviortreesystem,
	actioneffectruntimesystem = actioneffectruntimesystem,
	statemachinesystem = statemachinesystem,
	prepositionsystem = prepositionsystem,
	boundarysystem = boundarysystem,
	tilecollisionsystem = tilecollisionsystem,
	overlap2dsystem = overlap2dsystem,
	timelinesystem = timelinesystem,
	textrendersystem = textrendersystem,
	spriterendersystem = spriterendersystem,
	lightrendersystem = lightrendersystem,
	meshrendersystem = meshrendersystem,
	rendersubmitsystem = rendersubmitsystem,
}
