local constants = require('constants.lua')
local stage = require('stage.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local missile_state_fall_from_vessel = 'fall_from_vessel'
local missile_state_fall_from_floor = 'fall_from_floor'

function player:emit_event(name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|kind=player|f=%d|name=%s|%s', telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=player|f=%d|name=%s', telemetry.event_prefix, self.frame, name))
end

function player:get_vessel_snapshot(vessel_id)
	if vessel_id == 1 then
		return self.x, self.y
	end
	local option = self.options[vessel_id - 1]
	return option.x, option.y
end

function player:get_projectile_snapshot(list, index)
	local projectile = list[index]
	if projectile == nil then
		return -1, -1
	end
	return projectile.x, projectile.y
end

function player:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	local l0x, l0y = self:get_projectile_snapshot(self.lasers, 1)
	local m0x, m0y = self:get_projectile_snapshot(self.missiles, 1)
	local u0x, u0y = self:get_projectile_snapshot(self.uplasers, 1)
	print(string.format(
		'%s|kind=player|f=%d|x=%.3f|y=%.3f|dx=%.3f|dy=%.3f|sprite=%s|speed=%.3f|left=%d|right=%d|up=%d|down=%d|fire=%d|fire_press=%d|options=%d|laser=%d|missile=%d|uplaser=%d|l0x=%.3f|l0y=%.3f|m0x=%.3f|m0y=%.3f|u0x=%.3f|u0y=%.3f',
		telemetry.metric_prefix,
		self.frame,
		self.x,
		self.y,
		self.last_dx,
		self.last_dy,
		self.sprite_imgid,
		self.last_speed,
		bool01(self.left_held),
		bool01(self.right_held),
		bool01(self.up_held),
		bool01(self.down_held),
		bool01(self.fire_held),
		bool01(self.fire_pressed),
		#self.options,
		#self.lasers,
		#self.missiles,
		#self.uplasers,
		l0x,
		l0y,
		m0x,
		m0y,
		u0x,
		u0y
	))
end

function player:get_vessel_count()
	return #self.options + 1
end

function player:initialize_options()
	local option_count = constants.loadout.option_count
	local follow_delay = constants.player.option_follow_delay
	self.options = {}
	for option_index = 1, option_count do
		local option = {
			vessel_id = option_index + 1,
			target_vessel_id = option_index,
			x = self.x,
			y = self.y,
			target_prev_x = self.x,
			target_prev_y = self.y,
			follow_dx = {},
			follow_dy = {},
		}
		for i = 1, follow_delay do
			option.follow_dx[i] = 0
			option.follow_dy[i] = 0
		end
		self.options[option_index] = option
	end
	self.option_anim_index = 1
end

function player:initialize_weapon_slots()
	self.weapon_slots = {
		laser = {},
		missile = {},
		uplaser = {},
	}
	local vessel_count = self:get_vessel_count()
	for vessel_id = 1, vessel_count do
		self.weapon_slots.laser[vessel_id] = 0
		self.weapon_slots.missile[vessel_id] = 0
		self.weapon_slots.uplaser[vessel_id] = 0
	end
end

function player:reset_runtime()
	self.frame = 0
	self.x = constants.player.start_x
	self.y = constants.player.start_y
	self.last_dx = 0
	self.last_dy = 0
	self.last_speed = 0
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.fire_held = false
	self.fire_pressed = false
	self.speed_powerups = constants.loadout.speed_powerups
	self.sprite_imgid = constants.assets.player_n
	self:initialize_options()
	self.lasers = {}
	self.missiles = {}
	self.uplasers = {}
	self:initialize_weapon_slots()
	self:emit_event(
		'player_reset',
		string.format(
			'x=%d|y=%d|speed=%d|options=%d|laser=%d|missile=%d|uplaser=%d',
			self.x,
			self.y,
			constants.loadout.speed_powerups,
			constants.loadout.option_count,
			constants.loadout.laser_level,
			constants.loadout.missile_level,
			constants.loadout.uplaser_level
		)
	)
end

function player:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_visual()
	end
end

function player:get_option_imgid()
	if self.option_anim_index == 1 then
		return constants.assets.option1
	end
	if self.option_anim_index == 2 then
		return constants.assets.option2
	end
	if self.option_anim_index == 3 then
		return constants.assets.option3
	end
	return constants.assets.option4
end

function player:get_laser_visual_x(x, weapon)
	local tile_width = weapon.tile_width
	return math.floor(x / tile_width) * tile_width
end

