local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')
local components = require('components')
local pepernoot_projectile_module = require('pepernoot_projectile.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local state_quiet = player_fsm_id .. ':/quiet'
local state_walking_right = player_fsm_id .. ':/walking_right'
local state_walking_left = player_fsm_id .. ':/walking_left'
local state_jumping = player_fsm_id .. ':/jumping'
local state_stopped_jumping = player_fsm_id .. ':/stopped_jumping'
local state_controlled_fall = player_fsm_id .. ':/controlled_fall'
local state_uncontrolled_fall = player_fsm_id .. ':/uncontrolled_fall'
local state_quiet_sword = player_fsm_id .. ':/quiet_sword'
local state_uc_fall_sword = player_fsm_id .. ':/uc_fall_sword'
local state_c_fall_sword = player_fsm_id .. ':/c_fall_sword'
local state_jumping_sword = player_fsm_id .. ':/jumping_sword'
local state_sj_sword = player_fsm_id .. ':/sj_sword'
local state_up_stairs = player_fsm_id .. ':/up_stairs'
local state_down_stairs = player_fsm_id .. ':/down_stairs'
local state_quiet_stairs = player_fsm_id .. ':/quiet_stairs'
local state_sword_stairs = player_fsm_id .. ':/sword_stairs'
local state_hit_fall = player_fsm_id .. ':/hit_fall'
local state_hit_recovery = player_fsm_id .. ':/hit_recovery'
local state_dying = player_fsm_id .. ':/dying'

local state_tags = {
	variant = {
		quiet = 'pietious.player.variant.quiet',
		walking_right = 'pietious.player.variant.walking_right',
		walking_left = 'pietious.player.variant.walking_left',
		jumping = 'pietious.player.variant.jumping',
		stopped_jumping = 'pietious.player.variant.stopped_jumping',
		controlled_fall = 'pietious.player.variant.controlled_fall',
		uncontrolled_fall = 'pietious.player.variant.uncontrolled_fall',
		quiet_sword = 'pietious.player.variant.quiet_sword',
		uc_fall_sword = 'pietious.player.variant.uc_fall_sword',
		c_fall_sword = 'pietious.player.variant.c_fall_sword',
		jumping_sword = 'pietious.player.variant.jumping_sword',
		sj_sword = 'pietious.player.variant.sj_sword',
		up_stairs = 'pietious.player.variant.up_stairs',
		down_stairs = 'pietious.player.variant.down_stairs',
		quiet_stairs = 'pietious.player.variant.quiet_stairs',
		sword_stairs = 'pietious.player.variant.sword_stairs',
		hit_fall = 'pietious.player.variant.hit_fall',
		hit_recovery = 'pietious.player.variant.hit_recovery',
		dying = 'pietious.player.variant.dying',
	},
	group = {
		stairs = 'pietious.player.group.stairs',
		sword = 'pietious.player.group.sword',
		damage_lock = 'pietious.player.group.damage_lock',
	},
	ability = {
		spyglass = 'pietious.player.ability.spyglass',
	},
	visual = {
		jump_sword = 'pietious.player.visual.jump_sword',
		ground_sword = 'pietious.player.visual.ground_sword',
		stairs_sword = 'pietious.player.visual.stairs_sword',
	},
}

local player_dying_timeline_id = 'pietious.player.player_dying'
local player_hit_fall_timeline_id = 'pietious.player.player_hit_fall'
local player_hit_recovery_timeline_id = 'pietious.player.player_hit_recovery'
local body_sprite_component_id = 'body'
local sword_sprite_component_id = 'sword'
local body_collider_component_id = constants.ids.player_body_collider_local
local sword_collider_component_id = constants.ids.player_sword_collider_local
local sword_sprite_imgid = 'sword_r'
local rock_service_id = constants.ids.rock_service_instance
local rock_width = constants.rock.width
local rock_height = constants.rock.height
local player_effect_try_start_sword_id = 'pietious.player.effect.try_start_sword'
local player_effect_try_use_secondary_id = 'pietious.player.effect.try_use_secondary'
local player_event_respawn = 'respawn'

local player_input_action_effect_program = {
	eval = 'all',
	bindings = {
		{
			name = 'player.secondary.y',
			on = { press = 'y[jp]' },
			go = {
				press = { ['effect.trigger'] = player_effect_try_use_secondary_id },
			},
		},
		{
			name = 'player.sword.x',
			on = { press = 'x[jp]' },
			go = {
				press = { ['effect.trigger'] = player_effect_try_start_sword_id },
			},
		},
		{
			name = 'player.sword.b',
			on = { press = 'b[jp]' },
			go = {
				press = { ['effect.trigger'] = player_effect_try_start_sword_id },
			},
		},
		{
			name = 'player.sword.a',
			on = { press = 'a[jp]' },
			go = {
				press = { ['effect.trigger'] = player_effect_try_start_sword_id },
			},
		},
	},
}

local function append_sprite_frames(frames, sprite_id, frame_count)
	for _ = 1, frame_count do
		frames[#frames + 1] = { player_damage_imgid = sprite_id }
	end
end

local function build_dying_sprite_frames()
	local frames = {}
	append_sprite_frames(frames, 'pietolon_dying_1', 8)
	append_sprite_frames(frames, 'pietolon_dying_2', 8)
	append_sprite_frames(frames, 'pietolon_dying_3', 8)
	append_sprite_frames(frames, 'pietolon_dying_4', 8)
	append_sprite_frames(frames, 'pietolon_dying_5', 8)
	return frames
end

local function build_hit_fall_sprite_frames()
	return {
		{ player_damage_imgid = 'pietolon_hit_r' },
	}
end

local function build_hit_recovery_sprite_frames()
	local frames = {}
	append_sprite_frames(frames, 'pietolon_recover_r', constants.damage.hit_recovery_frames)
	return frames
end

local player_dying_frames = build_dying_sprite_frames()
local player_hit_fall_frames = build_hit_fall_sprite_frames()
local player_hit_recovery_frames = build_hit_recovery_sprite_frames()

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

function player:is_ladder_state()
	return self:has_tag(state_tags.group.stairs)
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
	self.walk_frame = 0
	self.walk_distance_accum = 0
	self.walk_move_dx = 0
	self.walk_move_collided_x = false
	self.sword_time = 0
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
	self.hit_blink_timer = 0
	self.hit_blink_on = false
	self.hit_substate = 0
	self.hit_direction = 0
	self.hit_recovery_timer = 0
	self.death_timer = 0
	self.pepernoot_projectile_sequence = 0
	self.pepernoot_projectile_ids = {}
end

function player:ctor()
	self:add_component(components.inputactioneffectcomponent.new({
		parent = self,
		program = player_input_action_effect_program,
	}))
end

function player:ensure_visual_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = body_collider_component_id,
			generateoverlapevents = false,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('player')
		self:add_component(body_collider)
	end

	local sword_collider = self:get_component_by_local_id('collider2dcomponent', sword_collider_component_id)
	if sword_collider == nil then
		sword_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = sword_collider_component_id,
			generateoverlapevents = false,
			spaceevents = 'current',
		})
		sword_collider:apply_collision_profile('projectile')
		sword_collider.enabled = false
		self:add_component(sword_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = 'pietolon_stand_r',
			offset = { x = 0, y = 0, z = 110 },
			collider_local_id = body_collider_component_id,
		})
		self:add_component(body_sprite)
	end

	local sword_sprite = self:get_component_by_local_id('spritecomponent', sword_sprite_component_id)
	if sword_sprite == nil then
		sword_sprite = components.spritecomponent.new({
			parent = self,
			id_local = sword_sprite_component_id,
			imgid = sword_sprite_imgid,
			offset = { x = 0, y = 0, z = 111 },
			collider_local_id = sword_collider_component_id,
		})
		sword_sprite.enabled = false
		self:add_component(sword_sprite)
	end
