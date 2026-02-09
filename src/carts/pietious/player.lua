local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')

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

local state_labels = {
	[state_quiet] = 'quiet',
	[state_walking_right] = 'walking_right',
	[state_walking_left] = 'walking_left',
	[state_jumping] = 'jumping',
	[state_stopped_jumping] = 'stopped_jumping',
	[state_controlled_fall] = 'controlled_fall',
	[state_uncontrolled_fall] = 'uncontrolled_fall',
	[state_quiet_sword] = 'quiet_sword',
	[state_uc_fall_sword] = 'uc_fall_sword',
	[state_c_fall_sword] = 'c_fall_sword',
	[state_jumping_sword] = 'jumping_sword',
	[state_sj_sword] = 'sj_sword',
	[state_up_stairs] = 'stairs',
	[state_down_stairs] = 'stairs',
	[state_quiet_stairs] = 'stairs',
	[state_sword_stairs] = 'stairs',
	[state_hit_fall] = 'hit_fall',
	[state_hit_recovery] = 'hit_recovery',
	[state_dying] = 'dying',
}

local player_dying_timeline_id = 'pietious.player.player_dying'
local player_hit_fall_timeline_id = 'pietious.player.player_hit_fall'
local player_hit_recovery_timeline_id = 'pietious.player.player_hit_recovery'

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

local function abs(value)
	if value < 0 then
		return -value
	end
	return value
end

local function sign(value)
	if value < 0 then
		return -1
	end
	if value > 0 then
		return 1
	end
	return 0
end

local function bool01(value)
	if value then
		return 1
	end
	return 0
end

local function is_stair_left(ch)
	return ch == '-' or ch == '_'
end

local function is_stair_right(ch)
	return ch == '=' or ch == '+'
end

function player:is_ladder_state()
	return self.sc:matches_state_path(state_up_stairs)
		or self.sc:matches_state_path(state_down_stairs)
		or self.sc:matches_state_path(state_quiet_stairs)
		or self.sc:matches_state_path(state_sword_stairs)
end

function player:is_sword_state()
	return self.sc:matches_state_path(state_quiet_sword)
		or self.sc:matches_state_path(state_uc_fall_sword)
		or self.sc:matches_state_path(state_c_fall_sword)
		or self.sc:matches_state_path(state_jumping_sword)
		or self.sc:matches_state_path(state_sj_sword)
		or self.sc:matches_state_path(state_sword_stairs)
end

function player:emit_event(name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|f=%d|name=%s|%s', telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|f=%d|name=%s', telemetry.event_prefix, self.frame, name))
end

function player:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|f=%d|x=%d|y=%d|dx=%d|dy=%d|st=%s|stv=%s|jsub=%d|fsub=%d|inertia=%d|face=%d|g=%d|left=%d|right=%d|up_hold=%d|up_press=%d|up_release=%d|down=%d|atk=%d|atk_press=%d|slash=%d|slash_phase=%d|stairs_dir=%d|stairs_x=%d|hp=%d|hit_ifr=%d|hit_sub=%d|blink=%d|death_t=%d',
		telemetry.metric_prefix,
		self.frame,
		self.x,
		self.y,
		self.last_dx,
		self.last_dy,
		self.state_name,
		self.state_variant,
		self.debug_jump_substate,
		self.debug_fall_substate,
		self.jump_inertia,
		self.facing,
		bool01(self.grounded),
		bool01(self.left_held),
		bool01(self.right_held),
		bool01(self.up_held),
		bool01(self.up_pressed),
		bool01(self.up_released),
		bool01(self.down_held),
		bool01(self.attack_held),
		bool01(self.attack_pressed),
		self.slash_timer,
		self.sword_phase,
		self.stairs_direction,
		self.stairs_x,
		self.health,
		self.hit_invulnerability_timer,
		self.hit_substate,
		bool01(self.hit_blink_on),
		self.death_timer
	))
end

