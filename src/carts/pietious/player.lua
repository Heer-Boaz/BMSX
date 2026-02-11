local constants = require('constants.lua')
local eventemitter = require('eventemitter')
local components = require('components')
local room_module = require('room.lua')
local player_action_effects_module = require('player_action_effects.lua')

local player = {}
player.__index = player

local state_tags = {
	variant = {
		quiet = 'v.q',
		walking_right = 'v.wr',
		walking_left = 'v.wl',
		jumping = 'v.j',
		stopped_jumping = 'v.sj',
		controlled_fall = 'v.cf',
		uncontrolled_fall = 'v.uf',
		quiet_sword = 'v.qs',
		uc_fall_sword = 'v.ufs',
		c_fall_sword = 'v.cfs',
		jumping_sword = 'v.js',
		sj_sword = 'v.sjs',
		up_stairs = 'v.us',
		down_stairs = 'v.ds',
		quiet_stairs = 'v.qst',
		sword_stairs = 'v.ss',
		hit_fall = 'v.hf',
		hit_recovery = 'v.hr',
		dying = 'v.d',
	},
	group = {
		stairs = 'g.st',
		sword = 'g.sw',
		damage_lock = 'g.dl',
	},
	ability = {
		spyglass = 'a.spy',
	},
	visual = {
		jump_sword = 'vis.js',
		ground_sword = 'vis.gs',
		stairs_sword = 'vis.ss',
	},
}

player_action_effects_module.attach_player_methods(player)

local player_input_action_effect_program = {
	eval = 'all',
	bindings = {
		{
			name = 'player.secondary.y',
			on = { press = 'y[jp]' },
			go = {
				press = { ['effect.trigger'] = player_action_effects_module.effect_ids.try_use_secondary },
			},
		},
		{
			name = 'player.sword.x',
			on = { press = 'x[jp]' },
			go = {
				press = { ['effect.trigger'] = player_action_effects_module.effect_ids.try_start_sword },
			},
		},
		{
			name = 'player.sword.b',
			on = { press = 'b[jp]' },
			go = {
				press = { ['effect.trigger'] = player_action_effects_module.effect_ids.try_start_sword },
			},
		},
		{
			name = 'player.sword.a',
			on = { press = 'a[jp]' },
			go = {
				press = { ['effect.trigger'] = player_action_effects_module.effect_ids.try_start_sword },
			},
		},
	},
}

local player_dying_frames = timeline_sequence({
	{ value = { player_damage_imgid = 'pietolon_dying_1' }, hold = 8 },
	{ value = { player_damage_imgid = 'pietolon_dying_2' }, hold = 8 },
	{ value = { player_damage_imgid = 'pietolon_dying_3' }, hold = 8 },
	{ value = { player_damage_imgid = 'pietolon_dying_4' }, hold = 8 },
	{ value = { player_damage_imgid = 'pietolon_dying_5' }, hold = 8 },
})
local player_hit_fall_frames = {
	{ player_damage_imgid = 'pietolon_hit_r' },
}
local player_hit_recovery_frames = timeline_sequence({
	{ value = { player_damage_imgid = 'pietolon_recover_r' }, hold = constants.damage.hit_recovery_frames },
})
local player_sword_sequence_frames = timeline_range(constants.sword.duration_frames + 1)
local player_sword_sequence_id = 'p.seq.s'
local player_sword_end_event = 'sword.end'
local player_hit_invulnerability_sequence_frames = timeline_range(constants.damage.hit_invulnerability_frames)
local player_hit_blink_sequence_frames = timeline_range(constants.damage.hit_blink_switch_frames)
local player_fall_substate_sequence_frames = timeline_range(12)
local player_hit_invulnerability_sequence_id = 'p.seq.hi'
local player_hit_blink_sequence_id = 'p.seq.hb'
local player_fall_substate_sequence_id = 'p.seq.f'

if #player_dying_frames ~= constants.damage.death_frames then
	error(string.format(
		"pietious dying timeline mismatch: %d frames vs death_frames=%d",
		#player_dying_frames,
		constants.damage.death_frames
	))
end
if #player_hit_recovery_frames ~= constants.damage.hit_recovery_frames then
	error(string.format(
		"pietious hit_recovery timeline mismatch: %d frames vs hit_recovery_frames=%d",
		#player_hit_recovery_frames,
		constants.damage.hit_recovery_frames
	))
end

function player:reset_runtime()
	self.x = self.spawn_x
	self.y = self.spawn_y
	self.facing = 1
	self.jump_substate = 0
	self.fall_substate = 0
	self.jump_inertia = 0
	self.grounded = true
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.up_pressed = false
	self.up_released = false
	self.down_pressed = false
	self.down_released = false
	self.attack_held = false
	self.attack_pressed = false
	self.attack_released = false
	self.last_dx = 0
	self.last_dy = 0
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.on_vertical_elevator = false
	self.jumping_from_elevator = false
	self.walk_frame = 0
	self.walk_distance_accum = 0
	self.walk_speed_accum = 0
	self.walk_move_dx = 0
	self.walk_move_collided_x = false
	self.sword_id = 0
	self.sword_ground_origin = 'quiet'
	self.stairs_direction = 0
	self.stairs_x = -1
	self.stairs_top_y = self.spawn_y
	self.stairs_bottom_y = self.spawn_y
	self.stairs_anim_frame = 0
	self.stairs_anim_distance = 0
	self.health = constants.damage.max_health
	self.max_health = constants.damage.max_health
	self.hit_invulnerability_timer = 0
	self.hit_blink_on = false
	self.hit_substate = 0
	self.hit_direction = 0
	self.hit_recovery_timer = 0
	self.death_timer = 0
	self.pepernoot_projectile_sequence = 0
	self.pepernoot_projectile_ids = {}
end

function player:set_vertical_elevator_contact(active)
	self.on_vertical_elevator = active
end

function player:ctor()
	self:add_component(components.inputactioneffectcomponent.new({
		parent = self,
		program = player_input_action_effect_program,
	}))
end

function player:ensure_visual_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', constants.ids.player_body_collider_local)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = constants.ids.player_body_collider_local,
			generateoverlapevents = false,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('player')
		self:add_component(body_collider)
	end

	local sword_collider = self:get_component_by_local_id('collider2dcomponent', constants.ids.player_sword_collider_local)
	if sword_collider == nil then
		sword_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = constants.ids.player_sword_collider_local,
			generateoverlapevents = false,
			spaceevents = 'current',
		})
		sword_collider:apply_collision_profile('projectile')
		sword_collider.enabled = false
		self:add_component(sword_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', 'body')
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = 'body',
			imgid = 'pietolon_stand_r',
			offset = { x = 0, y = 0, z = 110 },
			collider_local_id = constants.ids.player_body_collider_local,
		})
		self:add_component(body_sprite)
	end

	local sword_sprite = self:get_component_by_local_id('spritecomponent', 'sword')
	if sword_sprite == nil then
		sword_sprite = components.spritecomponent.new({
			parent = self,
			id_local = 'sword',
			imgid = 'sword_r',
			offset = { x = 0, y = 0, z = 111 },
			collider_local_id = constants.ids.player_sword_collider_local,
		})
		sword_sprite.enabled = false
		self:add_component(sword_sprite)
	end
end

function player:update_damage_state_imgid()
	if self:has_tag(state_tags.variant.dying) then
		local dying_timeline = self:get_timeline('p.tl.d')
		dying_timeline:force_seek(self.death_timer)
		self.player_damage_imgid = dying_timeline:value().player_damage_imgid
		return
	end
	if self:has_tag(state_tags.variant.hit_fall) then
		local hit_fall_timeline = self:get_timeline('p.tl.hf')
		hit_fall_timeline:force_seek(self.hit_substate)
		self.player_damage_imgid = hit_fall_timeline:value().player_damage_imgid
		return
	end
	if self:has_tag(state_tags.variant.hit_recovery) then
		local hit_recovery_timeline = self:get_timeline('p.tl.hr')
		hit_recovery_timeline:force_seek(self.hit_recovery_timer)
		self.player_damage_imgid = hit_recovery_timeline:value().player_damage_imgid
		return
	end
	self.player_damage_imgid = ''