end

function player:update_damage_state_imgid()
	if self:has_tag(state_tags.variant.dying) then
		local dying_timeline = self:get_timeline(player_dying_timeline_id)
		dying_timeline:force_seek(self.death_timer)
		self.player_damage_imgid = dying_timeline:value().player_damage_imgid
		return
	end
	if self:has_tag(state_tags.variant.hit_fall) then
		local hit_fall_timeline = self:get_timeline(player_hit_fall_timeline_id)
		hit_fall_timeline:force_seek(self.hit_substate)
		self.player_damage_imgid = hit_fall_timeline:value().player_damage_imgid
		return
	end
	if self:has_tag(state_tags.variant.hit_recovery) then
		local hit_recovery_timeline = self:get_timeline(player_hit_recovery_timeline_id)
		hit_recovery_timeline:force_seek(self.hit_recovery_timer)
		self.player_damage_imgid = hit_recovery_timeline:value().player_damage_imgid
		return
	end
	self.player_damage_imgid = ''
end

function player:update_visual_components()
	self:ensure_visual_components()
	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	local sword_sprite = self:get_component_by_local_id('spritecomponent', sword_sprite_component_id)
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	local sword_collider = self:get_component_by_local_id('collider2dcomponent', sword_collider_component_id)

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
		sword_imgid = sword_sprite_imgid
		body_offset_x_right = constants.sword.jump_body_offset_right
		body_offset_x_left = constants.sword.jump_body_offset_left
		sword_offset_x_right = constants.sword.jump_offset_right
		sword_offset_x_left = constants.sword.jump_offset_left
		sword_offset_y = constants.sword.jump_offset_y
	elseif self:has_tag(state_tags.visual.ground_sword) then
		imgid = 'pietolon_slash_r'
		sword_imgid = sword_sprite_imgid
		body_offset_x_right = constants.sword.ground_body_offset_right
		body_offset_x_left = constants.sword.ground_body_offset_left
		sword_offset_x_right = constants.sword.ground_offset_right
		sword_offset_x_left = constants.sword.ground_offset_left
		sword_offset_y = constants.sword.ground_offset_y
	elseif self:has_tag(state_tags.visual.stairs_sword) then
		imgid = 'pietolon_slash_r'
		sword_imgid = sword_sprite_imgid
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
	self:dispatch_state_event(player_event_respawn)