function player:reset_runtime()
	self.x = self.spawn_x
	self.y = self.spawn_y
	self.facing = 1
	self.state_name = 'boot'
	self.state_variant = 'boot'
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
	self.slash_timer = 0
	self.sword_phase = 0
	self.sword_time = 0
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
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.frame = 0
end

function player:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_visual()
	end
end

function player:update_damage_state_imgid()
	if self.state_variant == 'dying' then
		local dying_timeline = self:get_timeline(player_dying_timeline_id)
		dying_timeline:force_seek(self.death_timer)
		self.player_damage_imgid = dying_timeline:value().player_damage_imgid
		return
	end
	if self.state_variant == 'hit_fall' then
		local hit_fall_timeline = self:get_timeline(player_hit_fall_timeline_id)
		hit_fall_timeline:force_seek(self.hit_substate)
		self.player_damage_imgid = hit_fall_timeline:value().player_damage_imgid
		return
	end
	if self.state_variant == 'hit_recovery' then
		local hit_recovery_timeline = self:get_timeline(player_hit_recovery_timeline_id)
		hit_recovery_timeline:force_seek(self.hit_recovery_timer)
		self.player_damage_imgid = hit_recovery_timeline:value().player_damage_imgid
		return
	end
	self.player_damage_imgid = ''
end

function player:draw_visual()
	if self.hit_invulnerability_timer > 0 and self.hit_blink_on and self.state_variant ~= 'dying' then
		return
	end

	self:update_damage_state_imgid()

	local variant = self.state_variant
	local imgid = 'pietolon_stand_r'
	local sword_imgid = nil
	local body_offset_x_right = 0
	local body_offset_x_left = 0
	local sword_offset_x_right = 0
	local sword_offset_x_left = 0
	local sword_offset_y = 0

	if variant == 'dying' or variant == 'hit_fall' or variant == 'hit_recovery' then
		imgid = self.player_damage_imgid
	elseif variant == 'up_stairs' then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_up_1'
		else
			imgid = 'pietolon_stairs_up_2'
		end
	elseif variant == 'down_stairs' then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_down_1'
		else
			imgid = 'pietolon_stairs_down_2'
		end
	elseif variant == 'walking_right' or variant == 'walking_left' then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	elseif variant == 'jumping' or variant == 'stopped_jumping' or variant == 'controlled_fall' then
		imgid = 'pietolon_jump_r'
	elseif variant == 'uncontrolled_fall' then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	end

	if self.sc:matches_state_path(state_jumping_sword)
		or self.sc:matches_state_path(state_sj_sword)
		or self.sc:matches_state_path(state_c_fall_sword)
		or self.sc:matches_state_path(state_uc_fall_sword) then
		imgid = 'pietolon_jumpslash_r'
		sword_imgid = 'pietolon_jumpslash_sword_r'
		body_offset_x_right = constants.sword.jump_body_offset_right
		body_offset_x_left = constants.sword.jump_body_offset_left
		sword_offset_x_right = constants.sword.jump_offset_right
		sword_offset_x_left = constants.sword.jump_offset_left
		sword_offset_y = constants.sword.jump_offset_y
	elseif self.sc:matches_state_path(state_quiet_sword) then
		imgid = 'pietolon_slash_r'
		sword_imgid = 'pietolon_slash_sword_r'
		body_offset_x_right = constants.sword.ground_body_offset_right
		body_offset_x_left = constants.sword.ground_body_offset_left
		sword_offset_x_right = constants.sword.ground_offset_right
		sword_offset_x_left = constants.sword.ground_offset_left
		sword_offset_y = constants.sword.ground_offset_y
	elseif self.sc:matches_state_path(state_sword_stairs) then
		imgid = 'pietolon_slash_r'
		sword_imgid = 'pietolon_slash_sword_r'
		body_offset_x_right = constants.sword.stairs_body_offset_right
		body_offset_x_left = constants.sword.stairs_body_offset_left
		sword_offset_x_right = constants.sword.stairs_offset_right
		sword_offset_x_left = constants.sword.stairs_offset_left
		sword_offset_y = constants.sword.stairs_offset_y
	end

	local flip_h = self.facing < 0
	if (variant == 'up_stairs' or variant == 'down_stairs' or variant == 'quiet_stairs') and sword_imgid == nil then
		flip_h = false
	end

	if not flip_h then
		put_sprite(imgid, self.x + body_offset_x_right, self.y, 110)
		if sword_imgid ~= nil then
			put_sprite(sword_imgid, self.x + sword_offset_x_right, self.y + sword_offset_y, 111)
		end
	else
		put_sprite(imgid, self.x + body_offset_x_left, self.y, 110, { flip_h = true })
		if sword_imgid ~= nil then
			put_sprite(sword_imgid, self.x + sword_offset_x_left, self.y + sword_offset_y, 111, { flip_h = true })
		end
	end