end

function player:update_visual_components()
	self:ensure_visual_components()
	local body_sprite = self:get_component_by_local_id('spritecomponent', 'body')
	local sword_sprite = self:get_component_by_local_id('spritecomponent', 'sword')
	local body_collider = self:get_component_by_local_id('collider2dcomponent', constants.ids.player_body_collider_local)
	local sword_collider = self:get_component_by_local_id('collider2dcomponent', constants.ids.player_sword_collider_local)

	if self.hit_invulnerability_timer > 0 and self.hit_blink_on and not self:has_tag(state_tags.variant.dying) then
		body_sprite.enabled = false
		sword_sprite.enabled = false
		sword_collider.enabled = false
		return
	end
	body_sprite.enabled = true
	body_collider.enabled = true

	self:update_damage_state_imgid()

	local imgid = 'pietolon_stand_r'
	local sword_imgid = nil
	local body_offset_x_right = 0
	local body_offset_x_left = 0
	local sword_offset_x_right = 0
	local sword_offset_x_left = 0
	local sword_offset_y = 0

	if self:has_tag(state_tags.variant.dying)
		or self:has_tag(state_tags.variant.hit_fall)
		or self:has_tag(state_tags.variant.hit_recovery)
	then
		imgid = self.player_damage_imgid
	elseif self:has_tag(state_tags.variant.up_stairs) then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_up_1'
		else
			imgid = 'pietolon_stairs_up_2'
		end
	elseif self:has_tag(state_tags.variant.down_stairs) then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_down_1'
		else
			imgid = 'pietolon_stairs_down_2'
		end
	elseif self:has_tag(state_tags.variant.walking_right) or self:has_tag(state_tags.variant.walking_left) then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	elseif self:has_tag(state_tags.variant.jumping)
		or self:has_tag(state_tags.variant.stopped_jumping)
		or self:has_tag(state_tags.variant.controlled_fall)
	then
		imgid = 'pietolon_jump_r'
	elseif self:has_tag(state_tags.variant.uncontrolled_fall) then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	end

	if self:has_tag(state_tags.visual.jump_sword) then
		imgid = 'pietolon_jumpslash_r'
		sword_imgid = 'sword_r'
		body_offset_x_right = constants.sword.jump_body_offset_right
		body_offset_x_left = constants.sword.jump_body_offset_left
		sword_offset_x_right = constants.sword.jump_offset_right
		sword_offset_x_left = constants.sword.jump_offset_left
		sword_offset_y = constants.sword.jump_offset_y
	elseif self:has_tag(state_tags.visual.ground_sword) then
		imgid = 'pietolon_slash_r'
		sword_imgid = 'sword_r'
		body_offset_x_right = constants.sword.ground_body_offset_right
		body_offset_x_left = constants.sword.ground_body_offset_left
		sword_offset_x_right = constants.sword.ground_offset_right
		sword_offset_x_left = constants.sword.ground_offset_left
		sword_offset_y = constants.sword.ground_offset_y
	elseif self:has_tag(state_tags.visual.stairs_sword) then
		imgid = 'pietolon_slash_r'
		sword_imgid = 'sword_r'
		body_offset_x_right = constants.sword.stairs_body_offset_right
		body_offset_x_left = constants.sword.stairs_body_offset_left
		sword_offset_x_right = constants.sword.stairs_offset_right
		sword_offset_x_left = constants.sword.stairs_offset_left
		sword_offset_y = constants.sword.stairs_offset_y
	end

	local flip_h = self.facing < 0
	if (self:has_tag(state_tags.variant.up_stairs) or self:has_tag(state_tags.variant.down_stairs)) and sword_imgid == nil then
		flip_h = false
	end

	if not flip_h then
		body_sprite.imgid = imgid
		body_sprite.flip.flip_h = false
		body_sprite.offset.x = body_offset_x_right
		body_sprite.offset.y = 0
		body_sprite.offset.z = 110
		if sword_imgid ~= nil then
			sword_sprite.enabled = true
			sword_sprite.imgid = sword_imgid
			sword_sprite.flip.flip_h = false
			sword_sprite.offset.x = sword_offset_x_right
			sword_sprite.offset.y = sword_offset_y
			sword_sprite.offset.z = 111
			sword_collider.enabled = true
		else
			sword_sprite.enabled = false
			sword_collider.enabled = false
		end
	else
		body_sprite.imgid = imgid
		body_sprite.flip.flip_h = true
		body_sprite.offset.x = body_offset_x_left
		body_sprite.offset.y = 0
		body_sprite.offset.z = 110
		if sword_imgid ~= nil then
			sword_sprite.enabled = true
			sword_sprite.imgid = sword_imgid
			sword_sprite.flip.flip_h = true
			sword_sprite.offset.x = sword_offset_x_left
			sword_sprite.offset.y = sword_offset_y
			sword_sprite.offset.z = 111
			sword_collider.enabled = true
		else
			sword_sprite.enabled = false
			sword_collider.enabled = false
		end
	end
end

function player:respawn()
	self:reset_runtime()
	self:reset_sword_sequence()
	self:reset_hit_invulnerability_sequence()
	self:reset_fall_substate_sequence()
	self:dispatch_state_event('respawn')
end

function player:sample_input()
	-- Keep edge detection derived from held-state here.
	-- Using [jp]/[jr] directly was causing inconsistent jump edges when multiple systems queried input in the same tick.
	local was_up_held = self.up_held
	local was_down_held = self.down_held
	local was_attack_held = self.attack_held
	self.left_held = action_triggered('left[p]')
	self.right_held = action_triggered('right[p]')
	self.up_held = action_triggered('up[p]')
	self.down_held = action_triggered('down[p]')
	self.attack_held = action_triggered('?(x[p], b[p], a[p])')
	self.up_pressed = self.up_held and (not was_up_held)
	self.up_released = (not self.up_held) and was_up_held
	self.down_pressed = self.down_held and (not was_down_held)
	self.down_released = (not self.down_held) and was_down_held
	self.attack_pressed = self.attack_held and (not was_attack_held)
	self.attack_released = (not self.attack_held) and was_attack_held
end

function player:update_facing_from_horizontal_input()
	if self.left_held and not self.right_held then
		self.facing = -1
		return
	end
	if self.right_held and not self.left_held then
		self.facing = 1
	end
end

function player:try_start_sword_state()
	if self:has_tag(state_tags.group.damage_lock) then
		return
	end
	if self:has_tag(state_tags.group.sword) then
		return
	end

	local event_name = nil
	if self:has_tag(state_tags.variant.quiet) then
		event_name = 'sword_start_quiet'
		self.sword_ground_origin = 'quiet'
	elseif self:has_tag(state_tags.variant.walking_right) then
		event_name = 'sword_start_walking_right'
		self.sword_ground_origin = 'walking_right'
	elseif self:has_tag(state_tags.variant.walking_left) then
		event_name = 'sword_start_walking_left'
		self.sword_ground_origin = 'walking_left'
	elseif self:has_tag(state_tags.variant.jumping) then
		event_name = 'sword_start_jumping'
	elseif self:has_tag(state_tags.variant.stopped_jumping) then
		event_name = 'sword_start_stopped_jumping'
	elseif self:has_tag(state_tags.variant.controlled_fall) then
		event_name = 'sword_start_controlled_fall'
	elseif self:has_tag(state_tags.variant.uncontrolled_fall) then
		event_name = 'sword_start_uncontrolled_fall'
	elseif self:has_tag(state_tags.variant.quiet_stairs) then
		event_name = 'sword_start_stairs'
	end

	if event_name == nil then
		return
	end

	self.sword_id = self.sword_id + 1
	self:reset_sword_sequence()
	self:dispatch_state_event(event_name)
