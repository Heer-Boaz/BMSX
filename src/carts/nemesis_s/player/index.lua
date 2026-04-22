local constants<const> = require('constants')
local player_abilities<const> = require('player/abilities')

local player<const> = {}
player.__index = player

local option_animation_timeline_id<const> = 'player_option_animation'
local missile_state_fall_from_vessel<const> = 'fall_from_vessel'
local missile_state_fall_from_floor<const> = 'fall_from_floor'

function player:emit_event(name, extra)
	if not constants.telemetry.enabled then
		return
	end
	if extra ~= nil then
		print(string.format('%s|kind=player|f=%d|name=%s|%s', constants.telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=player|f=%d|name=%s', constants.telemetry.event_prefix, self.frame, name))
end

function player:get_vessel_snapshot(vessel_id)
	if vessel_id == 1 then
		return self.x, self.y
	end
	local option<const> = self.options[vessel_id - 1]
	return option.x, option.y
end

function player:get_projectile_snapshot(list, index)
	local projectile<const> = list[index]
	if projectile == nil then
		return -1, -1
	end
	return projectile.x, projectile.y
end

function player:emit_metric()
	if not constants.telemetry.enabled then
		return
	end
	local l0x<const> , l0y<const> = self:get_projectile_snapshot(self.lasers, 1)
	local m0x<const> , m0y<const> = self:get_projectile_snapshot(self.missiles, 1)
	local u0x<const> , u0y<const> = self:get_projectile_snapshot(self.uplasers, 1)
	print(string.format(
		'%s|kind=player|f=%d|x=%.3f|y=%.3f|dx=%.3f|dy=%.3f|sprite=%s|speed=%.3f|left=%d|right=%d|up=%d|down=%d|fire=%d|fire_press=%d|options=%d|laser=%d|missile=%d|uplaser=%d|l0x=%.3f|l0y=%.3f|m0x=%.3f|m0y=%.3f|u0x=%.3f|u0y=%.3f',
		constants.telemetry.metric_prefix,
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
	self.options = {}
	for option_index = 1, constants.loadout.option_count do
		local option<const> = {
			vessel_id = option_index + 1,
			target_vessel_id = option_index,
			x = self.x,
			y = self.y,
			target_prev_x = self.x,
			target_prev_y = self.y,
			follow_dx = {},
			follow_dy = {},
		}
		for i = 1, constants.player.option_follow_delay do
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
	local vessel_count<const> = self:get_vessel_count()
	for vessel_id = 1, vessel_count do
		self.weapon_slots.laser[vessel_id] = 0
		self.weapon_slots.missile[vessel_id] = 0
		self.weapon_slots.uplaser[vessel_id] = 0
	end
end

function player:reset_runtime()
	self.stage = subsystem(constants.ids.stage_instance)
	self.frame = 0
	self.x = constants.player.start_x
	self.y = constants.player.start_y
	self.last_dx = 0
	self.last_dy = 0
	self.edge_push_dx = 0
	self.edge_push_dy = 0
	self.last_speed = 0
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.fire_sources = 0
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
	local tile_width<const> = weapon.tile_width
	return (x // tile_width) * tile_width
end

function player:get_laser_visual_y(y, weapon)
	local visual_step<const> = weapon.tile_width * 0.5
	return (y // visual_step) * visual_step
end

function player:draw_lasers()
	local laser_handle<const> = assets.img[constants.assets.laser].handle
	for i = 1, #self.lasers do
		local laser<const> = self.lasers[i]
		local start_x<const> = self:get_laser_visual_x(laser.left_x, constants.weapons.laser)
		local end_x = self:get_laser_visual_x(laser.right_x, constants.weapons.laser)
		local visual_y<const> = self:get_laser_visual_y(laser.y, constants.weapons.laser)
		if end_x <= start_x then
			end_x = start_x + constants.weapons.laser.tile_width
		end
		local x = start_x
		while x < end_x do
			memwrite(
				vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
				sys_vdp_cmd_blit,
					13,
				0,
				laser_handle,
				x,
				visual_y,
				122,
				sys_vdp_layer_world,
				1,
				1,
				0,
				1,
				1,
				1,
				1,
				0
			)
			x = x + constants.weapons.laser.tile_width
		end
	end
end

function player:draw_missiles()
	for i = 1, #self.missiles do
		local missile<const> = self.missiles[i]
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
			sys_vdp_cmd_blit,
				13,
			0,
			assets.img[missile.sprite_imgid].handle,
			missile.x,
			missile.y,
			122,
			sys_vdp_layer_world,
			1,
			1,
			0,
			1,
			1,
			1,
			1,
			0
		)
	end
end

function player:draw_uplasers()
	local laser_handle<const> = assets.img[constants.assets.laser].handle
	for i = 1, #self.uplasers do
		local uplaser<const> = self.uplasers[i]
		local base_x<const> = self:get_laser_visual_x(uplaser.x, constants.weapons.uplaser)
		local visual_y<const> = self:get_laser_visual_y(uplaser.y, constants.weapons.uplaser)
		for tile_index = 0, uplaser.tile_count - 1 do
			memwrite(
				vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
				sys_vdp_cmd_blit,
					13,
				0,
				laser_handle,
				base_x + (tile_index * constants.weapons.uplaser.tile_width),
				visual_y,
				122,
				sys_vdp_layer_world,
				1,
				1,
				0,
				1,
				1,
				1,
				1,
				0
			)
		end
	end
end

function player:draw_visual()
	local option_imgid<const> = self:get_option_imgid()
	local option_handle<const> = assets.img[option_imgid].handle
	for i = 1, #self.options do
		local option<const> = self.options[i]
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
			sys_vdp_cmd_blit,
				13,
			0,
			option_handle,
			option.x,
			option.y,
			119,
			sys_vdp_layer_world,
			1,
			1,
			0,
			1,
			1,
			1,
			1,
			0
		)
	end
	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
		sys_vdp_cmd_blit,
			13,
		0,
		assets.img[self.sprite_imgid].handle,
		self.x,
		self.y,
		120,
		sys_vdp_layer_world,
		1,
		1,
		0,
		1,
		1,
		1,
		1,
		0
	)
	self:draw_lasers()
	self:draw_missiles()
	self:draw_uplasers()
end

function player:on_fire_input_pressed()
	local fire_was_held<const> = self.fire_sources > 0
	self.fire_sources = self.fire_sources + 1
	self.fire_held = true
	if fire_was_held then
		return
	end
	self.fire_pressed = true
end

function player:on_fire_input_released()
	self.fire_sources = self.fire_sources - 1
	self.fire_held = self.fire_sources > 0
end

function player:get_movement_speed()
	return constants.player.base_movement_speed + constants.player.movement_speed_increase * self.speed_powerups
end

function player:update_position()
	local max_x<const> = constants.machine.game_width - constants.player.width
	local max_y<const> = constants.machine.game_height - constants.player.height
	local previous_x<const> = self.x
	local previous_y<const> = self.y

	local collides_at<const> = function(x, y)
		for i = 1, #constants.player.hitcheck_x do
			if self.stage:is_solid_pixel(x + constants.player.hitcheck_x[i], y + constants.player.hitcheck_y[i]) then
				return true
			end
		end
		return false
	end

	local try_move_x<const> = function(dx)
		if dx == 0 then
			return
		end
		local raw_target_x<const> = self.x + dx
		local target_x<const> = clamp_int(raw_target_x, 0, max_x)
		if target_x ~= raw_target_x then
			self.edge_push_dx = dx
		end
		if collides_at(target_x, self.y) then
			self:emit_event('collision_block_x', string.format('x=%.3f|y=%.3f|dx=%.3f', target_x, self.y, dx))
			return
		end
		self.x = target_x
	end

	local try_move_y<const> = function(dy)
		if dy == 0 then
			return
		end
		local raw_target_y<const> = self.y + dy
		local target_y<const> = clamp_int(raw_target_y, 0, max_y)
		if target_y ~= raw_target_y then
			self.edge_push_dy = dy
		end
		if collides_at(self.x, target_y) then
			self:emit_event('collision_block_y', string.format('x=%.3f|y=%.3f|dy=%.3f', self.x, target_y, dy))
			return
		end
		self.y = target_y
	end

	self.edge_push_dx = 0
	self.edge_push_dy = 0

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
	if self.last_dx == 0 and self.last_dy == 0 and self.edge_push_dx == 0 and self.edge_push_dy == 0 then
		return
	end

	for i = 1, #self.options do
		local option<const> = self.options[i]
		local target_x<const> , target_y<const> = self:get_vessel_snapshot(option.target_vessel_id)
		local target_dx = target_x - option.target_prev_x
		local target_dy = target_y - option.target_prev_y
		if option.target_vessel_id == 1 then
			if target_dx == 0 and self.edge_push_dx ~= 0 then
				target_dx = self.edge_push_dx
			end
			if target_dy == 0 and self.edge_push_dy ~= 0 then
				target_dy = self.edge_push_dy
			end
		end
		option.x = option.x + option.follow_dx[1]
		option.y = option.y + option.follow_dy[1]

		for queue_index = 1, constants.player.option_follow_delay - 1 do
			option.follow_dx[queue_index] = option.follow_dx[queue_index + 1]
			option.follow_dy[queue_index] = option.follow_dy[queue_index + 1]
		end
		option.follow_dx[constants.player.option_follow_delay] = target_dx
		option.follow_dy[constants.player.option_follow_delay] = target_dy
		option.target_prev_x = target_x
		option.target_prev_y = target_y
	end
end

function player:refresh_uplaser_dimensions(uplaser)
	uplaser.width = uplaser.length_units * constants.weapons.uplaser.length_unit_px
	uplaser.height = constants.weapons.uplaser.tile_height
	uplaser.tile_count = uplaser.width / constants.weapons.uplaser.tile_width
end

function player:spawn_laser(vessel_id)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local laser<const> = {
		vessel_id = vessel_id,
		x = vessel_x + constants.weapons.laser.spawn_offset_x,
		y = vessel_y + constants.weapons.laser.spawn_offset_y,
		left_x = vessel_x + constants.weapons.laser.spawn_offset_x,
		right_x = vessel_x + constants.weapons.laser.spawn_offset_x,
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
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local missile<const> = {
		vessel_id = vessel_id,
		x = vessel_x + constants.weapons.missile.spawn_offset_x,
		y = vessel_y + constants.weapons.missile.spawn_offset_y,
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
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local length_units
	if constants.loadout.uplaser_level >= 2 then
		length_units = constants.weapons.uplaser.level2_initial_length_units
	else
		length_units = constants.weapons.uplaser.level1_length_units
	end
	local aligned_x<const> = ((vessel_x + constants.weapons.uplaser.spawn_offset_x) // constants.weapons.uplaser.tile_width)
		* constants.weapons.uplaser.tile_width
	local initial_width<const> = length_units * constants.weapons.uplaser.length_unit_px
	local uplaser<const> = {
		vessel_id = vessel_id,
		x = aligned_x,
		center_x = aligned_x + (initial_width * 0.5),
		y = vessel_y + constants.weapons.uplaser.spawn_offset_y,
		level = constants.loadout.uplaser_level,
		gate_counter = constants.weapons.uplaser.level2_gate_frames,
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

function player:fire_weapon_salvo()
	local vessel_count<const> = self:get_vessel_count()
	for vessel_id = 1, vessel_count do
		local laser_slots<const> = self.weapon_slots.laser[vessel_id]
		if laser_slots < constants.weapons.laser.max_active then
			self:spawn_laser(vessel_id)
		else
			self:emit_event(
				'weapon_blocked',
				string.format('weapon=laser|vessel=%d|active=%d|max=%d', vessel_id, laser_slots, constants.weapons.laser.max_active)
			)
		end

		local missile_slots<const> = self.weapon_slots.missile[vessel_id]
		if missile_slots < constants.weapons.missile.max_active then
			self:spawn_missile(vessel_id)
		else
			self:emit_event(
				'weapon_blocked',
				string.format(
					'weapon=missile|vessel=%d|active=%d|max=%d',
					vessel_id,
					missile_slots,
					constants.weapons.missile.max_active
				)
			)
		end

		local uplaser_slots<const> = self.weapon_slots.uplaser[vessel_id]
		if uplaser_slots < constants.weapons.uplaser.max_active then
			self:spawn_uplaser(vessel_id)
		else
			self:emit_event(
				'weapon_blocked',
				string.format(
					'weapon=uplaser|vessel=%d|active=%d|max=%d',
					vessel_id,
					uplaser_slots,
					constants.weapons.uplaser.max_active
				)
			)
		end
	end
end

function player:despawn_laser(index, reason)
	local laser<const> = self.lasers[index]
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
	local missile<const> = self.missiles[index]
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
	local uplaser<const> = self.uplasers[index]
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
	local index = #self.lasers
	while index >= 1 do
		local laser<const> = self.lasers[index]
		local wall_hit_x = -1
		local scan_x = laser.left_x
		local scan_end_x<const> = laser.right_x + constants.weapons.laser.movement_speed

		while scan_x <= scan_end_x do
			if self.stage:is_solid_pixel(scan_x + constants.weapons.laser.tile_width, laser.y + 1) then
				wall_hit_x = scan_x
				laser.right_x = wall_hit_x
				break
			end
			scan_x = scan_x + constants.weapons.laser.tile_width
		end

		local origin_x<const> , origin_y<const> = self:get_vessel_snapshot(laser.vessel_id)
		if wall_hit_x < 0 and laser.right_x < constants.machine.game_width then
			laser.right_x = laser.right_x + constants.weapons.laser.movement_speed
			if laser.length_expanded < constants.weapons.laser.max_length_px then
				laser.right_x = laser.right_x + (origin_x - laser.originator_last_x)
			end
		end

		laser.length_expanded = laser.length_expanded + constants.weapons.laser.movement_speed
		if laser.length_expanded < constants.weapons.laser.max_length_px then
			laser.left_x = origin_x + constants.weapons.laser.spawn_offset_x
			laser.y = origin_y + constants.weapons.laser.spawn_offset_y
		else
			laser.left_x = laser.left_x + constants.weapons.laser.movement_speed
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
	local index = #self.missiles
	while index >= 1 do
		local missile<const> = self.missiles[index]
		local no_floor_below<const> = (not self.stage:is_solid_pixel(missile.x, missile.y + 6))
			and (not self.stage:is_solid_pixel(missile.x + 8, missile.y + 6))

		if no_floor_below then
			missile.sprite_imgid = constants.assets.missile1
			missile.y = missile.y + constants.weapons.missile.movement_speed
			if self.stage:is_solid_pixel(missile.x + 8, missile.y) then
				missile.y = missile.y - (constants.weapons.missile.movement_speed * 0.5)
			end
			if missile.state == missile_state_fall_from_floor then
				missile.x = missile.x + (constants.weapons.missile.movement_speed * 0.5)
			end
		else
			missile.sprite_imgid = constants.assets.missile2
			missile.state = missile_state_fall_from_floor
			missile.x = missile.x + constants.weapons.missile.movement_speed
		end

		if self.stage:is_solid_pixel(missile.x + 8, missile.y)
			or missile.x >= constants.machine.game_width
			or missile.y >= constants.machine.game_height then
			self:despawn_missile(index, 'collision_or_bounds')
		end
		index = index - 1
	end
end

function player:update_uplasers()
	local index = #self.uplasers
	while index >= 1 do
		local uplaser<const> = self.uplasers[index]
		local despawn_reason = nil

		uplaser.y = uplaser.y - constants.weapons.uplaser.movement_speed
		if uplaser.y < 0 then
			despawn_reason = 'screen_edge'
		end

		if despawn_reason == nil and uplaser.level >= 2 then
			uplaser.gate_counter = uplaser.gate_counter - 1
			if uplaser.gate_counter == 0 then
				uplaser.gate_counter = constants.weapons.uplaser.level2_gate_frames
				local growth_units
				if uplaser.y ~= 0 then
					growth_units = constants.weapons.uplaser.level2_growth_units_per_gate
					uplaser.y = uplaser.y - constants.weapons.uplaser.level2_extra_rise_px
					if uplaser.y < 0 then
						despawn_reason = 'screen_edge'
					end
				else
					growth_units = constants.weapons.uplaser.level2_growth_units_at_top
				end
				uplaser.length_units = uplaser.length_units + growth_units
				self:refresh_uplaser_dimensions(uplaser)
				uplaser.x = ((uplaser.center_x - (uplaser.width * 0.5)) // constants.weapons.uplaser.tile_width)
					* constants.weapons.uplaser.tile_width
			end
		end

		if despawn_reason == nil then
			local impact_y<const> = uplaser.y - 1
			local impact_x_left<const> = uplaser.x
			local impact_x_right<const> = uplaser.x + uplaser.width - 1
			if self.stage:is_solid_pixel(impact_x_left, impact_y) or self.stage:is_solid_pixel(impact_x_right, impact_y) then
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

function player:update_runtime()
	self:update_position()
	self:update_options()
	if self.fire_pressed then
		self.actioneffects:trigger(player_abilities.effect_ids.fire_salvo)
	end
	self:update_weapons()
	self:emit_metric()
	self.fire_pressed = false
	self.frame = self.frame + 1
end

function player:ctor()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_visual()
	end
end

local define_player_fsm<const> = function()
	define_fsm(constants.ids.player_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/flying'
				end,
				},
				flying = {
					update = function(self)
						self:update_runtime()
					end,
					input_event_handlers = {
					['left[jp]'] = function(self)
						self.left_held = true
					end,
					['left[jr]'] = function(self)
						self.left_held = false
					end,
					['right[jp]'] = function(self)
						self.right_held = true
					end,
					['right[jr]'] = function(self)
						self.right_held = false
					end,
					['up[jp]'] = function(self)
						self.up_held = true
					end,
					['up[jr]'] = function(self)
						self.up_held = false
					end,
					['down[jp]'] = function(self)
						self.down_held = true
					end,
					['down[jr]'] = function(self)
						self.down_held = false
					end,
					['x[jp]'] = function(self)
						self:on_fire_input_pressed()
					end,
					['x[jr]'] = function(self)
						self:on_fire_input_released()
					end,
					['a[jp]'] = function(self)
						self:on_fire_input_pressed()
					end,
					['a[jr]'] = function(self)
						self:on_fire_input_released()
					end,
					['b[jp]'] = function(self)
						self:on_fire_input_pressed()
					end,
					['b[jr]'] = function(self)
						self:on_fire_input_released()
					end,
				},
				timelines = {
					[option_animation_timeline_id] = {
						def = {
							frames = {
								{ option_anim_index = 1 },
								{ option_anim_index = 2 },
								{ option_anim_index = 3 },
								{ option_anim_index = 4 },
							},
							ticks_per_frame = 1,
							playback_mode = 'loop',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
			},
		},
	})
end

local register_player_definition<const> = function()
	define_prefab({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { constants.ids.player_fsm },
		components = { 'customvisualcomponent' },
		effects = { player_abilities.effect_ids.fire_salvo },
		defaults = {
			player_index = 1,
			frame = 0,
			x = constants.player.start_x,
			y = constants.player.start_y,
			last_dx = 0,
			last_dy = 0,
			edge_push_dx = 0,
			edge_push_dy = 0,
			last_speed = 0,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			fire_sources = 0,
			fire_held = false,
			fire_pressed = false,
			speed_powerups = constants.loadout.speed_powerups,
			sprite_imgid = constants.assets.player_n,
			option_anim_index = 1,
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