end

function player:sample_input()
	local player_index = self.player_index
	local was_up_held = self.up_held
	local was_down_held = self.down_held
	local was_attack_held = self.attack_held
	self.left_held = action_triggered('left[p]', player_index)
	self.right_held = action_triggered('right[p]', player_index)
	self.up_held = action_triggered('up[p]', player_index)
	self.down_held = action_triggered('down[p]', player_index)
	self.attack_held = action_triggered('x[p]', player_index) or action_triggered('b[p]', player_index) or action_triggered('a[p]', player_index)
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

function player:is_slashing()
	return self:has_tag(state_tags.group.sword)
end

function player:try_start_sword_state()
	if self:is_in_damage_lock_state() then
		return
	end
	if self:has_tag(state_tags.group.sword) then
		return
	end

	local to_state = nil
	local reason = nil
	if self:has_tag(state_tags.variant.quiet) then
		to_state = state_quiet_sword
		reason = 'quiet'
	elseif self:has_tag(state_tags.variant.walking_right) then
		to_state = state_quiet_sword
		reason = 'walking_right'
	elseif self:has_tag(state_tags.variant.walking_left) then
		to_state = state_quiet_sword
		reason = 'walking_left'
	elseif self:has_tag(state_tags.variant.jumping) then
		to_state = state_jumping_sword
		reason = 'jumping'
	elseif self:has_tag(state_tags.variant.stopped_jumping) then
		to_state = state_sj_sword
		reason = 'stopped_jumping'
	elseif self:has_tag(state_tags.variant.controlled_fall) then
		to_state = state_c_fall_sword
		reason = 'controlled_fall'
	elseif self:has_tag(state_tags.variant.uncontrolled_fall) then
		to_state = state_uc_fall_sword
		reason = 'uncontrolled_fall'
	elseif self:has_tag(state_tags.variant.quiet_stairs) then
		to_state = state_sword_stairs
		reason = 'stairs'
	end

	if to_state == nil then
		return
	end

	if to_state == state_quiet_sword then
		self.sword_ground_origin = reason
	end
	self.sword_time = 0
	self.sword_id = self.sword_id + 1
	self:transition_to(to_state, 'sword_start_' .. reason)
end

function player:reset_sword(reason)
	if not self:has_tag(state_tags.group.sword) and self.sword_time == 0 then
		return
	end
	self.sword_time = 0
end

function player:is_in_damage_lock_state()
	return self:has_tag(state_tags.group.damage_lock)
end

function player:is_hittable()
	if self.hit_invulnerability_timer > 0 then
		return false
	end
	return not self:is_in_damage_lock_state()
end

function player:update_hit_invulnerability()
	if self.hit_invulnerability_timer <= 0 then
		self.hit_invulnerability_timer = 0
		self.hit_blink_on = false
		return
	end

	self.hit_invulnerability_timer = self.hit_invulnerability_timer - 1
	if self.hit_blink_timer > 0 then
		self.hit_blink_timer = self.hit_blink_timer - 1
	end
	if self.hit_blink_timer == 0 then
		self.hit_blink_on = not self.hit_blink_on
		self.hit_blink_timer = constants.damage.hit_blink_switch_frames
	end
	if self.hit_invulnerability_timer == 0 then
		self.hit_blink_on = false
	end
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
	self:reset_sword('death')
	self.hit_direction = 0
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self.death_timer = 0
	self.hit_invulnerability_timer = 0
	self.hit_blink_timer = 0
	self.hit_blink_on = false
	self.last_dx = 0
	self.last_dy = 0
	self:transition_to(state_dying, 'hp_zero')
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
	if self:is_ladder_state() then
		hit_direction = 0
	end

	self:reset_sword('hit')
	self.hit_direction = hit_direction
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self.hit_invulnerability_timer = constants.damage.hit_invulnerability_frames
	self.hit_blink_timer = constants.damage.hit_blink_switch_frames
	self.hit_blink_on = true

	if hit_direction ~= 0 then
		self.facing = -hit_direction
	end

	local knockup_px = constants.damage.knockup_px
	if knockup_px > 0 then
		self:apply_move(0, -knockup_px)
	end

	self:transition_to(state_hit_fall, 'damage_' .. reason)
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
		return constants.physics.walk_dx_schoentjes
	end
	return constants.physics.walk_dx
end

function player:refresh_active_pepernoot_projectiles()
	local ids = self.pepernoot_projectile_ids
	local write_index = 1
	for i = 1, #ids do
		local id = ids[i]
		if engine.object(id) ~= nil then
			ids[write_index] = id
			write_index = write_index + 1
		end
	end
	for i = write_index, #ids do
		ids[i] = nil
	end
end