end

function player:reset_sword()
	self:reset_sword_sequence()
end

function player:reset_sword_sequence()
	self:get_timeline(player_sword_sequence_id):force_seek(0)
end

function player:advance_sword_sequence()
	local sword_sequence = self:get_timeline(player_sword_sequence_id)
	if sword_sequence:value() >= constants.sword.duration_frames then
		self:dispatch_state_event(player_sword_end_event)
		return
	end
	sword_sequence:advance()
end

function player:is_hittable()
	if self.hit_invulnerability_timer > 0 then
		return false
	end
	return not self:has_tag(state_tags.group.damage_lock)
end

function player:update_hit_invulnerability()
	if self.hit_invulnerability_timer == 0 then
		return
	end

	local hit_invulnerability_sequence = self:get_timeline(player_hit_invulnerability_sequence_id)
	hit_invulnerability_sequence:advance()
	self.hit_invulnerability_timer = constants.damage.hit_invulnerability_frames - (hit_invulnerability_sequence:value() + 1)

	local hit_blink_sequence = self:get_timeline(player_hit_blink_sequence_id)
	local hit_blink_events = hit_blink_sequence:advance()
	for i = 1, #hit_blink_events do
		if hit_blink_events[i].kind == 'end' then
			self.hit_blink_on = not self.hit_blink_on
		end
	end
	if self.hit_invulnerability_timer == 0 then
		self.hit_blink_on = false
	end
end

function player:reset_hit_invulnerability_sequence()
	self.hit_invulnerability_timer = 0
	self.hit_blink_on = false
	self:get_timeline(player_hit_invulnerability_sequence_id):rewind()
	self:get_timeline(player_hit_blink_sequence_id):rewind()
end

function player:start_hit_invulnerability_sequence()
	self.hit_invulnerability_timer = constants.damage.hit_invulnerability_frames
	self.hit_blink_on = true
	self:get_timeline(player_hit_invulnerability_sequence_id):rewind()
	self:get_timeline(player_hit_blink_sequence_id):force_seek(0)
end

function player:get_hit_direction_from_source(source_x)
	local center_x = self.x + math.floor(self.width / 2)
	if source_x < center_x then
		return 1
	end
	if source_x > center_x then
		return -1
	end
	if self.facing > 0 then
		return -1
	end
	return 1
end

function player:start_dying()
	if self:has_tag(state_tags.variant.dying) then
		return
	end
	self:reset_sword()
	self.hit_direction = 0
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self.death_timer = 0
	self:reset_hit_invulnerability_sequence()
	self.last_dx = 0
	self.last_dy = 0
	self:dispatch_state_event('hp_zero')
end

function player:take_hit(amount, source_x, source_y, reason)
	if not self:is_hittable() then
		return false
	end

	self.health = self.health - amount
	if self.health < 0 then
		self.health = 0
	end

	local hit_direction = self:get_hit_direction_from_source(source_x)
	if self:has_tag(state_tags.group.stairs) then
		hit_direction = 0
	end

	self:reset_sword()
	self.hit_direction = hit_direction
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self:start_hit_invulnerability_sequence()

	if hit_direction ~= 0 then
		self.facing = -hit_direction
	end

	local knockup_px = constants.damage.knockup_px
	if knockup_px > 0 then
		self:apply_move(0, -knockup_px)
	end

	self:dispatch_state_event('damage', { reason = reason })
	return true
end

function player:collect_loot(loot_type, loot_value)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if loot_type == 'life' then
		self.health = self.health + loot_value
		if self.health > self.max_health then
			self.health = self.max_health
		end
		return true
	end
	if loot_type == 'ammo' then
		self.weapon_level = self.weapon_level + loot_value
		if self.weapon_level > constants.hud.weapon_level then
			self.weapon_level = constants.hud.weapon_level
		end
		return true
	end
	error('pietious player invalid loot_type=' .. tostring(loot_type))
end

function player:has_inventory_item(item_type)
	return self.inventory_items[item_type] == true
end

function player:add_inventory_item(item_type)
	self.inventory_items[item_type] = true
end

function player:equip_secondary_weapon(item_type)
	if self.secondary_weapon == item_type then
		return
	end
	self.secondary_weapon = item_type
end

function player:get_walk_dx()
	if self:has_inventory_item('schoentjes') then
		self.walk_speed_accum = self.walk_speed_accum + constants.physics.walk_dx_schoentjes_num
		local walk_dx = math.floor(self.walk_speed_accum / constants.physics.walk_dx_schoentjes_den)
		self.walk_speed_accum = self.walk_speed_accum - (walk_dx * constants.physics.walk_dx_schoentjes_den)
		return walk_dx
	end
	self.walk_speed_accum = 0
	return constants.physics.walk_dx
end

function player:try_switch_room(direction, keep_stairs_lock)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if keep_stairs_lock then
		self.x = self.stairs_x
	end

	local castle_service = service(self.game_service_id)
	local switch = castle_service:switch_room(direction, self.y, self.y + self.height)
	if switch == nil then
		return false
	end

	self.room = castle_service:get_current_room()
	self.space_id = self.room.space_id
	if direction == 'left' then
		self.x = self.room.world_width - self.width
	elseif direction == 'right' then
		self.x = self.room.tile_size
	elseif direction == 'up' then
		self.y = self.room.world_height - self.height - self.room.tile_size
	else
		self.y = self.room.world_top - self.room.tile_size
	end

	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		self.x = 0
	end
	if self.x > max_x then
		self.x = max_x
	end
	if keep_stairs_lock then
		self.x = self.stairs_x
	end

	if direction == 'left' or direction == 'right' then
		local min_y = self.room.world_top
		local max_y = self.room.world_height - self.height
		if self.y < min_y then
			self.y = min_y
		end
		if self.y > max_y then
			self.y = max_y
		end
	end

	self.last_dx = 0
	self.last_dy = 0
	if not keep_stairs_lock then
		self.stairs_direction = 0
		self.stairs_x = -1
	end
	eventemitter.eventemitter.instance:emit(constants.events.room_switched, self.id, {
		from = switch.from_room_id,
		to = switch.to_room_id,
		dir = direction,
		space = self.room.space_id,
		x = self.x,
		y = self.y,
	})
	return true
end

function player:try_side_room_switch_from_motion(dx)
	local max_x = self.room.world_width - self.width
	if dx < 0 and self.x <= 0 then
		return self:try_switch_room('left', false)
	end
	if dx > 0 and self.x >= max_x then
		return self:try_switch_room('right', false)
	end
	return false
end

function player:can_switch_up_from_state()
	return self:has_tag(state_tags.variant.up_stairs)
		or self:has_tag(state_tags.variant.quiet)
		or self:has_tag(state_tags.variant.walking_left)
		or self:has_tag(state_tags.variant.walking_right)
		or (self:has_tag(state_tags.variant.jumping) and self.jumping_from_elevator)
end

function player:nearing_room_exit()
	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		return 'left'
	end
	if self.x > max_x then
		return 'right'
	end
	local up_exit_threshold = self.room.world_top - self.room.tile_size
	if self.y < up_exit_threshold then
		return 'up'
	end
	local down_exit_threshold = self.room.world_height - self.height
	if self.y > down_exit_threshold then
		return 'down'
	end
	return nil
end