end

function player:respawn()
	self:reset_runtime()
	self.sc:transition_to(state_quiet)
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

function player:update_slash_debug_fields()
	if self:is_sword_state() then
		local duration = constants.sword.duration_frames
		local remaining = duration - self.sword_time
		if remaining < 1 then
			remaining = 1
		end
		self.slash_timer = remaining
		self.sword_phase = 1
		return
	end
	self.slash_timer = 0
	self.sword_phase = 0
end

function player:is_slashing()
	return self:is_sword_state()
end

function player:try_start_sword_state()
	if not self.attack_pressed then
		return
	end
	if self:is_sword_state() then
		return
	end

	local to_state = nil
	local reason = nil
	if self.sc:matches_state_path(state_quiet) then
		to_state = state_quiet_sword
		reason = 'quiet'
	elseif self.sc:matches_state_path(state_walking_right) then
		to_state = state_quiet_sword
		reason = 'walking_right'
	elseif self.sc:matches_state_path(state_walking_left) then
		to_state = state_quiet_sword
		reason = 'walking_left'
	elseif self.sc:matches_state_path(state_jumping) then
		to_state = state_jumping_sword
		reason = 'jumping'
	elseif self.sc:matches_state_path(state_stopped_jumping) then
		to_state = state_sj_sword
		reason = 'stopped_jumping'
	elseif self.sc:matches_state_path(state_controlled_fall) then
		to_state = state_c_fall_sword
		reason = 'controlled_fall'
	elseif self.sc:matches_state_path(state_uncontrolled_fall) then
		to_state = state_uc_fall_sword
		reason = 'uncontrolled_fall'
	end

	if to_state == nil then
		return
	end

	if to_state == state_quiet_sword then
		self.sword_ground_origin = reason
	end
	self.sword_time = 0
	self:emit_event('slash_start', string.format('reason=%s|x=%d|y=%d', reason, self.x, self.y))
	self:transition_to(to_state, 'sword_start_' .. reason)
end

function player:reset_sword(reason)
	if not self:is_sword_state() and self.sword_time == 0 then
		return
	end
	self.sword_time = 0
	self.slash_timer = 0
	self.sword_phase = 0
	if reason ~= nil then
		self:emit_event('slash_reset', string.format('reason=%s', reason))
	end
end

function player:is_in_damage_lock_state()
	return self.sc:matches_state_path(state_hit_fall) or self.sc:matches_state_path(state_hit_recovery) or self.sc:matches_state_path(state_dying)
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
	if self.sc:matches_state_path(state_dying) then
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
	self:emit_event('player_death', string.format('x=%d|y=%d', self.x, self.y))
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

	self:emit_event(
		'player_hit',
		string.format(
			'reason=%s|x=%d|y=%d|src_x=%d|src_y=%d|dir=%d|dmg=%d|hp=%d',
			reason,
			self.x,
			self.y,
			source_x,
			source_y,
			hit_direction,
			amount,
			self.health
		)
	)
	self:transition_to(state_hit_fall, 'damage_' .. reason)
	return true
end

function player:check_room_enemy_contacts()
	local enemies = self.room.enemies
	for i = 1, #enemies do
		local enemy = enemies[i]
		if self.x < (enemy.x + enemy.w) and (self.x + self.width) > enemy.x and self.y < (enemy.y + enemy.h) and (self.y + self.height) > enemy.y then
			return self:take_hit(
				enemy.damage,
				enemy.x + math.floor(enemy.w / 2),
				enemy.y + math.floor(enemy.h / 2),
				enemy.kind
			)
		end
	end
	return false