function player:get_laser_visual_y(y, weapon)
	local visual_step = weapon.tile_width * 0.5
	return math.floor(y / visual_step) * visual_step
end

function player:draw_lasers()
	local weapon = constants.weapons.laser
	local tile_width = weapon.tile_width
	for i = 1, #self.lasers do
		local laser = self.lasers[i]
		local start_x = self:get_laser_visual_x(laser.left_x, weapon)
		local end_x = self:get_laser_visual_x(laser.right_x, weapon)
		local visual_y = self:get_laser_visual_y(laser.y, weapon)
		if end_x <= start_x then
			end_x = start_x + tile_width
		end
		local x = start_x
		while x < end_x do
			put_sprite(constants.assets.laser, x, visual_y, 122)
			x = x + tile_width
		end
	end
end

function player:draw_missiles()
	for i = 1, #self.missiles do
		local missile = self.missiles[i]
		put_sprite(missile.sprite_imgid, missile.x, missile.y, 122)
	end
end

function player:draw_uplasers()
	local weapon = constants.weapons.uplaser
	local tile_width = weapon.tile_width
	for i = 1, #self.uplasers do
		local uplaser = self.uplasers[i]
		local base_x = self:get_laser_visual_x(uplaser.x, weapon)
		local visual_y = self:get_laser_visual_y(uplaser.y, weapon)
		for tile_index = 0, uplaser.tile_count - 1 do
			put_sprite(constants.assets.laser, base_x + (tile_index * tile_width), visual_y, 122)
		end
	end
end

function player:draw_visual()
	local option_imgid = self:get_option_imgid()
	for i = 1, #self.options do
		local option = self.options[i]
		put_sprite(option_imgid, option.x, option.y, 119)
	end
	put_sprite(self.sprite_imgid, self.x, self.y, 120)
	self:draw_lasers()
	self:draw_missiles()
	self:draw_uplasers()
end

function player:sample_input()
	local player_index = self.player_index
	local previous_fire = self.fire_held
	self.left_held = action_triggered('left[p]', player_index)
	self.right_held = action_triggered('right[p]', player_index)
	self.up_held = action_triggered('up[p]', player_index)
	self.down_held = action_triggered('down[p]', player_index)
	self.fire_held = action_triggered('x[p]', player_index) or action_triggered('a[p]', player_index) or action_triggered('b[p]', player_index)
	self.fire_pressed = self.fire_held and (not previous_fire)
end

function player:get_movement_speed()
	return constants.player.base_movement_speed + constants.player.movement_speed_increase * self.speed_powerups
end

function player:update_position()
	local max_x = constants.machine.game_width - constants.player.width
	local max_y = constants.machine.game_height - constants.player.height

	local previous_x = self.x
	local previous_y = self.y

	local function clamp_axis(value, min_value, max_value)
		return math.min(math.max(value, min_value), max_value)
	end

	local function collides_at(x, y)
		local hitcheck_x = constants.player.hitcheck_x
		local hitcheck_y = constants.player.hitcheck_y
		for i = 1, #hitcheck_x do
			if stage.is_solid_pixel(x + hitcheck_x[i], y + hitcheck_y[i]) then
				return true
			end
		end
		return false
	end

	local function try_move_x(dx)
		if dx == 0 then
			return
		end
		local target_x = clamp_axis(self.x + dx, 0, max_x)
		if collides_at(target_x, self.y) then
			self:emit_event('collision_block_x', string.format('x=%.3f|y=%.3f|dx=%.3f', target_x, self.y, dx))
			return
		end
		self.x = target_x
	end

	local function try_move_y(dy)
		if dy == 0 then
			return
		end
		local target_y = clamp_axis(self.y + dy, 0, max_y)
		if collides_at(self.x, target_y) then
			self:emit_event('collision_block_y', string.format('x=%.3f|y=%.3f|dy=%.3f', self.x, target_y, dy))
			return
		end
		self.y = target_y
	end

	if self.left_held then
		try_move_x(-self:get_movement_speed())
	end
	if self.right_held then
		try_move_x(self:get_movement_speed())
	end

	if self.up_held then
		try_move_y(-self:get_movement_speed())
		self.sprite_imgid = constants.assets.player_u
	elseif self.down_held then
		try_move_y(self:get_movement_speed())
		self.sprite_imgid = constants.assets.player_d
	else
		self.sprite_imgid = constants.assets.player_n
	end

	self.last_dx = self.x - previous_x
	self.last_dy = self.y - previous_y
end