function player:try_vertical_room_switch_from_position()
	local direction = self:nearing_room_exit()
	if direction == 'up' or direction == 'down' then
		if direction == 'up' and (not self:can_switch_up_from_state()) then
			local up_limit = self.room.world_top - self.room.tile_size
			if self.y < up_limit then
				self.y = up_limit
			end
			self.previous_y_collision = true
			return false
		end
		local keep_stairs_lock = self:has_tag(state_tags.group.stairs)
		if not self:try_switch_room(direction, keep_stairs_lock) then
			if direction == 'up' then
				local up_limit = self.room.world_top - self.room.tile_size
				if self.y < up_limit then
					self.y = up_limit
				end
				self.previous_y_collision = true
			else
				local down_limit = self.room.world_height - self.height
				if self.y > down_limit then
					self.y = down_limit
				end
			end
			return false
		end
		if keep_stairs_lock and (not self:sync_stairs_after_vertical_room_switch(direction)) then
			self.stairs_direction = 0
			self.stairs_x = -1
			self:dispatch_state_event('stairs_lock_lost_after_room_switch')
		end
		return true
	end
	return false
end

function player:get_jump_inertia(default_inertia)
	if self.left_held and not self.right_held then
		return -1
	end
	if self.right_held and not self.left_held then
		return 1
	end
	return default_inertia
end

function player:pick_entry_stairs(direction)
	local stairs = self.room.stairs
	local best = nil
	local best_dx = 0
	local tile_size = self.room.tile_size

	for i = 1, #stairs do
		local stair = stairs[i]
		if self.x >= (stair.x - 4) and self.x <= (stair.x + 8) then
			local y_ok = false
			if direction < 0 then
				local min_y = stair.top_y + (tile_size * 2)
				y_ok = self.y >= min_y and self.y <= stair.bottom_y
			else
				local max_y = stair.top_y + tile_size
				y_ok = self.y >= stair.top_y and self.y <= max_y
			end
			if y_ok then
				local dx = math.abs(self.x - stair.x)
				if best == nil or dx < best_dx or (dx == best_dx and stair.x > best.x) then
					best = stair
					best_dx = dx
				end
			end
		end
	end

	return best
end

function player:search_stairs_at_locked_x(x, y_probe)
	local stairs = self.room.stairs
	local ladder_probe = self.room.tile_size * 3
	for i = 1, #stairs do
		local stair = stairs[i]
		if stair.x == x and stair.anchor_y <= (y_probe + ladder_probe) and stair.bottom_y >= y_probe then
			return stair
		end
	end
	return nil
end

function player:apply_stairs_lock(stair)
	self.stairs_x = stair.x
	self.stairs_top_y = stair.top_y
	self.stairs_bottom_y = stair.bottom_y
end

function player:sync_stairs_after_vertical_room_switch(direction)
	local probe_y = self.y
	if direction == 'up' then
		probe_y = probe_y + self.room.tile_size
	end
	local stair = self:search_stairs_at_locked_x(self.stairs_x, probe_y)
	if stair == nil then
		return false
	end

	self:apply_stairs_lock(stair)
	self.x = stair.x
	self.last_dx = 0
	self.last_dy = 0
	return true
end

function player:leave_stairs(event_name)
	self.stairs_direction = 0
	self.stairs_x = -1
	self:dispatch_state_event(event_name)
end

function player:try_step_off_stairs()
	if self.up_held or self.down_held then
		return false
	end

	local dir = 0
	local event_name = nil
	if self.left_held and not self.right_held then
		dir = -1
		event_name = 'stairs_step_off_left'
	elseif self.right_held and not self.left_held then
		dir = 1
		event_name = 'stairs_step_off_right'
	else
		return false
	end

	local room = self.room
	local tile_size = room.tile_size
	local tile_unit = math.floor(tile_size / 4)
	local half_tile = math.floor(tile_size / 2)
	local tx, ty = room_module.world_to_tile(room, self.x, self.y)
	local _, tile_world_y = room_module.tile_to_world(room, tx, ty)
	local dty = self.y - tile_world_y

	local wall_tx = tx - 1
	local wall_ty = ty + 3
	local probe_dx = -8 * tile_unit
	local step_dx = -6 * tile_unit
	if dir > 0 then
		wall_tx = tx + 2
		probe_dx = 8 * tile_unit
		step_dx = 6 * tile_unit
	end

	local can_bottom_step = false
	if dty > half_tile and room_module.is_wall_at_tile(room, wall_tx, wall_ty) and not self:collides_at(self.x + probe_dx, self.y) then
		can_bottom_step = true
	end

	local target_x = self.x
	local target_y = self.y
	local step_mode = ''
	if can_bottom_step then
		target_x = self.x + step_dx
		step_mode = 'bottom'
	else
		local top_step_threshold = self.stairs_top_y + half_tile
		if self.y < top_step_threshold then
			target_x = self.x + (dir * (4 * tile_unit))
			_, target_y = room_module.snap_world_to_tile(room, self.x, self.y)
			step_mode = 'top'
		else
			self.facing = dir
			return false
		end
	end

	self.facing = dir
	local min_x = 0
	local max_x = room.world_width - self.width
	if target_x < min_x then
		target_x = min_x
	end
	if target_x > max_x then
		target_x = max_x
	end

	local old_x = self.x
	local old_y = self.y
	if self:collides_at(target_x, target_y) then
		self.facing = dir
		return false
	end
	self.x = target_x
	self.y = target_y
	self.last_dx = self.x - old_x
	self.last_dy = self.y - old_y
	self.stairs_direction = 0
	self:leave_stairs(event_name)
	return true
end

function player:update_stairs_animation(distance_px)
	self.stairs_anim_distance = self.stairs_anim_distance + distance_px
	local step_px = constants.stairs.anim_step_px
	while self.stairs_anim_distance >= step_px do
		self.stairs_anim_distance = self.stairs_anim_distance - step_px
		if self.stairs_anim_frame == 0 then
			self.stairs_anim_frame = 1
		else
			self.stairs_anim_frame = 0
		end
	end
end

function player:start_stairs(direction, stair, event_name)
	self:apply_stairs_lock(stair)
	self.stairs_direction = direction
	self.stairs_anim_distance = 0
	self.stairs_anim_frame = 0
	self.x = stair.x
	self.last_dx = 0
	self.last_dy = 0
	if direction > 0 then
		local next_y = self.y + constants.stairs.down_start_push_px
		if next_y > self.stairs_bottom_y then
			next_y = self.stairs_bottom_y
		end
		self.last_dy = next_y - self.y
		self.y = next_y
		if self.last_dy ~= 0 then
			self:update_stairs_animation(math.abs(self.last_dy))
		end
	end
	self:dispatch_state_event(event_name)
end

function player:collides_at(x, y)
	local solids = self.room.solids
	for i = 1, #solids do
		local solid = solids[i]
		if x < (solid.x + solid.w) and (x + self.width) > solid.x and y < (solid.y + solid.h) and (y + self.height) > solid.y then
			return true
		end
	end

	local rocks = self.room.rocks
	if #rocks > 0 then
		local destroyed_rock_ids = service(constants.ids.rock_service_instance).destroyed_rock_ids
		local right = x + self.width
		local bottom = y + self.height
		for i = 1, #rocks do
			local rock = rocks[i]
			if destroyed_rock_ids[rock.id] ~= true then
				if x < (rock.x + constants.rock.width) and right > rock.x and y < (rock.y + constants.rock.height) and bottom > rock.y then
					return true
				end
			end
		end
	end

	return false
end

function player:collides_at_jump_ceiling_profile(x, y)
	for x_offset = -(constants.room.tile_size / 2), constants.room.tile_size / 2 do
		if not self:collides_at(x + x_offset, y) then
			return false
		end
	end
	return true
end