end

function player:try_switch_room(direction, keep_stairs_lock)
	if self:is_in_damage_lock_state() then
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
	self:emit_event('room_switch', string.format('from=%s|to=%s|dir=%s|x=%d|y=%d', switch.from_room_id, switch.to_room_id, direction, self.x, self.y))
	eventemitter.eventemitter.instance:emit(constants.events.room_switched, self.id, {
		from = switch.from_room_id,
		to = switch.to_room_id,
		dir = direction,
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
	return self.sc:matches_state_path(state_up_stairs)
		or self.sc:matches_state_path(state_quiet)
		or self.sc:matches_state_path(state_walking_left)
		or self.sc:matches_state_path(state_walking_right)
end

function player:nearing_room_exit()
	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		return 'left'
	end
	local up_exit_threshold = self.room.world_top - self.room.tile_size
	if self.y < up_exit_threshold and self:can_switch_up_from_state() then
		return 'up'
	end
	if self.x > max_x then
		return 'right'
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
		if keep_stairs_lock and (not self:sync_stairs_after_vertical_room_switch()) then
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
				local dx = abs(self.x - stair.x)
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

function player:search_stairs_at_locked_x(x, y)
	local stairs = self.room.stairs
	local best = nil
	local best_dy = 0
	for i = 1, #stairs do
		local stair = stairs[i]
		if stair.x == x and y >= stair.top_y and y <= stair.bottom_y then
			local dy = abs(y - stair.top_y)
			if best == nil or dy < best_dy then
				best = stair
				best_dy = dy
			end
		end
	end
	return best
end

function player:apply_stairs_lock(stair)
	self.stairs_x = stair.x
	self.stairs_top_y = stair.top_y
	self.stairs_bottom_y = stair.bottom_y
end

function player:sync_stairs_after_vertical_room_switch()
	local probe_y = self.y
	if self.sc:matches_state_path(state_up_stairs) then
		probe_y = probe_y + self.room.tile_size
	end

	local stair = self:search_stairs_at_locked_x(self.x, probe_y)
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
	if reason == 'stairs_end_top' then
		self:emit_event('stairs_end', string.format('mode=top|x=%d|y=%d', self.x, self.y))
	elseif reason == 'stairs_end_bottom' then
		self:emit_event('stairs_end', string.format('mode=bottom|x=%d|y=%d', self.x, self.y))
	end
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
	local half_tile = math.floor(tile_size / 2)
	local tx = math.floor((self.x - room.tile_origin_x) / tile_size) + 1
	local ty = math.floor((self.y - room.tile_origin_y) / tile_size) + 1
	local dty = (self.y - room.tile_origin_y) - ((ty - 1) * tile_size)

	local wall_tx = tx - 1
	local wall_ty = ty + 3
	local probe_dx = -8
	local step_dx = -6
	if dir > 0 then
		wall_tx = tx + 2
		probe_dx = 8
		step_dx = 6
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
			target_x = self.x + (dir * 4)
			target_y = math.floor(self.y / tile_size) * tile_size
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
	self:emit_event('stairs_step_off', string.format('dir=%d|x=%d|y=%d|mode=%s|dty=%d', dir, self.x, self.y, step_mode, dty))
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
	self.x = stair.x
	self.last_dx = 0
	self.last_dy = 0
	self:emit_event('stairs_start', string.format('reason=%s|x=%d|y=%d|dir=%d', reason, self.x, self.y, direction))
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
		local step_x = sign(dx)
		for _ = 1, abs(dx) do
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
		local step_y = sign(dy)
		for _ = 1, abs(dy) do
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
	local from_state = self.state_name
	local to_state = state_labels[path]
	if from_state ~= to_state then
		self:emit_event('state', string.format('from=%s|to=%s|reason=%s', from_state, to_state, reason))
	end
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
	self:emit_event('jump_start', string.format('inertia=%d|x=%d|y=%d', inertia, self.x, self.y))
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

function player:tick_quiet()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.last_dx = 0
	self.last_dy = 0

	if not self:is_grounded() then
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=quiet')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
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

function player:tick_walking_right()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.facing = 1

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=walk_right')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	local move_result = self:apply_move(constants.physics.walk_dx, 0)
	if self.last_dx ~= 0 then
		self:advance_walk_animation(abs(self.last_dx))
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

	if move_result.collided_x then
		if self:try_side_room_switch_from_motion(constants.physics.walk_dx) then
			self:transition_to(state_walking_right, 'room_switch_right')
			return
		end
		self:transition_to(state_quiet, 'wall_block')
	end
end

function player:tick_walking_left()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.facing = -1

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=walk_left')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	local move_result = self:apply_move(-constants.physics.walk_dx, 0)
	if self.last_dx ~= 0 then
		self:advance_walk_animation(abs(self.last_dx))
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

	if move_result.collided_x then
		if self:try_side_room_switch_from_motion(-constants.physics.walk_dx) then
			self:transition_to(state_walking_left, 'room_switch_left')
			return
		end
		self:transition_to(state_quiet, 'wall_block')
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
		self:emit_event('land', string.format('x=%d|y=%d', self.x, self.y))
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
		self:emit_event('land', string.format('x=%d|y=%d', self.x, self.y))
		self:transition_to(land_state, 'landed')
		return true
	end

	self.fall_substate = self.fall_substate + 1
	return false
end

function player:tick_jumping()
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1
	self:tick_jump_motion(state_stopped_jumping, state_controlled_fall)
end

function player:tick_stopped_jumping()
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1
	self:tick_stopped_jump_motion(state_controlled_fall)
end

function player:tick_controlled_fall()
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate
	self:tick_controlled_fall_motion(state_quiet)
end

function player:tick_uncontrolled_fall()
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate
	self:tick_uncontrolled_fall_motion(state_quiet)
end

function player:tick_quiet_sword()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
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
		self:emit_event('ledge_drop', 'mode=quiet_sword')
		self:transition_to(state_uc_fall_sword, 'no_ground')
	end

	self.sword_time = self.sword_time + 1
end

function player:tick_uc_fall_sword()
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate

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
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate

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
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1

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
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1

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
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
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
			next_y = self.y + speed
			moved = true
		else
			self:leave_stairs('stairs_end_bottom')
			return
		end
		if next_y >= self.stairs_bottom_y then
			self.last_dy = next_y - self.y
			self.y = next_y
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
		self:update_stairs_animation(abs(self.last_dy))
	end
end

function player:tick_down_stairs()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x

	local speed = constants.stairs.speed_px
	local moved = false
	local next_y = self.y

	if self.down_held and not self.up_held then
		self.stairs_direction = 1
		if self.y < self.stairs_bottom_y then
			next_y = self.y + speed
			moved = true
		end
		if next_y >= self.stairs_bottom_y then
			self.last_dy = next_y - self.y
			self.y = next_y
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
		if next_y <= self.stairs_top_y then
			self.last_dy = next_y - self.y
			self.y = next_y
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
		self:update_stairs_animation(abs(self.last_dy))
	end
end

function player:tick_quiet_stairs()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.last_dx = 0
	self.last_dy = 0
	self.x = self.stairs_x
	self.stairs_direction = 0

	if self.up_held then
		self:transition_to(state_up_stairs, 'stairs_up_hold')
		local speed = constants.stairs.speed_px
		local next_y = self.y
		if self.y > self.stairs_top_y then
			next_y = self.y - speed
			self.last_dy = next_y - self.y
			self.y = next_y
			self.stairs_direction = -1
			self:update_stairs_animation(abs(self.last_dy))
			if next_y <= self.stairs_top_y then
				self:leave_stairs('stairs_end_top')
			end
			return
		end
		self:leave_stairs('stairs_end_top')
		return
	end

	if self.down_held then
		self.stairs_direction = 1
		if self.y < self.stairs_bottom_y then
			self:transition_to(state_down_stairs, 'stairs_down_hold')
			local next_y = self.y + constants.stairs.speed_px
			if next_y > self.stairs_bottom_y then
				next_y = self.stairs_bottom_y
			end
			self.last_dy = next_y - self.y
			self.y = next_y
			if self.last_dy ~= 0 then
				self:update_stairs_animation(abs(self.last_dy))
			end
		else
			self:leave_stairs('stairs_end_bottom')
			self.last_dy = 0
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

	if self.attack_pressed then
		self.sword_time = 0
		self:emit_event('slash_start', string.format('reason=stairs|x=%d|y=%d', self.x, self.y))
		self:transition_to(state_sword_stairs, 'sword_start_stairs')
		return
	end
end

function player:tick_sword_stairs()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
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
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
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
		self.hit_direction = 0
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
			self:emit_event('hit_ground', string.format('x=%d|y=%d|hp=%d', self.x, self.y, self.health))
			self:transition_to(state_hit_recovery, 'hit_ground')
			return
		end
	end

	self.hit_substate = self.hit_substate + 1
end

function player:tick_hit_recovery()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self:reset_sword('hit_recovery')
	self.last_dx = 0
	self.last_dy = 0
	self.hit_recovery_timer = self.hit_recovery_timer + 1

	if self.hit_recovery_timer < constants.damage.hit_recovery_frames then
		return
	end

	self.hit_recovery_timer = 0
	self.hit_substate = 0
	self:emit_event('hit_recovered', string.format('x=%d|y=%d|hp=%d', self.x, self.y, self.health))
	self:transition_to(state_quiet, 'hit_recovered')
end

function player:tick_dying()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.last_dx = 0
	self.last_dy = 0
	self:reset_sword('dying')
	self.death_timer = self.death_timer + 1
	if self.death_timer < constants.damage.death_frames then
		return
	end
	self:emit_event('respawn', string.format('x=%d|y=%d', self.x, self.y))
	self:respawn()
end

function player:tick()
	self.frame = self.frame + 1
	self:sample_input()
	local started_tick_in_sword_state = self:is_sword_state()

	if self.sc:matches_state_path(state_walking_right) then
		self:tick_walking_right()
	elseif self.sc:matches_state_path(state_walking_left) then
		self:tick_walking_left()
	elseif self.sc:matches_state_path(state_jumping) then
		self:tick_jumping()
	elseif self.sc:matches_state_path(state_stopped_jumping) then
		self:tick_stopped_jumping()
	elseif self.sc:matches_state_path(state_controlled_fall) then
		self:tick_controlled_fall()
	elseif self.sc:matches_state_path(state_uncontrolled_fall) then
		self:tick_uncontrolled_fall()
	elseif self.sc:matches_state_path(state_quiet_sword) then
		self:tick_quiet_sword()
	elseif self.sc:matches_state_path(state_uc_fall_sword) then
		self:tick_uc_fall_sword()
	elseif self.sc:matches_state_path(state_c_fall_sword) then
		self:tick_c_fall_sword()
	elseif self.sc:matches_state_path(state_jumping_sword) then
		self:tick_jumping_sword()
	elseif self.sc:matches_state_path(state_sj_sword) then
		self:tick_sj_sword()
	elseif self.sc:matches_state_path(state_up_stairs) then
		self:tick_up_stairs()
	elseif self.sc:matches_state_path(state_down_stairs) then
		self:tick_down_stairs()
	elseif self.sc:matches_state_path(state_quiet_stairs) then
		self:tick_quiet_stairs()
	elseif self.sc:matches_state_path(state_sword_stairs) then
		self:tick_sword_stairs()
	elseif self.sc:matches_state_path(state_hit_fall) then
		self:tick_hit_fall()
	elseif self.sc:matches_state_path(state_hit_recovery) then
		self:tick_hit_recovery()
	elseif self.sc:matches_state_path(state_dying) then
		self:tick_dying()
	else
		self:tick_quiet()
	end

	if not self:is_in_damage_lock_state() and (not started_tick_in_sword_state) then
		self:try_start_sword_state()
	end

	self:try_vertical_room_switch_from_position()
	if not self:is_in_damage_lock_state() then
		self:check_room_enemy_contacts()
	end

	self.grounded = self:is_grounded()
	self:update_slash_debug_fields()
	self:emit_metric()
	self:update_hit_invulnerability()
end

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:bind_visual()
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
				entering_state = function(self)
					self.state_name = 'quiet'
					self.state_variant = 'quiet'
				end,
			},
			walking_right = {
				entering_state = function(self)
					self.state_name = 'walking_right'
					self.state_variant = 'walking_right'
					self:reset_walk_animation()
				end,
			},
			walking_left = {
				entering_state = function(self)
					self.state_name = 'walking_left'
					self.state_variant = 'walking_left'
					self:reset_walk_animation()
				end,
			},
			jumping = {
				entering_state = function(self)
					self.state_name = 'jumping'
					self.state_variant = 'jumping'
				end,
			},
			stopped_jumping = {
				entering_state = function(self)
					self.state_name = 'stopped_jumping'
					self.state_variant = 'stopped_jumping'
				end,
			},
			controlled_fall = {
				entering_state = function(self)
					self.state_name = 'controlled_fall'
					self.state_variant = 'controlled_fall'
				end,
			},
			uncontrolled_fall = {
				entering_state = function(self)
					self.state_name = 'uncontrolled_fall'
					self.state_variant = 'uncontrolled_fall'
				end,
			},
			quiet_sword = {
				entering_state = function(self)
					if self.sword_ground_origin == 'walking_right' then
						self.state_name = 'walking_right'
					elseif self.sword_ground_origin == 'walking_left' then
						self.state_name = 'walking_left'
					else
						self.state_name = 'quiet'
					end
					self.state_variant = 'quiet_sword'
				end,
			},
			uc_fall_sword = {
				entering_state = function(self)
					self.state_name = 'uncontrolled_fall'
					self.state_variant = 'uc_fall_sword'
				end,
			},
			c_fall_sword = {
				entering_state = function(self)
					self.state_name = 'controlled_fall'
					self.state_variant = 'c_fall_sword'
				end,
			},
			jumping_sword = {
				entering_state = function(self)
					self.state_name = 'jumping'
					self.state_variant = 'jumping_sword'
				end,
			},
			sj_sword = {
				entering_state = function(self)
					self.state_name = 'stopped_jumping'
					self.state_variant = 'sj_sword'
				end,
			},
			up_stairs = {
				entering_state = function(self)
					self.state_name = 'stairs'
					self.state_variant = 'up_stairs'
				end,
			},
			down_stairs = {
				entering_state = function(self)
					self.state_name = 'stairs'
					self.state_variant = 'down_stairs'
				end,
			},
			quiet_stairs = {
				entering_state = function(self)
					self.state_name = 'stairs'
					self.state_variant = 'quiet_stairs'
				end,
			},
			sword_stairs = {
				entering_state = function(self)
					self.state_name = 'stairs'
					self.state_variant = 'sword_stairs'
				end,
			},
			hit_fall = {
				entering_state = function(self)
					self.state_name = 'hit_fall'
					self.state_variant = 'hit_fall'
				end,
			},
			hit_recovery = {
				entering_state = function(self)
					self.state_name = 'hit_recovery'
					self.state_variant = 'hit_recovery'
				end,
			},
			dying = {
				entering_state = function(self)
					self.state_name = 'dying'
					self.state_variant = 'dying'
				end,
			},
		},
	})
end

local function register_player_definition()
	define_world_object({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { player_fsm_id },
		components = { 'customvisualcomponent' },
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
			state_name = 'boot',
			state_variant = 'boot',
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
				slash_timer = 0,
				sword_phase = 0,
				sword_time = 0,
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
			debug_jump_substate = -1,
			debug_fall_substate = -1,
			frame = 0,
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