function player:update_options()
	if self.last_dx == 0 and self.last_dy == 0 then
		return
	end

	local follow_delay = constants.player.option_follow_delay
	for i = 1, #self.options do
		local option = self.options[i]
		local target_x, target_y = self:get_vessel_snapshot(option.target_vessel_id)
		local target_dx = target_x - option.target_prev_x
		local target_dy = target_y - option.target_prev_y
		option.x = option.x + option.follow_dx[1]
		option.y = option.y + option.follow_dy[1]

		for queue_index = 1, follow_delay - 1 do
			option.follow_dx[queue_index] = option.follow_dx[queue_index + 1]
			option.follow_dy[queue_index] = option.follow_dy[queue_index + 1]
		end
		option.follow_dx[follow_delay] = target_dx
		option.follow_dy[follow_delay] = target_dy
		option.target_prev_x = target_x
		option.target_prev_y = target_y
	end
end

function player:tick_option_animation()
	self.option_anim_index = self.option_anim_index + 1
	if self.option_anim_index > 4 then
		self.option_anim_index = 1
	end
end

function player:refresh_uplaser_dimensions(uplaser)
	local weapon = constants.weapons.uplaser
	uplaser.width = uplaser.length_units * weapon.length_unit_px
	uplaser.height = weapon.tile_height
	uplaser.tile_count = uplaser.width / weapon.tile_width
end