function player:collides_at_jump_sword_ceiling_profile(x, y)
	local half = constants.room.tile_size / 2
	if not self:collides_at(x, y) then
		return false
	end
	if not self:collides_at(x + half, y) then
		return false
	end
	if not self:collides_at(x - half, y) then
		return false
	end
	return true
end

function player:find_clear_x_with_probe(next_x, y)
	for x_offset = 0, constants.room.tile_size / 2 do
		local right_x = next_x + x_offset
		if not self:collides_at(right_x, y) then
			return right_x
		end
		if x_offset > 0 then
			local left_x = next_x - x_offset
			if not self:collides_at(left_x, y) then
				return left_x
			end
		end
	end
	return nil
end

function player:apply_move(dx, dy)
	local old_x = self.x
	local old_y = self.y
	local collided_x = false
	local collided_y = false
	local landed = false
	local hit_ceiling = false
	local upward_block = false

	local next_x = old_x + dx
	local next_y = old_y + dy
	local test_x_col = false
	local found = false

	if self:collides_at(next_x, next_y) then
		collided_y = true
		local inc = 1
		if next_y > old_y then
			inc = -1
		end
		if next_y > old_y then
			if self:collides_at(old_x, old_y) then
				local resolved_x = self:find_clear_x_with_probe(next_x, next_y)
				if resolved_x ~= nil then
					self.x = resolved_x
					self.y = next_y
					found = true
				end
			end
			local y_probe = next_y + inc
			while (not found) and y_probe ~= old_y do
				if not self:collides_at(old_x, y_probe) then
					self.y = y_probe
					test_x_col = true
					found = true
				else
					y_probe = y_probe + inc
				end
			end
			if not found then
				landed = true
			end
		else
			if next_y < old_y then
				local y_probe = next_y
				while (not found) and y_probe ~= old_y do
					if not self:collides_at(next_x, y_probe) then
						self.x = next_x
						self.y = y_probe
						found = true
					else
						local resolved_x = self:find_clear_x_with_probe(next_x, y_probe)
						if resolved_x ~= nil then
							self.x = resolved_x
							self.y = y_probe
							found = true
						else
							y_probe = y_probe + inc
						end
					end
				end
				if not found then
					hit_ceiling = true
					upward_block = true
				end
			end
		end
	else
		self.y = next_y
		test_x_col = true
		found = true
	end

	if test_x_col or (not found) then
		if self:collides_at(next_x, self.y) then
			collided_x = true
			local resolved_x = self:find_clear_x_with_probe(next_x, self.y)
			if resolved_x ~= nil then
				self.x = resolved_x
			end
		else
			self.x = next_x
		end
	end

	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		self.x = 0
		collided_x = true
	end
	if self.x > max_x then
		self.x = max_x
		collided_x = true
	end

	local max_y = self.room.world_height - self.height
	if self.y > max_y and self.room.links.down <= 0 then
		self.y = max_y
		landed = true
		collided_y = true
	end

	local moved_x = self.x - old_x
	local moved_y = self.y - old_y
	self.last_dx = moved_x
	self.last_dy = moved_y
	self.previous_x_collision = collided_x
	self.previous_y_collision = upward_block

	return {
		collided_x = collided_x,
		collided_y = collided_y,
		landed = landed,
		hit_ceiling = hit_ceiling,
	}
end

function player:start_jump(inertia)
	self.jump_substate = 0
	self:reset_fall_substate_sequence()
	self.jump_inertia = inertia
	self.jumping_from_elevator = self.on_vertical_elevator
	if inertia < 0 then
		self.facing = -1
	elseif inertia > 0 then
		self.facing = 1
	end
end

function player:reset_fall_substate_sequence()
	self.fall_substate = 0
	self:get_timeline(player_fall_substate_sequence_id):force_seek(0)
end

function player:advance_fall_substate_sequence()
	local fall_substate_sequence = self:get_timeline(player_fall_substate_sequence_id)
	fall_substate_sequence:advance()
	self.fall_substate = fall_substate_sequence:value()
end

function player:get_controlled_fall_dy()
	local substate = self.fall_substate
	if substate < 3 then
		return 0
	end
	if substate >= 11 then
		return 6
	end
	return constants.physics.controlled_fall_dy_by_substate[substate]
end

function player:get_uncontrolled_fall_dy()
	local substate = self.fall_substate
	if substate >= 8 then
		return 6
	end
	return constants.physics.uncontrolled_fall_dy_by_substate[substate]
end

function player:get_controlled_fall_dx()
	local p = constants.physics
	local inertia = self.jump_inertia
	if self.right_held and not self.left_held then
		self.facing = 1
		if inertia == 1 then
			return p.fall_dx_with_inertia
		end
		if inertia == 0 then
			return p.fall_dx_neutral
		end
		return -p.fall_dx_against_inertia
	end
	if self.left_held and not self.right_held then
		self.facing = -1
		if inertia == -1 then
			return -p.fall_dx_with_inertia
		end
		if inertia == 0 then
			return -p.fall_dx_neutral
		end
		return p.fall_dx_against_inertia
	end
	return inertia * p.fall_dx_neutral
end

function player:reset_walk_animation()
	self.walk_frame = 0
	self.walk_distance_accum = 0
end

function player:advance_walk_animation(distance_px)
	self.walk_distance_accum = self.walk_distance_accum + distance_px
	local cycle_px = constants.player.walk_anim_cycle_px
	while self.walk_distance_accum >= cycle_px do
		self.walk_distance_accum = self.walk_distance_accum - cycle_px
		if self.walk_frame == 0 then
			self.walk_frame = 1
		else
			self.walk_frame = 0
		end
	end
end

function player:runcheck_quiet_controls()
	if not self:has_tag(state_tags.variant.quiet) then
		return
	end

	if self.up_pressed then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
	end
	if self.down_pressed then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.up_pressed then
		local inertia = 0
		if self.left_held and not self.right_held then
			inertia = -1
		end
		if self.right_held and not self.left_held then
			inertia = 1
		end
		self:start_jump(inertia)
		self:dispatch_state_event('jump_input')
		return
	end

	if self.left_held and not self.right_held then
		self.facing = -1
		self:dispatch_state_event('left_down')
		return
	end
	if self.right_held and not self.left_held then
		self.facing = 1
		self:dispatch_state_event('right_down')
	end
end

function player:runcheck_walking_right_controls()
	if not self:has_tag(state_tags.variant.walking_right) then
		return
	end

	if self.up_pressed then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(1)
		self:dispatch_state_event('jump_input')
		return
	end
	if self.down_pressed then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.left_held and not self.right_held then
		self:dispatch_state_event('left_override')
		return
	end
	if not self.right_held then
		if self.left_held then
			self:dispatch_state_event('right_released_to_left')
			return
		end
		self:dispatch_state_event('right_released_to_quiet')
		return
	end

	if self.walk_move_collided_x then
		if self:try_side_room_switch_from_motion(self.walk_move_dx) then
			self:dispatch_state_event('room_switch_right')
			return
		end
		self:dispatch_state_event('wall_block')
	end
end

function player:runcheck_walking_left_controls()
	if not self:has_tag(state_tags.variant.walking_left) then
		return
	end

	if self.up_pressed then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(-1)
		self:dispatch_state_event('jump_input')
		return
	end
	if self.down_pressed then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.right_held and not self.left_held then
		self:dispatch_state_event('right_override')
		return
	end
	if not self.left_held then
		if self.right_held then
			self:dispatch_state_event('left_released_to_right')
			return
		end
		self:dispatch_state_event('left_released_to_quiet')
		return
	end

	if self.walk_move_collided_x then
		if self:try_side_room_switch_from_motion(self.walk_move_dx) then
			self:dispatch_state_event('room_switch_left')
			return
		end
		self:dispatch_state_event('wall_block')
	end