function player:is_secondary_weapon_state_allowed()
	return not self:has_tag(state_tags.group.damage_lock)
end

function player:is_spyglass_state_allowed()
	return self:has_tag(state_tags.ability.spyglass)
end

function player:find_near_lithograph()
	local lithographs = self.room.lithographs
	local player_left = self.x
	local player_top = self.y
	local player_right = self.x + self.width
	local player_bottom = self.y + self.height
	local hit = constants.lithograph

	for i = 1, #lithographs do
		local lithograph = lithographs[i]
		local area_left = lithograph.x + hit.hit_left_px
		local area_top = lithograph.y + hit.hit_top_px
		local area_right = lithograph.x + hit.hit_right_px
		local area_bottom = lithograph.y + hit.hit_bottom_px
		if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
			return lithograph
		end
	end

	return nil
end

function player:try_fire_pepernoot()
	self:refresh_active_pepernoot_projectiles()
	local sw = constants.secondary_weapon
	if #self.pepernoot_projectile_ids >= sw.pepernoot_max_active then
		return
	end
	if self.weapon_level < sw.pepernoot_weapon_level_cost then
		return
	end

	self.pepernoot_projectile_sequence = self.pepernoot_projectile_sequence + 1
	local projectile_id = string.format('pepernoot_%d_%d', self.player_index, self.pepernoot_projectile_sequence)
	local tile_size = self.room.tile_size
	local spawn_x = self.x + (self.facing < 0 and -sw.pepernoot_spawn_offset_x or sw.pepernoot_spawn_offset_x)
	local spawn_y = self.y + sw.pepernoot_spawn_offset_y
	spawn_x = math.floor(spawn_x / tile_size) * tile_size
	spawn_y = math.floor(spawn_y / tile_size) * tile_size

	engine.spawn_object(pepernoot_projectile_module.pepernoot_projectile_def_id, {
		id = projectile_id,
		space_id = self.room.space_id,
		room = self.room,
		room_id = self.room.room_id,
		owner_id = self.id,
		projectile_id = self.pepernoot_projectile_sequence,
		direction = self.facing,
		pos = { x = spawn_x, y = spawn_y, z = 113 },
	})

	self.pepernoot_projectile_ids[#self.pepernoot_projectile_ids + 1] = projectile_id
	self.weapon_level = self.weapon_level - sw.pepernoot_weapon_level_cost
end

function player:try_use_secondary_weapon()
	if not self:is_secondary_weapon_state_allowed() then
		return
	end

	local weapon = self.secondary_weapon
	if weapon == 'none' then
		return
	end
	if weapon == 'pepernoot' then
		if self:is_ladder_state() and not self:has_tag(state_tags.variant.quiet_stairs) then
			return
		end
		self:try_fire_pepernoot()
		return
	end
	if weapon == 'spyglass' then
		if not self:is_spyglass_state_allowed() then
			return
		end
		local lithograph = self:find_near_lithograph()
		if lithograph == nil then
			return
		end
		return
	end
	error('pietious player invalid secondary_weapon=' .. tostring(weapon))
end

function player:collect_world_item(item_type)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if item_type == 'ammofromrock' then
		self.weapon_level = self.weapon_level + constants.pickup_item.ammo_regen
		if self.weapon_level > constants.hud.weapon_level then
			self.weapon_level = constants.hud.weapon_level
		end
		return true
	end
	if item_type == 'lifefromrock' then
		self.health = self.health + constants.pickup_item.life_regen
		if self.health > self.max_health then
			self.health = self.max_health
		end
		return true
	end
	if item_type == 'keyworld1' then
		if self:has_inventory_item(item_type) then
			return false
		end
		self:add_inventory_item(item_type)
		self.health = self.max_health
		return true
	end
	if item_type == 'schoentjes'
		or item_type == 'halo'
		or item_type == 'lamp'
		or item_type == 'spyglass'
		or item_type == 'pepernoot'
		or item_type == 'greenvase'
		or item_type == 'map_world1'
	then
		if self:has_inventory_item(item_type) then
			return false
		end
		self:add_inventory_item(item_type)
		return true
	end
	error('pietious player invalid world item_type=' .. tostring(item_type))
end

function player:try_switch_room(direction, keep_stairs_lock)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if keep_stairs_lock then
		self.x = self.stairs_x
	end

	local castle_service = engine.service(self.game_service_id)
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
	return self:matches_state_path(state_up_stairs)
		or self:matches_state_path(state_quiet)
		or self:matches_state_path(state_walking_left)
		or self:matches_state_path(state_walking_right)
end

function player:nearing_room_exit()
	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		return 'left'
	end
	local up_exit_threshold = self.room.world_top - self.room.tile_size
	if self.y <= up_exit_threshold and self:can_switch_up_from_state() then
		return 'up'
	end
	if self.x > max_x then
		return 'right'
	end
	local down_exit_threshold = self.room.world_height - self.height
	if self.y >= down_exit_threshold then
		return 'down'
	end
	return nil
end

function player:try_vertical_room_switch_from_position()
	local direction = self:nearing_room_exit()
	if direction == 'up' or direction == 'down' then
		local keep_stairs_lock = self:is_ladder_state()
		if not self:try_switch_room(direction, keep_stairs_lock) then
			if direction == 'up' then
				local up_limit = self.room.world_top - self.room.tile_size
				if self.y < up_limit then
					self.y = up_limit
				end
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
			self:transition_to(state_quiet, 'stairs_lock_lost_after_room_switch')
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

function player:find_stairs_up_entry()
	return self:pick_entry_stairs(-1)
end

function player:find_stairs_down_entry()
	return self:pick_entry_stairs(1)
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

function player:get_map_char_at_tile(tx, ty)
	local room = self.room
	if ty < 1 or ty > room.tile_rows then
		return nil
	end
	if tx < 1 or tx > room.tile_columns then
		return nil
	end
	local row = room.map_rows[ty]
	return row:sub(tx, tx)
end

function player:leave_stairs(reason)
	self.stairs_direction = 0
	self.stairs_x = -1
	self:transition_to(state_quiet, reason)
end

function player:try_step_off_stairs()
	if self.up_held or self.down_held then
		return false
	end

	local dir = 0
	local reason = ''
	if self.left_held and not self.right_held then
		dir = -1
		reason = 'stairs_step_off_left'
	elseif self.right_held and not self.left_held then
		dir = 1
		reason = 'stairs_step_off_right'
	else
		return false
	end

	local room = self.room
	local tile_size = room.tile_size
	local tile_unit = math.floor(tile_size / 4)
	local half_tile = math.floor(tile_size / 2)
	local tx = math.floor((self.x - room.tile_origin_x) / tile_size) + 1
	local ty = math.floor((self.y - room.tile_origin_y) / tile_size) + 1
	local dty = (self.y - room.tile_origin_y) - ((ty - 1) * tile_size)

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
	if dty > half_tile and self:get_map_char_at_tile(wall_tx, wall_ty) == '#' and not self:collides_at(self.x + probe_dx, self.y) then
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
			target_y = room.tile_origin_y + (math.floor((self.y - room.tile_origin_y) / tile_size) * tile_size)
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
	self:leave_stairs(reason)
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

function player:start_stairs(direction, stair, reason)
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
	if direction < 0 then
		self:transition_to(state_up_stairs, reason)
	else
		self:transition_to(state_down_stairs, reason)
	end
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
		local destroyed_rock_ids = engine.service(rock_service_id).destroyed_rock_ids
		local right = x + self.width
		local bottom = y + self.height
		for i = 1, #rocks do
			local rock = rocks[i]
			if destroyed_rock_ids[rock.id] ~= true then
				if x < (rock.x + rock_width) and right > rock.x and y < (rock.y + rock_height) and bottom > rock.y then
					return true
				end
			end
		end
	end

	return false
end

function player:is_grounded()
	return self:collides_at(self.x, self.y + 1)
end

function player:apply_move(dx, dy)
	local moved_x = 0
	local moved_y = 0
	local collided_x = false
	local collided_y = false
	local landed = false
	local hit_ceiling = false

	if dx ~= 0 then
		local step_x = math.sign(dx)
		for _ = 1, math.abs(dx) do
			local next_x = self.x + step_x
			if self:collides_at(next_x, self.y) then
				collided_x = true
				break
			end
			self.x = next_x
			moved_x = moved_x + step_x
		end
	end

	if dy ~= 0 then
		local step_y = math.sign(dy)
		for _ = 1, math.abs(dy) do
			local next_y = self.y + step_y
			if self:collides_at(self.x, next_y) then
				collided_y = true
				if step_y > 0 then
					landed = true
				else
					hit_ceiling = true
				end
				break
			end
			self.y = next_y
			moved_y = moved_y + step_y
		end
	end

	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		moved_x = moved_x - self.x
		self.x = 0
		collided_x = true
	end
	if self.x > max_x then
		moved_x = moved_x - (self.x - max_x)
		self.x = max_x
		collided_x = true
	end

	local max_y = self.room.world_height - self.height
	local min_y = self.room.world_top
	if self.y < min_y then
		moved_y = moved_y - (self.y - min_y)
		self.y = min_y
		hit_ceiling = true
		collided_y = true
	end
	if self.y > max_y and self.room.links.down <= 0 then
		moved_y = moved_y - (self.y - max_y)
		self.y = max_y
		landed = true
		collided_y = true
	end

	self.last_dx = moved_x
	self.last_dy = moved_y

	return {
		collided_x = collided_x,
		collided_y = collided_y,
		landed = landed,
		hit_ceiling = hit_ceiling,
	}
end

function player:transition_to(path, reason)
	self.sc:transition_to(path)
end

function player:start_jump(inertia)
	self.jump_substate = 0
	self.fall_substate = 0
	self.jump_inertia = inertia
	if inertia < 0 then
		self.facing = -1
	elseif inertia > 0 then
		self.facing = 1
	end
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
	if not self:matches_state_path(state_quiet) then
		return
	end

	if self.up_pressed then
		local stair = self:find_stairs_up_entry()
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
	end
	if self.down_pressed then
		local stair = self:find_stairs_down_entry()
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
		self:transition_to(state_jumping, 'jump_input')
		return
	end

	if self.left_held and not self.right_held then
		self.facing = -1
		self:transition_to(state_walking_left, 'left_down')
		return
	end
	if self.right_held and not self.left_held then
		self.facing = 1
		self:transition_to(state_walking_right, 'right_down')
	end
end

function player:runcheck_walking_right_controls()
	if not self:matches_state_path(state_walking_right) then
		return
	end

	if self.up_pressed then
		local stair = self:find_stairs_up_entry()
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(1)
		self:transition_to(state_jumping, 'jump_input')
		return
	end
	if self.down_pressed then
		local stair = self:find_stairs_down_entry()
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.left_held and not self.right_held then
		self:transition_to(state_walking_left, 'left_override')
		return
	end
	if not self.right_held then
		if self.left_held then
			self:transition_to(state_walking_left, 'right_released')
			return
		end
		self:transition_to(state_quiet, 'right_released')
		return
	end

	if self.walk_move_collided_x then
		if self:try_side_room_switch_from_motion(self.walk_move_dx) then
			self:transition_to(state_walking_right, 'room_switch_right')
			return
		end
		self:transition_to(state_quiet, 'wall_block')
	end
end

function player:runcheck_walking_left_controls()
	if not self:matches_state_path(state_walking_left) then
		return
	end

	if self.up_pressed then
		local stair = self:find_stairs_up_entry()
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(-1)
		self:transition_to(state_jumping, 'jump_input')
		return
	end
	if self.down_pressed then
		local stair = self:find_stairs_down_entry()
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.right_held and not self.left_held then
		self:transition_to(state_walking_right, 'right_override')
		return
	end
	if not self.left_held then
		if self.right_held then
			self:transition_to(state_walking_right, 'left_released')
			return
		end
		self:transition_to(state_quiet, 'left_released')
		return
	end

	if self.walk_move_collided_x then
		if self:try_side_room_switch_from_motion(self.walk_move_dx) then
			self:transition_to(state_walking_left, 'room_switch_left')
			return
		end
		self:transition_to(state_quiet, 'wall_block')
	end
end

function player:runcheck_quiet_stairs_controls()
	if not self:matches_state_path(state_quiet_stairs) then
		return
	end

	if self.up_held then
		self:transition_to(state_up_stairs, 'stairs_up_hold')
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
		self:transition_to(state_down_stairs, 'stairs_down_hold')
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
	self.last_dx = 0
	self.last_dy = 0

	if not self:is_grounded() then
		self.fall_substate = 0
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end
end

function player:tick_walking_right()
	self.facing = 1
	local walk_dx = self:get_walk_dx()
	self.walk_move_dx = walk_dx
	self.walk_move_collided_x = false

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:transition_to(state_uncontrolled_fall, 'no_ground')
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

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	local move_result = self:apply_move(-walk_dx, 0)
	self.walk_move_collided_x = move_result.collided_x
	if self.last_dx ~= 0 then
		self:advance_walk_animation(math.abs(self.last_dx))
	end
end

function player:tick_jump_motion(stop_state, fall_state)
	self:update_facing_from_horizontal_input()
	local p = constants.physics
	if not self.up_held and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
	end

	local dy = p.popolon_jump_dy_by_substate[self.jump_substate]
	if dy == nil then
		dy = 0
	end
	local dx = self.jump_inertia * p.jump_dx
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end
	if move_result.collided_x then
		self.jump_inertia = 0
	end

	if move_result.hit_ceiling and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
		self:transition_to(stop_state, 'ceiling')
	end

	self.jump_substate = self.jump_substate + 1
	if self.jump_substate >= p.jump_to_fall_substate then
		self.fall_substate = 0
		self:transition_to(fall_state, 'jump_apex')
	end
end

function player:tick_stopped_jump_motion(fall_state)
	self:update_facing_from_horizontal_input()
	local dx = self.jump_inertia * constants.physics.jump_dx
	local move_result = self:apply_move(dx, 0)
	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end
	if move_result.collided_x then
		self.jump_inertia = 0
	end

	self.jump_substate = self.jump_substate + 1
	if self.jump_substate >= constants.physics.jump_to_fall_substate then
		self.fall_substate = 0
		self:transition_to(fall_state, 'stopped_to_fall')
	end
end

function player:tick_controlled_fall_motion(land_state)
	local dx = self:get_controlled_fall_dx()
	local dy = self:get_controlled_fall_dy()
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x and self:try_side_room_switch_from_motion(dx) then
		move_result.collided_x = false
	end
	if move_result.collided_x then
		self.jump_inertia = 0
	end

	if move_result.landed or (dy == 0 and self:is_grounded()) then
		self.fall_substate = 0
		self:transition_to(land_state, 'landed')
		return true
	end

	self.fall_substate = self.fall_substate + 1
	return false
end

function player:tick_uncontrolled_fall_motion(land_state)
	local dy = self:get_uncontrolled_fall_dy()
	local move_result = self:apply_move(0, dy)

	if move_result.landed then
		self.fall_substate = 0
		self:transition_to(land_state, 'landed')
		return true
	end

	self.fall_substate = self.fall_substate + 1
	return false
end

function player:tick_jumping()
	self:tick_jump_motion(state_stopped_jumping, state_controlled_fall)
end

function player:tick_stopped_jumping()
	self:tick_stopped_jump_motion(state_controlled_fall)
end

function player:tick_controlled_fall()
	self:tick_controlled_fall_motion(state_quiet)
end

function player:tick_uncontrolled_fall()
	self:tick_uncontrolled_fall_motion(state_quiet)
end

function player:tick_quiet_sword()
	self.last_dx = 0
	self.last_dy = 0

	local duration = constants.sword.duration_frames
	if self.sword_time >= duration then
		self:transition_to(state_quiet, 'quiet_sword_end')
		self.sword_time = self.sword_time + 1
		return
	end

	if not self:is_grounded() then
		self.fall_substate = 0
		self:transition_to(state_uc_fall_sword, 'no_ground')
	end

	self.sword_time = self.sword_time + 1
end

function player:tick_uc_fall_sword()
	local duration = constants.sword.duration_frames
	local landed_state = state_quiet_sword
	if self.sword_time >= duration then
		self:transition_to(state_uncontrolled_fall, 'uc_fall_sword_end')
		landed_state = state_quiet
	end

	self:tick_uncontrolled_fall_motion(landed_state)
	self.sword_time = self.sword_time + 1
end

function player:tick_c_fall_sword()
	local duration = constants.sword.duration_frames
	local landed_state = state_quiet_sword
	if self.sword_time >= duration then
		if self.facing > 0 then
			self.x = self.x - 2
		else
			self.x = self.x + 2
		end
		self:transition_to(state_controlled_fall, 'c_fall_sword_end')
		landed_state = state_quiet
	end

	self:tick_controlled_fall_motion(landed_state)
	self.sword_time = self.sword_time + 1
end

function player:tick_jumping_sword()
	local duration = constants.sword.duration_frames
	local stop_state = state_sj_sword
	local fall_state = state_c_fall_sword
	if self.sword_time >= duration then
		self:transition_to(state_jumping, 'jumping_sword_end')
		stop_state = state_stopped_jumping
		fall_state = state_controlled_fall
	end

	self:tick_jump_motion(stop_state, fall_state)
	self.sword_time = self.sword_time + 1
end

function player:tick_sj_sword()
	local duration = constants.sword.duration_frames
	local fall_state = state_c_fall_sword
	if self.sword_time >= duration then
		self:transition_to(state_stopped_jumping, 'sj_sword_end')
		fall_state = state_controlled_fall
	end

	self:tick_stopped_jump_motion(fall_state)
	self.sword_time = self.sword_time + 1
end

function player:tick_up_stairs()
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
		self:transition_to(state_down_stairs, 'stairs_reverse_down')
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
		self:transition_to(state_quiet_stairs, 'stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self:transition_to(state_quiet_stairs, 'stairs_quiet_right')
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
		self:transition_to(state_up_stairs, 'stairs_reverse_up')
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
		self:transition_to(state_quiet_stairs, 'stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self:transition_to(state_quiet_stairs, 'stairs_quiet_right')
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
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x
	self.stairs_direction = 0
end

function player:tick_sword_stairs()
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x
	self.stairs_direction = 0

	local duration = constants.sword.duration_frames
	if self.sword_time >= duration then
		self:transition_to(state_quiet_stairs, 'sword_stairs_end')
	end

	self.sword_time = self.sword_time + 1
end

function player:tick_hit_fall()
	self:reset_sword('hit_fall')

	local dx = self.hit_direction * constants.damage.knockback_dx
	local dy = 0
	if self.hit_substate >= 4 then
		dy = self.hit_substate - 4
		if dy > 6 then
			dy = 6
		end
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
		if move_result.landed or (dy == 0 and self:is_grounded()) then
			self.hit_substate = 0
			self.hit_recovery_timer = 0
			self.last_dx = 0
			self.last_dy = 0
			self:transition_to(state_hit_recovery, 'hit_ground')
			return
		end
	end

	self.hit_substate = self.hit_substate + 1
end

function player:tick_hit_recovery()
	self:reset_sword('hit_recovery')
	self.last_dx = 0
	self.last_dy = 0
	self.hit_recovery_timer = self.hit_recovery_timer + 1

	if self.hit_recovery_timer < constants.damage.hit_recovery_frames then
		return
	end

	self.hit_recovery_timer = 0
	self.hit_substate = 0
	self:transition_to(state_quiet, 'hit_recovered')
end

function player:tick_dying()
	self.last_dx = 0
	self.last_dy = 0
	self:reset_sword('dying')
	self.death_timer = self.death_timer + 1
	if self.death_timer < constants.damage.death_frames then
		return
	end
	self:respawn()
end

function player:tick()
	self:try_vertical_room_switch_from_position()

	self.grounded = self:is_grounded()
	self:update_visual_components()
	self:update_hit_invulnerability()
end

local function define_player_fsm()
	local states = {
		boot = {
			entering_state = function(self)
				self.inventory_items = {}
				self.secondary_weapon = 'none'
				self.weapon_level = constants.hud.weapon_level
				self:reset_runtime()
				self:ensure_visual_components()
				self:update_visual_components()
				self:define_timeline(new_timeline({
					id = player_dying_timeline_id,
					frames = player_dying_frames,
					playback_mode = 'once',
				}))
				self:define_timeline(new_timeline({
					id = player_hit_fall_timeline_id,
					frames = player_hit_fall_frames,
					playback_mode = 'once',
				}))
				self:define_timeline(new_timeline({
					id = player_hit_recovery_timeline_id,
					frames = player_hit_recovery_frames,
					playback_mode = 'once',
				}))
				return '/quiet'
			end,
		},
		quiet = {
			tags = { state_tags.variant.quiet, state_tags.ability.spyglass },
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
			process_input = player.sample_input,
			tick = player.tick_jumping,
		},
		stopped_jumping = {
			tags = { state_tags.variant.stopped_jumping },
			process_input = player.sample_input,
			tick = player.tick_stopped_jumping,
		},
		controlled_fall = {
			tags = { state_tags.variant.controlled_fall },
			process_input = player.sample_input,
			tick = player.tick_controlled_fall,
		},
		uncontrolled_fall = {
			tags = { state_tags.variant.uncontrolled_fall },
			process_input = player.sample_input,
			tick = player.tick_uncontrolled_fall,
		},
		quiet_sword = {
			tags = {
				state_tags.variant.quiet_sword,
				state_tags.group.sword,
				state_tags.ability.spyglass,
				state_tags.visual.ground_sword,
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
			process_input = player.sample_input,
			tick = player.tick_uc_fall_sword,
		},
		c_fall_sword = {
			tags = {
				state_tags.variant.c_fall_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			process_input = player.sample_input,
			tick = player.tick_c_fall_sword,
		},
		jumping_sword = {
			tags = {
				state_tags.variant.jumping_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			process_input = player.sample_input,
			tick = player.tick_jumping_sword,
		},
		sj_sword = {
			tags = {
				state_tags.variant.sj_sword,
				state_tags.group.sword,
				state_tags.visual.jump_sword,
			},
			process_input = player.sample_input,
			tick = player.tick_sj_sword,
		},
		up_stairs = {
			tags = { state_tags.variant.up_stairs, state_tags.group.stairs },
			process_input = player.sample_input,
			tick = player.tick_up_stairs,
		},
		down_stairs = {
			tags = { state_tags.variant.down_stairs, state_tags.group.stairs },
			process_input = player.sample_input,
			tick = player.tick_down_stairs,
		},
		quiet_stairs = {
			tags = { state_tags.variant.quiet_stairs, state_tags.group.stairs },
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
			process_input = player.sample_input,
			tick = player.tick_sword_stairs,
		},
		hit_fall = {
			tags = { state_tags.variant.hit_fall, state_tags.group.damage_lock },
			process_input = player.sample_input,
			tick = player.tick_hit_fall,
		},
		hit_recovery = {
			tags = { state_tags.variant.hit_recovery, state_tags.group.damage_lock },
			process_input = player.sample_input,
			tick = player.tick_hit_recovery,
		},
		dying = {
			tags = { state_tags.variant.dying, state_tags.group.damage_lock },
			on = {
				[player_event_respawn] = '/quiet',
			},
			process_input = player.sample_input,
			tick = player.tick_dying,
		},
	}

	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = states,
	})
end

local function define_player_effects()
	define_effect({
		id = player_effect_try_start_sword_id,
		handler = function(context)
			context.owner:try_start_sword_state()
		end,
	})
	define_effect({
		id = player_effect_try_use_secondary_id,
		handler = function(context)
			context.owner:try_use_secondary_weapon()
		end,
	})
end

local function register_player_definition()
	define_player_effects()
	define_world_object({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { player_fsm_id },
		effects = {
			player_effect_try_start_sword_id,
			player_effect_try_use_secondary_id,
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
				walk_frame = 0,
				walk_distance_accum = 0,
				walk_move_dx = 0,
				walk_move_collided_x = false,
				sword_time = 0,
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
			hit_blink_timer = 0,
			hit_blink_on = false,
			hit_substate = 0,
			hit_direction = 0,
			hit_recovery_timer = 0,
			death_timer = 0,
				player_damage_imgid = player_dying_frames[1].player_damage_imgid,
				inventory_items = nil,
				secondary_weapon = 'none',
				weapon_level = constants.hud.weapon_level,
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