function player:spawn_laser(vessel_id)
	local weapon = constants.weapons.laser
	local vessel_x, vessel_y = self:get_vessel_snapshot(vessel_id)
	local laser = {
		vessel_id = vessel_id,
		x = vessel_x + weapon.spawn_offset_x,
		y = vessel_y + weapon.spawn_offset_y,
		left_x = vessel_x + weapon.spawn_offset_x,
		right_x = vessel_x + weapon.spawn_offset_x,
		length_expanded = 0,
		originator_last_x = vessel_x,
		originator_last_y = vessel_y,
	}
	self.lasers[#self.lasers + 1] = laser
	self.weapon_slots.laser[vessel_id] = self.weapon_slots.laser[vessel_id] + 1
	self:emit_event(
		'weapon_spawn',
		string.format(
			'weapon=laser|vessel=%d|active=%d|x=%.3f|y=%.3f',
			vessel_id,
			self.weapon_slots.laser[vessel_id],
			laser.x,
			laser.y
		)
	)
end

function player:spawn_missile(vessel_id)
	local weapon = constants.weapons.missile
	local vessel_x, vessel_y = self:get_vessel_snapshot(vessel_id)
	local missile = {
		vessel_id = vessel_id,
		x = vessel_x + weapon.spawn_offset_x,
		y = vessel_y + weapon.spawn_offset_y,
		state = missile_state_fall_from_vessel,
		sprite_imgid = constants.assets.missile1,
	}
	self.missiles[#self.missiles + 1] = missile
	self.weapon_slots.missile[vessel_id] = self.weapon_slots.missile[vessel_id] + 1
	self:emit_event(
		'weapon_spawn',
		string.format(
			'weapon=missile|vessel=%d|active=%d|x=%.3f|y=%.3f',
			vessel_id,
			self.weapon_slots.missile[vessel_id],
			missile.x,
			missile.y
		)
	)
end

function player:spawn_uplaser(vessel_id)
	local weapon = constants.weapons.uplaser
	local vessel_x, vessel_y = self:get_vessel_snapshot(vessel_id)
	local level = constants.loadout.uplaser_level
	local length_units = weapon.level1_length_units
	if level >= 2 then
		length_units = weapon.level2_initial_length_units
	end
	local aligned_x = math.floor((vessel_x + weapon.spawn_offset_x) / weapon.tile_width) * weapon.tile_width
	local initial_width = length_units * weapon.length_unit_px
	local uplaser = {
		vessel_id = vessel_id,
		x = aligned_x,
		center_x = aligned_x + (initial_width * 0.5),
		y = vessel_y + weapon.spawn_offset_y,
		level = level,
		gate_counter = weapon.level2_gate_frames,
		length_units = length_units,
		tile_count = 0,
		width = 0,
		height = 0,
	}
	self:refresh_uplaser_dimensions(uplaser)
	self.uplasers[#self.uplasers + 1] = uplaser
	self.weapon_slots.uplaser[vessel_id] = self.weapon_slots.uplaser[vessel_id] + 1
	self:emit_event(
		'weapon_spawn',
		string.format(
			'weapon=uplaser|vessel=%d|active=%d|x=%.3f|y=%.3f|level=%d|len=%d|tiles=%d|width=%d',
			vessel_id,
			self.weapon_slots.uplaser[vessel_id],
			uplaser.x,
			uplaser.y,
			uplaser.level,
			uplaser.length_units,
			uplaser.tile_count,
			uplaser.width
		)
	)
end

function player:emit_weapon_blocked(weapon, vessel_id, active, max_active)
	self:emit_event(
		'weapon_blocked',
		string.format('weapon=%s|vessel=%d|active=%d|max=%d', weapon, vessel_id, active, max_active)
	)
end

function player:fire_weapons()
	local vessel_count = self:get_vessel_count()
	for vessel_id = 1, vessel_count do
		local laser_max_active = constants.weapons.laser.max_active
		local laser_slots = self.weapon_slots.laser[vessel_id]
		if laser_slots < laser_max_active then
			self:spawn_laser(vessel_id)
		else
			self:emit_weapon_blocked('laser', vessel_id, laser_slots, laser_max_active)
		end

		local missile_slots = self.weapon_slots.missile[vessel_id]
		if missile_slots < constants.loadout.missile_level then
			self:spawn_missile(vessel_id)
		else
			self:emit_weapon_blocked('missile', vessel_id, missile_slots, constants.loadout.missile_level)
		end

		local uplaser_max_active = constants.weapons.uplaser.max_active
		local uplaser_slots = self.weapon_slots.uplaser[vessel_id]
		if uplaser_slots < uplaser_max_active then
			self:spawn_uplaser(vessel_id)
		else
			self:emit_weapon_blocked('uplaser', vessel_id, uplaser_slots, uplaser_max_active)
		end
	end
end

function player:despawn_laser(index, reason)
	local laser = self.lasers[index]
	swap_remove(self.lasers, index)
	self.weapon_slots.laser[laser.vessel_id] = self.weapon_slots.laser[laser.vessel_id] - 1
	self:emit_event(
		'weapon_despawn',
		string.format(
			'weapon=laser|vessel=%d|active=%d|x=%.3f|y=%.3f|reason=%s',
			laser.vessel_id,
			self.weapon_slots.laser[laser.vessel_id],
			laser.left_x,
			laser.y,
			reason
		)
	)
end

function player:despawn_missile(index, reason)
	local missile = self.missiles[index]
	swap_remove(self.missiles, index)
	self.weapon_slots.missile[missile.vessel_id] = self.weapon_slots.missile[missile.vessel_id] - 1
	self:emit_event(
		'weapon_despawn',
		string.format(
			'weapon=missile|vessel=%d|active=%d|x=%.3f|y=%.3f|reason=%s',
			missile.vessel_id,
			self.weapon_slots.missile[missile.vessel_id],
			missile.x,
			missile.y,
			reason
		)
	)
end

function player:despawn_uplaser(index, reason)
	local uplaser = self.uplasers[index]
	swap_remove(self.uplasers, index)
	self.weapon_slots.uplaser[uplaser.vessel_id] = self.weapon_slots.uplaser[uplaser.vessel_id] - 1
	self:emit_event(
		'weapon_despawn',
		string.format(
			'weapon=uplaser|vessel=%d|active=%d|x=%.3f|y=%.3f|reason=%s',
			uplaser.vessel_id,
			self.weapon_slots.uplaser[uplaser.vessel_id],
			uplaser.x,
			uplaser.y,
			reason
		)
	)
end

function player:update_lasers()
	local weapon = constants.weapons.laser
	local step = weapon.movement_speed
	local max_x = constants.machine.game_width
	local index = #self.lasers
	while index >= 1 do
		local laser = self.lasers[index]
		local wall_hit_x = -1
		local scan_x = laser.left_x
		local scan_end_x = laser.right_x + step

		while scan_x <= scan_end_x do
			if stage.is_solid_pixel(scan_x + weapon.tile_width, laser.y + 1) then
				wall_hit_x = scan_x
				laser.right_x = wall_hit_x
				break
			end
			scan_x = scan_x + weapon.tile_width
		end

		local origin_x, origin_y = self:get_vessel_snapshot(laser.vessel_id)
		if wall_hit_x < 0 and laser.right_x < max_x then
			laser.right_x = laser.right_x + step
			if laser.length_expanded < weapon.max_length_px then
				laser.right_x = laser.right_x + (origin_x - laser.originator_last_x)
			end
		end

		laser.length_expanded = laser.length_expanded + step
		if laser.length_expanded < weapon.max_length_px then
			laser.left_x = origin_x + weapon.spawn_offset_x
			laser.y = origin_y + weapon.spawn_offset_y
		else
			laser.left_x = laser.left_x + step
		end

		laser.originator_last_x = origin_x
		laser.originator_last_y = origin_y

		if laser.left_x >= laser.right_x then
			self:despawn_laser(index, 'exhausted')
		end
		index = index - 1
	end
end

function player:update_missiles()
	local weapon = constants.weapons.missile
	local step = weapon.movement_speed
	local max_x = constants.machine.game_width
	local max_y = constants.machine.game_height
	local index = #self.missiles
	while index >= 1 do
		local missile = self.missiles[index]
		local no_floor_below = (not stage.is_solid_pixel(missile.x, missile.y + 6))
			and (not stage.is_solid_pixel(missile.x + 8, missile.y + 6))

		if no_floor_below then
			missile.sprite_imgid = constants.assets.missile1
			missile.y = missile.y + step
			if stage.is_solid_pixel(missile.x + 8, missile.y) then
				missile.y = missile.y - (step * 0.5)
			end
			if missile.state == missile_state_fall_from_floor then
				missile.x = missile.x + (step * 0.5)
			end
		else
			missile.sprite_imgid = constants.assets.missile2
			missile.state = missile_state_fall_from_floor
			missile.x = missile.x + step
		end

		if stage.is_solid_pixel(missile.x + 8, missile.y) or missile.x >= max_x or missile.y >= max_y then
			self:despawn_missile(index, 'collision_or_bounds')
		end
		index = index - 1
	end
end

function player:update_uplasers()
	local weapon = constants.weapons.uplaser
	local index = #self.uplasers
	while index >= 1 do
		local uplaser = self.uplasers[index]
		local despawn_reason = nil
		local step = weapon.movement_speed

		uplaser.y = uplaser.y - step
		if uplaser.y < 0 then
			despawn_reason = 'screen_edge'
		end

		if despawn_reason == nil and uplaser.level >= 2 then
			uplaser.gate_counter = uplaser.gate_counter - 1
			if uplaser.gate_counter == 0 then
				-- Nemesis 2 level-2 uplaser cadence from AEB7/AEDB: every 4 ticks, extra rise and conditional growth.
				uplaser.gate_counter = weapon.level2_gate_frames
				local growth_units = weapon.level2_growth_units_at_top
				if uplaser.y ~= 0 then
					growth_units = weapon.level2_growth_units_per_gate
					uplaser.y = uplaser.y - weapon.level2_extra_rise_px
					if uplaser.y < 0 then
						despawn_reason = 'screen_edge'
					end
				end
				uplaser.length_units = uplaser.length_units + growth_units
				self:refresh_uplaser_dimensions(uplaser)
				uplaser.x = math.floor((uplaser.center_x - (uplaser.width * 0.5)) / weapon.tile_width) * weapon.tile_width
			end
		end

		if despawn_reason == nil then
			local impact_y = uplaser.y - 1
			local impact_x_left = uplaser.x
			local impact_x_right = uplaser.x + uplaser.width - 1
			if stage.is_solid_pixel(impact_x_left, impact_y) or stage.is_solid_pixel(impact_x_right, impact_y) then
				despawn_reason = 'stage_collision'
			end
		end

		if despawn_reason ~= nil then
			self:despawn_uplaser(index, despawn_reason)
		end
		index = index - 1
	end
end

function player:update_weapons()
	self:update_lasers()
	self:update_missiles()
	self:update_uplasers()
end

function player:tick()
	self:sample_input()
	self:update_position()
	self:update_options()
	self:tick_option_animation()

	if self.fire_pressed then
		self:fire_weapons()
	end

	self:update_weapons()
	self:emit_metric()
	self.frame = self.frame + 1
end

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:bind_visual()
					return '/flying'
				end,
			},
			flying = {},
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
			player_index = 1,
			frame = 0,
			x = constants.player.start_x,
			y = constants.player.start_y,
			last_dx = 0,
			last_dy = 0,
			last_speed = 0,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			fire_held = false,
			fire_pressed = false,
			speed_powerups = constants.loadout.speed_powerups,
			sprite_imgid = constants.assets.player_n,
			options = {},
			option_anim_index = 1,
			lasers = {},
			missiles = {},
			uplasers = {},
			weapon_slots = {
				laser = {},
				missile = {},
				uplaser = {},
			},
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = constants.ids.player_def,
	player_instance_id = constants.ids.player_instance,
	player_fsm_id = player_fsm_id,
}