end

function player:runcheck_quiet_stairs_controls()
	if not self:has_tag(state_tags.variant.quiet_stairs) then
		return
	end

	if self.up_held then
		self:dispatch_state_event('stairs_up_hold')
		local speed = constants.stairs.speed_px
		local next_y = self.y
		if self.y > self.stairs_top_y then
			next_y = self.y - speed
			self.last_dy = next_y - self.y
			self.y = next_y
			self.stairs_direction = -1
			if self.last_dy ~= 0 then
				self:update_stairs_animation(math.abs(self.last_dy))
			end
			return
		end
		self:leave_stairs('stairs_end_top')
		self.last_dy = 0
		return
	end

	if self.down_held then
		local was_at_or_below_bottom = self.y >= self.stairs_bottom_y
		local down_exit_threshold = self.room.world_height - self.height
		local quiet_down_start_step = constants.stairs.down_start_push_px
		self.stairs_direction = 1
		self:dispatch_state_event('stairs_down_hold')
		local next_y = self.y + quiet_down_start_step
		self.last_dy = next_y - self.y
		self.y = next_y
		if self.last_dy ~= 0 then
			self:update_stairs_animation(math.abs(self.last_dy))
		end
		if was_at_or_below_bottom then
			if self.y >= down_exit_threshold then
				return
			end
			self:leave_stairs('stairs_end_bottom')
		end
		return
	end

	if self.left_held and not self.right_held then
		if self:try_step_off_stairs() then
			return
		end
		self.facing = -1
	end
	if self.right_held and not self.left_held then
		if self:try_step_off_stairs() then
			return
		end
		self.facing = 1
	end
end

function player:tick_quiet()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0

	if not self:collides_at(self.x, self.y + 1) then
		self:reset_fall_substate_sequence()
		self:dispatch_state_event('no_ground')
		return
	end
end

function player:tick_walking_right()
	self.facing = 1
	local walk_dx = self:get_walk_dx()
	self.walk_move_dx = walk_dx
	self.walk_move_collided_x = false

	if not self:collides_at(self.x, self.y + 1) then
		self.previous_x_collision = false
		self.previous_y_collision = false
		self.last_dx = 0
		self.last_dy = 0
		self:reset_fall_substate_sequence()
		self:dispatch_state_event('no_ground')
		return
	end

	local move_result = self:apply_move(walk_dx, 0)
	self.walk_move_collided_x = move_result.collided_x
	if self.last_dx ~= 0 then
		self:advance_walk_animation(math.abs(self.last_dx))
	end
end

function player:tick_walking_left()
	self.facing = -1
	local walk_dx = self:get_walk_dx()
	self.walk_move_dx = -walk_dx
	self.walk_move_collided_x = false

	if not self:collides_at(self.x, self.y + 1) then
		self.previous_x_collision = false
		self.previous_y_collision = false
		self.last_dx = 0
		self.last_dy = 0
		self:reset_fall_substate_sequence()
		self:dispatch_state_event('no_ground')
		return
	end

	local move_result = self:apply_move(-walk_dx, 0)
	self.walk_move_collided_x = move_result.collided_x
	if self.last_dx ~= 0 then
		self:advance_walk_animation(math.abs(self.last_dx))
	end
end

function player:tick_jump_motion()
	if self:has_tag(state_tags.group.sword) then
		self:advance_sword_sequence()
	end
	self:update_facing_from_horizontal_input()
	local p = constants.physics
	local sword_jump = self:has_tag(state_tags.variant.jumping_sword)
	if (not sword_jump) and self.previous_x_collision then
		self.jump_inertia = 0
	end
	if not self.up_held and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
	end

	local dy = p.popolon_jump_dy_by_substate[self.jump_substate]
	if dy == nil then
		dy = 0
	end
	if (not sword_jump) and self.previous_y_collision then
		dy = 0
	end
	local hit_ceiling = (not sword_jump) and self.previous_y_collision
	if (not hit_ceiling) and dy < 0 then
		if sword_jump then
			hit_ceiling = self:collides_at_jump_sword_ceiling_profile(self.x, self.y + dy)
		else
			hit_ceiling = self:collides_at_jump_ceiling_profile(self.x, self.y + dy)
		end
	end
	local dx = self.jump_inertia * p.jump_dx
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end
	if move_result.hit_ceiling then
		hit_ceiling = true
	end

	if hit_ceiling and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
	end

	self.jump_substate = self.jump_substate + 1
	local reached_fall = false
	if self.jump_substate >= p.jump_to_fall_substate then
		self:reset_fall_substate_sequence()
		reached_fall = true
	end
	local sword_state = self:has_tag(state_tags.group.sword)
	if hit_ceiling then
		if sword_state then
			self:dispatch_state_event('ceiling_to_sj_sword')
		else
			self:dispatch_state_event('ceiling_to_stopped_jumping')
		end
	end
	if reached_fall then
		if sword_state then
			self:dispatch_state_event('jump_apex_to_c_fall_sword')
		else
			self:dispatch_state_event('jump_apex_to_controlled_fall')
		end
	end
end

function player:tick_stopped_jump_motion()
	if self:has_tag(state_tags.group.sword) then
		self:advance_sword_sequence()
	end
	self:update_facing_from_horizontal_input()
	if (not self:has_tag(state_tags.group.sword)) and self.previous_x_collision then
		self.jump_inertia = 0
	end
	local dx = self.jump_inertia * constants.physics.jump_dx
	local move_result = self:apply_move(dx, 0)
	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end

	self.jump_substate = self.jump_substate + 1
	if self.jump_substate >= constants.physics.jump_to_fall_substate then
		self:reset_fall_substate_sequence()
		if self:has_tag(state_tags.group.sword) then
			self:dispatch_state_event('stopped_to_fall_to_c_fall_sword')
		else
			self:dispatch_state_event('stopped_to_fall_to_controlled_fall')
		end
	end
end

function player:tick_controlled_fall_motion()
	if self:has_tag(state_tags.group.sword) then
		self:advance_sword_sequence()
	end
	if (not self:has_tag(state_tags.group.sword)) and self.previous_x_collision then
		self.jump_inertia = 0
	end
	local dx = self:get_controlled_fall_dx()
	local dy = self:get_controlled_fall_dy()
	local should_land = (not self:collides_at(self.x, self.y)) and self:collides_at(self.x, self.y + dy)
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end

	if should_land then
		self:reset_fall_substate_sequence()
		if self:has_tag(state_tags.group.sword) then
			self:dispatch_state_event('landed_to_quiet_sword')
		else
			self:dispatch_state_event('landed_to_quiet')
		end
		return
	end

	self:advance_fall_substate_sequence()
end

function player:tick_uncontrolled_fall_motion()
	if self:has_tag(state_tags.group.sword) then
		self:advance_sword_sequence()
	end
	local dy = self:get_uncontrolled_fall_dy()
	local should_land = self:collides_at(self.x, self.y + dy)
	local move_result = self:apply_move(0, dy)

	if should_land then
		self:reset_fall_substate_sequence()
		if self:has_tag(state_tags.group.sword) then
			self:dispatch_state_event('landed_to_quiet_sword')
		else
			self:dispatch_state_event('landed_to_quiet')
		end
		return
	end

	self:advance_fall_substate_sequence()
end

function player:tick_quiet_sword()
	self:advance_sword_sequence()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0

	if not self:collides_at(self.x, self.y + 1) then
		self:reset_fall_substate_sequence()
		self:dispatch_state_event('no_ground')
	end
end

function player:tick_up_stairs()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x

	local speed = constants.stairs.speed_px
	local moved = false
	local next_y = self.y

	if self.up_held and not self.down_held then
		self.stairs_direction = -1
		if self.y > self.stairs_top_y then
			next_y = self.y - speed
			moved = true
		else
			self:leave_stairs('stairs_end_top')
			return
		end
		if next_y <= self.stairs_top_y then
			self.last_dy = next_y - self.y
			self.y = next_y
			self:leave_stairs('stairs_end_top')
			return
		end
	elseif self.down_held then
		self.stairs_direction = 1
		self:dispatch_state_event('stairs_reverse_down')
		if self.y < self.stairs_bottom_y then
			next_y = self.y + constants.stairs.down_start_push_px
			moved = true
		else
			self:leave_stairs('stairs_end_bottom')
			return
		end
	elseif self.left_held and not self.right_held then
		self.facing = -1
		self.stairs_direction = 0
		self:dispatch_state_event('stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self:dispatch_state_event('stairs_quiet_right')
		return
	else
		self.stairs_direction = 0
	end

	if moved then
		self.last_dy = next_y - self.y
		self.y = next_y
		self:update_stairs_animation(math.abs(self.last_dy))
	end
end

function player:tick_down_stairs()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x

	local speed = constants.stairs.speed_px
	local moved = false
	local next_y = self.y
	local down_exit_threshold = self.room.world_height - self.height

	if self.down_held and not self.up_held then
		self.stairs_direction = 1
		if self.y < self.stairs_bottom_y then
			next_y = self.y + speed
			moved = true
		end
		if next_y >= self.stairs_bottom_y then
			self.last_dy = next_y - self.y
			self.y = next_y
			if self.y >= down_exit_threshold then
				return
			end
			self:leave_stairs('stairs_end_bottom')
			return
		end
	elseif self.up_held then
		self.stairs_direction = -1
		self:dispatch_state_event('stairs_reverse_up')
		if self.y > self.stairs_top_y then
			next_y = self.y - speed
			moved = true
		else
			self:leave_stairs('stairs_end_top')
			return
		end
	elseif self.left_held and not self.right_held then
		self.facing = -1
		self.stairs_direction = 0
		self:dispatch_state_event('stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self:dispatch_state_event('stairs_quiet_right')
		return
	else
		self.stairs_direction = 0
	end

	if moved then
		self.last_dy = next_y - self.y
		self.y = next_y
		self:update_stairs_animation(math.abs(self.last_dy))
	end
end

function player:tick_quiet_stairs()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x
	self.stairs_direction = 0
end

function player:tick_sword_stairs()
	self:advance_sword_sequence()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x
	self.stairs_direction = 0
end

function player:tick_hit_fall()
	self:reset_sword()

	local dx = self.hit_direction * constants.damage.knockback_dx
	local dy = 0
	if self.hit_substate >= 4 then
		dy = self.hit_substate - 4
		if dy > 6 then
			dy = 6
		end
	end

	local hit_ground = false
	if self.hit_substate >= 4 then
		hit_ground = (not self:collides_at(self.x, self.y)) and self:collides_at(self.x, self.y + dy)
	end

	local move_result = self:apply_move(dx, dy)
	if move_result.collided_x then
		if self:try_side_room_switch_from_motion(dx) then
			move_result.collided_x = false
		else
			self.hit_direction = 0
		end
	end

	if self.hit_substate >= 4 then
		if self.health <= 0 then
			self:start_dying()
			return
		end
		if hit_ground then
			self.hit_substate = 0
			self.hit_recovery_timer = 0
			self.last_dx = 0
			self.last_dy = 0
			self:dispatch_state_event('hit_ground')
			return
		end
	end

	self.hit_substate = self.hit_substate + 1
end

function player:tick_hit_recovery()
	self:reset_sword()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self.hit_recovery_timer = self.hit_recovery_timer + 1

	if self.hit_recovery_timer < constants.damage.hit_recovery_frames then
		return
	end

	self.hit_recovery_timer = 0
	self.hit_substate = 0
	self:dispatch_state_event('hit_recovered')
end

function player:tick_dying()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
	self:reset_sword()
	self.death_timer = self.death_timer + 1
	if self.death_timer < constants.damage.death_frames then
		return
	end
	self:respawn()
end

function player:tick()
	if not self:has_tag(state_tags.variant.jumping) then
		self.jumping_from_elevator = false
	end
	self:try_vertical_room_switch_from_position()

	self.grounded = self:collides_at(self.x, self.y + 1)
	self:update_visual_components()
	self:update_hit_invulnerability()
end

local function define_player_fsm()
	local states = {
		boot = {
			entering_state = function(self)
				self.inventory_items = {}
				self.secondary_weapon = 'none'
				self.weapon_level = 0
				self:reset_runtime()
				self:ensure_visual_components()
				self:update_visual_components()
				self:define_timeline(new_timeline({
					id = 'p.tl.d',
					frames = player_dying_frames,
					playback_mode = 'once',
				}))
				self:define_timeline(new_timeline({
					id = 'p.tl.hf',
					frames = player_hit_fall_frames,
					playback_mode = 'once',
				}))
				self:define_timeline(new_timeline({
					id = 'p.tl.hr',
					frames = player_hit_recovery_frames,
					playback_mode = 'once',
				}))
					self:define_timeline(new_timeline({
						id = player_sword_sequence_id,
						frames = player_sword_sequence_frames,
						playback_mode = 'once',
						autotick = false,
					}))
					self:define_timeline(new_timeline({
						id = player_hit_invulnerability_sequence_id,
						frames = player_hit_invulnerability_sequence_frames,
						playback_mode = 'once',
						autotick = false,
					}))
					self:define_timeline(new_timeline({
						id = player_hit_blink_sequence_id,
						frames = player_hit_blink_sequence_frames,
						playback_mode = 'loop',
						autotick = false,
					}))
					self:define_timeline(new_timeline({
						id = player_fall_substate_sequence_id,
						frames = player_fall_substate_sequence_frames,
						playback_mode = 'once',
						autotick = false,
					}))
					self:reset_sword_sequence()
					self:reset_hit_invulnerability_sequence()
					self:reset_fall_substate_sequence()
					return '/quiet'
				end,
			},
		quiet = {
			tags = { state_tags.variant.quiet, state_tags.ability.spyglass },
			on = {
				['jump_input'] = '/jumping',
				['left_down'] = '/walking_left',
				['right_down'] = '/walking_right',
				['no_ground'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
				['sword_start_quiet'] = '/quiet_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_quiet,
			run_checks = {
				{
					go = function(self)
						self:runcheck_quiet_controls()
					end,
				},
			},
		},
		walking_right = {
			tags = { state_tags.variant.walking_right, state_tags.ability.spyglass },
			on = {
				['jump_input'] = '/jumping',
				['left_override'] = '/walking_left',
				['right_released_to_left'] = '/walking_left',
				['right_released_to_quiet'] = '/quiet',
				['room_switch_right'] = '/walking_right',
				['wall_block'] = '/quiet',
				['no_ground'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
				['sword_start_walking_right'] = '/quiet_sword',
			},
			entering_state = function(self)
				self:reset_walk_animation()
			end,
			process_input = player.sample_input,
			tick = player.tick_walking_right,
			run_checks = {
				{
					go = function(self)
						self:runcheck_walking_right_controls()
					end,
				},
			},
		},
		walking_left = {
			tags = { state_tags.variant.walking_left, state_tags.ability.spyglass },
			on = {
				['jump_input'] = '/jumping',
				['right_override'] = '/walking_right',
				['left_released_to_right'] = '/walking_right',
				['left_released_to_quiet'] = '/quiet',
				['room_switch_left'] = '/walking_left',
				['wall_block'] = '/quiet',
				['no_ground'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
				['sword_start_walking_left'] = '/quiet_sword',
			},
			entering_state = function(self)
				self:reset_walk_animation()
			end,
			process_input = player.sample_input,
			tick = player.tick_walking_left,
			run_checks = {
				{
					go = function(self)
						self:runcheck_walking_left_controls()
					end,
				},
			},
		},
		jumping = {
			tags = { state_tags.variant.jumping },
			on = {
				['ceiling_to_stopped_jumping'] = '/stopped_jumping',
				['jump_apex_to_controlled_fall'] = '/controlled_fall',
				['sword_start_jumping'] = '/jumping_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_jump_motion,
		},
		stopped_jumping = {
			tags = { state_tags.variant.stopped_jumping },
			on = {
				['stopped_to_fall_to_controlled_fall'] = '/controlled_fall',
				['sword_start_stopped_jumping'] = '/sj_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_stopped_jump_motion,
		},
		controlled_fall = {
			tags = { state_tags.variant.controlled_fall },
			on = {
				['landed_to_quiet'] = '/quiet',
				['sword_start_controlled_fall'] = '/c_fall_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_controlled_fall_motion,
		},
		uncontrolled_fall = {
			tags = { state_tags.variant.uncontrolled_fall },
			on = {
				['landed_to_quiet'] = '/quiet',
				['sword_start_uncontrolled_fall'] = '/uc_fall_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_uncontrolled_fall_motion,
		},
		quiet_sword = {
			tags = {
				state_tags.variant.quiet_sword,
				state_tags.group.sword,
				state_tags.ability.spyglass,
				state_tags.visual.ground_sword,
			},
			on = {
				[player_sword_end_event] = '/quiet',
				['no_ground'] = '/uc_fall_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_quiet_sword,
		},
		uc_fall_sword = {
			tags = {
				state_tags.variant.uc_fall_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			on = {
				[player_sword_end_event] = '/uncontrolled_fall',
				['landed_to_quiet_sword'] = '/quiet_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_uncontrolled_fall_motion,
		},
		c_fall_sword = {
			tags = {
				state_tags.variant.c_fall_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			on = {
				[player_sword_end_event] = '/controlled_fall',
				['landed_to_quiet_sword'] = '/quiet_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_controlled_fall_motion,
		},
		jumping_sword = {
			tags = {
				state_tags.variant.jumping_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			on = {
				[player_sword_end_event] = '/jumping',
				['ceiling_to_sj_sword'] = '/sj_sword',
				['jump_apex_to_c_fall_sword'] = '/c_fall_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_jump_motion,
		},
		sj_sword = {
			tags = {
				state_tags.variant.sj_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			on = {
				[player_sword_end_event] = '/stopped_jumping',
				['stopped_to_fall_to_c_fall_sword'] = '/c_fall_sword',
			},
			process_input = player.sample_input,
			tick = player.tick_stopped_jump_motion,
		},
		up_stairs = {
			tags = { state_tags.variant.up_stairs, state_tags.group.stairs },
			on = {
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_reverse_down'] = '/down_stairs',
				['stairs_quiet_left'] = '/quiet_stairs',
				['stairs_quiet_right'] = '/quiet_stairs',
			},
			process_input = player.sample_input,
			tick = player.tick_up_stairs,
		},
		down_stairs = {
			tags = { state_tags.variant.down_stairs, state_tags.group.stairs },
			on = {
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_reverse_up'] = '/up_stairs',
				['stairs_quiet_left'] = '/quiet_stairs',
				['stairs_quiet_right'] = '/quiet_stairs',
			},
			process_input = player.sample_input,
			tick = player.tick_down_stairs,
		},
		quiet_stairs = {
			tags = { state_tags.variant.quiet_stairs, state_tags.group.stairs },
			on = {
				['stairs_up_hold'] = '/up_stairs',
				['stairs_down_hold'] = '/down_stairs',
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_step_off_left'] = '/quiet',
				['stairs_step_off_right'] = '/quiet',
				['sword_start_stairs'] = '/sword_stairs',
			},
			process_input = player.sample_input,
			tick = player.tick_quiet_stairs,
			run_checks = {
				{
					go = function(self)
						self:runcheck_quiet_stairs_controls()
					end,
				},
			},
		},
		sword_stairs = {
			tags = {
				state_tags.variant.sword_stairs,
				state_tags.group.stairs,
				state_tags.group.sword,
				state_tags.visual.stairs_sword,
			},
			on = {
				[player_sword_end_event] = '/quiet_stairs',
			},
			process_input = player.sample_input,
			tick = player.tick_sword_stairs,
		},
		hit_fall = {
			tags = { state_tags.variant.hit_fall, state_tags.group.damage_lock },
			on = {
				['hit_ground'] = '/hit_recovery',
			},
			process_input = player.sample_input,
			tick = player.tick_hit_fall,
		},
		hit_recovery = {
			tags = { state_tags.variant.hit_recovery, state_tags.group.damage_lock },
			on = {
				['hit_recovered'] = '/quiet',
			},
			process_input = player.sample_input,
			tick = player.tick_hit_recovery,
		},
		dying = {
			tags = { state_tags.variant.dying, state_tags.group.damage_lock },
			on = {
				['respawn'] = '/quiet',
			},
			process_input = player.sample_input,
			tick = player.tick_dying,
		},
	}

	define_fsm(constants.ids.player_fsm, {
		initial = 'boot',
		on = {
			['hp_zero'] = '/dying',
			['damage'] = '/hit_fall',
			['stairs_lock_lost_after_room_switch'] = '/quiet',
		},
		states = states,
	})
end

local function define_player_effects()
	player_action_effects_module.define_player_effects(state_tags)
end

local function register_player_definition()
	define_player_effects()
	define_world_object({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { constants.ids.player_fsm },
		effects = {
			player_action_effects_module.effect_ids.try_start_sword,
			player_action_effects_module.effect_ids.try_use_secondary,
			player_action_effects_module.effect_ids.try_use_pepernoot,
			player_action_effects_module.effect_ids.try_use_spyglass,
		},
		defaults = {
			room = nil,
			game_service_id = constants.ids.castle_service_instance,
			space_id = constants.spaces.castle,
			player_index = 1,
			width = constants.player.width,
			height = constants.player.height,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,
			x = constants.player.start_x,
			y = constants.player.start_y,
			facing = 1,
			jump_substate = 0,
			fall_substate = 0,
			jump_inertia = 0,
			grounded = true,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			up_pressed = false,
			up_released = false,
				down_pressed = false,
				down_released = false,
					attack_held = false,
					attack_pressed = false,
					attack_released = false,
					last_dx = 0,
					last_dy = 0,
					previous_x_collision = false,
					previous_y_collision = false,
					on_vertical_elevator = false,
					jumping_from_elevator = false,
					walk_frame = 0,
				walk_distance_accum = 0,
				walk_speed_accum = 0,
				walk_move_dx = 0,
				walk_move_collided_x = false,
				sword_id = 0,
				sword_ground_origin = 'quiet',
					stairs_direction = 0,
					stairs_x = -1,
					stairs_top_y = constants.player.start_y,
					stairs_bottom_y = constants.player.start_y,
					stairs_anim_frame = 0,
					stairs_anim_distance = 0,
				health = constants.damage.max_health,
				max_health = constants.damage.max_health,
				hit_invulnerability_timer = 0,
				hit_blink_on = false,
			hit_substate = 0,
			hit_direction = 0,
			hit_recovery_timer = 0,
			death_timer = 0,
				player_damage_imgid = player_dying_frames[1].player_damage_imgid,
				inventory_items = nil,
				secondary_weapon = 'none',
				weapon_level = 0,
			pepernoot_projectile_sequence = 0,
			pepernoot_projectile_ids = {},
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = constants.ids.player_def,
	player_instance_id = constants.ids.player_instance,
	player_fsm_id = constants.ids.player_fsm,
}
