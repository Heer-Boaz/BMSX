local actioneffects<const> = require('cartlib/actioneffects')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local bool01<const> = require('cartlib/util/bool01')
local clamp<const> = require('cartlib/util/clamp')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local swap_remove<const> = require('cartlib/util/swap_remove')
require('constants')
local player_actioneffects<const> = require('player/actioneffects')
local player_state_module<const> = require('player/player_state')

local player<const> = {}
player.__index = player

local option_animation_timeline_id<const> = 'player_option_animation'
local missile_state_fall_from_vessel<const> = 'fall_from_vessel'
local missile_state_fall_from_floor<const> = 'fall_from_floor'
local powerup_slot<const> = player_state_module.powerup_slot
local powerup_slot_speed<const> = powerup_slot.speed
local powerup_slot_missile<const> = powerup_slot.missile
local powerup_slot_laser<const> = powerup_slot.laser
local powerup_slot_option<const> = powerup_slot.option
local player_sources<const> = {
	{
		neutral = { imgid = assets_player_n, source = image.resolve(assets_player_n) },
		up = { imgid = assets_player_u, source = image.resolve(assets_player_u) },
		down = { imgid = assets_player_d, source = image.resolve(assets_player_d) },
		options = {
			image.resolve(assets_option1),
			image.resolve(assets_option2),
			image.resolve(assets_option3),
			image.resolve(assets_option4),
		},
	},
	{
		neutral = { imgid = assets_player_2_n, source = image.resolve(assets_player_2_n) },
		up = { imgid = assets_player_2_u, source = image.resolve(assets_player_2_u) },
		down = { imgid = assets_player_2_d, source = image.resolve(assets_player_2_d) },
		options = {
			image.resolve(assets_player_2_option_1),
			image.resolve(assets_player_2_option_2),
			image.resolve(assets_player_2_option_3),
			image.resolve(assets_player_2_option_4),
		},
	},
}
local weapon_sources<const> = {
	bullet = image.resolve(assets_projectile),
	laser = image.resolve(assets_laser),
	missile_falling = image.resolve(assets_missile1),
	missile_flying = image.resolve(assets_missile2),
}

function player:emit_event(name, extra)
	if extra ~= nil then
		print(string.format('%s|kind=player|f=%d|name=%s|%s', telemetry_event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=player|f=%d|name=%s', telemetry_event_prefix, self.frame, name))
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
	if not telemetry_enabled then
		return
	end
	local l0x<const> , l0y<const> = self:get_projectile_snapshot(self.lasers, 1)
	local b0x<const> , b0y<const> = self:get_projectile_snapshot(self.bullets, 1)
	local m0x<const> , m0y<const> = self:get_projectile_snapshot(self.missiles, 1)
	local u0x<const> , u0y<const> = self:get_projectile_snapshot(self.uplasers, 1)
	print(string.format(
		'%s|kind=player|f=%d|x=%.3f|y=%.3f|dx=%.3f|dy=%.3f|sprite=%s|speed=%.3f|left=%d|right=%d|up=%d|down=%d|fire=%d|fire_press=%d|options=%d|bullet=%d|laser=%d|missile=%d|uplaser=%d|b0x=%.3f|b0y=%.3f|l0x=%.3f|l0y=%.3f|m0x=%.3f|m0y=%.3f|u0x=%.3f|u0y=%.3f',
		telemetry_metric_prefix,
		self.frame,
		self.x,
		self.y,
		self.last_dx,
		self.last_dy,
		self.sprite.imgid,
		self.last_speed,
		bool01(self.left_held),
		bool01(self.right_held),
		bool01(self.up_held),
		bool01(self.down_held),
		bool01(self.fire_held),
		bool01(self.fire_pressed),
		#self.options,
		#self.bullets,
		#self.lasers,
		#self.missiles,
		#self.uplasers,
		b0x,
		b0y,
		l0x,
		l0y,
		m0x,
		m0y,
		u0x,
		u0y
	))
end

local append_option<const> = function(self)
	local vessel_id<const> = #self.options + 2
	self.options[vessel_id - 1] = {
		vessel_id = vessel_id,
		x = self.x,
		y = self.y,
	}
	local weapon_slots<const> = self.weapon_slots
	weapon_slots.bullet[vessel_id] = 0
	weapon_slots.laser[vessel_id] = 0
	weapon_slots.missile[vessel_id] = 0
	weapon_slots.uplaser[vessel_id] = 0
end

local place_options_from_history<const> = function(self)
	local options<const> = self.options
	if #options == 0 then
		return
	end
	local history_index<const> = self.option_history_index
	local first_history_index = history_index - player_option_history_spacing
	if first_history_index <= 0 then
		first_history_index = first_history_index + player_option_history_count
	end
	local history_x<const> = self.option_history_x
	local history_y<const> = self.option_history_y
	local first<const> = options[1]
	first.x = history_x[first_history_index]
	first.y = history_y[first_history_index]
	if #options == 2 then
		local second<const> = options[2]
		second.x = history_x[history_index]
		second.y = history_y[history_index]
	end
end

function player:initialize_options()
	self.options = {}
	local history_x<const> = {}
	local history_y<const> = {}
	for index = 1, player_option_history_count do
		history_x[index] = self.x
		history_y[index] = self.y
	end
	self.option_history_x = history_x
	self.option_history_y = history_y
	self.option_history_index = 1
	for _ = 1, self.powerup_levels[powerup_slot_option] do
		append_option(self)
	end
	self.option_anim_index = 1
end

function player:initialize_weapon_slots()
	self.weapon_slots = {
		bullet = { 0 },
		laser = { 0 },
		missile = { 0 },
		uplaser = { 0 },
	}
end

function player:reset_runtime()
	self.frame = 0
	self.last_dx = 0
	self.last_dy = 0
	self.last_speed = 0
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.fire_held = false
	self.fire_pressed = false
	self.sprite = self.visual_sources.neutral
	self.bullets = {}
	self.lasers = {}
	self.missiles = {}
	self.uplasers = {}
	self:initialize_weapon_slots()
	self:initialize_options()
	if telemetry_enabled then
		self:emit_event(
			'player_reset',
			string.format(
				'x=%d|y=%d|speed=%d|options=%d|laser=%d|missile=%d|uplaser=%d',
				self.x,
				self.y,
				self.powerup_levels[powerup_slot_speed],
				self.powerup_levels[powerup_slot_option],
				self.powerup_levels[powerup_slot_laser],
				self.powerup_levels[powerup_slot_missile],
				self.player_state.uplaser_level
			)
		)
	end
end

function player:get_laser_visual_x(x, weapon)
	local tile_width<const> = weapon.tile_width
	return (x // tile_width) * tile_width
end

function player:get_laser_visual_y(y, weapon)
	local visual_step<const> = weapon.tile_width * 0.5
	return (y // visual_step) * visual_step
end

function player:draw_lasers(draw)
	for i = 1, #self.lasers do
		local laser<const> = self.lasers[i]
		local start_x<const> = self:get_laser_visual_x(laser.left_x, weapons_laser)
		local end_x = self:get_laser_visual_x(laser.right_x, weapons_laser)
		local visual_y<const> = self:get_laser_visual_y(laser.y, weapons_laser)
		if end_x <= start_x then
			end_x = start_x + weapons_laser.tile_width
		end
		local x = start_x
		while x < end_x do
		weapon_sources.laser:blit(draw, x, visual_y)
			x = x + weapons_laser.tile_width
		end
	end
end

function player:draw_bullets(draw)
	for i = 1, #self.bullets do
		local bullet<const> = self.bullets[i]
		weapon_sources.bullet:blit(draw, bullet.x, bullet.y)
	end
end

function player:draw_missiles(draw)
	for i = 1, #self.missiles do
		local missile<const> = self.missiles[i]
		missile.sprite:blit(draw, missile.x, missile.y)
	end
end

function player:draw_uplasers(draw)
	for i = 1, #self.uplasers do
		local uplaser<const> = self.uplasers[i]
		local base_x<const> = self:get_laser_visual_x(uplaser.x, weapons_uplaser)
		local visual_y<const> = self:get_laser_visual_y(uplaser.y, weapons_uplaser)
		for tile_index = 0, uplaser.tile_count - 1 do
			weapon_sources.laser:blit(draw, base_x + (tile_index * weapons_uplaser.tile_width), visual_y)
		end
	end
end

local draw_player_visual<const> = function(component, draw)
	local owner<const> = component.parent
	local option_source<const> = owner.visual_sources.options[owner.option_anim_index]
	for i = 1, #owner.options do
		local option<const> = owner.options[i]
		option_source:blit(draw, option.x, option.y)
	end
	owner.sprite.source:blit(draw, owner.x, owner.y)
	owner:draw_bullets(draw)
	owner:draw_lasers(draw)
	owner:draw_missiles(draw)
	owner:draw_uplasers(draw)
end

local collides_at<const> = function(self, x, y)
	for i = 1, #player_hitcheck_x do
		if self.stage:is_solid_pixel(x + player_hitcheck_x[i], y + player_hitcheck_y[i]) then
			return true
		end
	end
	return false
end

local try_move_x<const> = function(self, dx, max_x)
	if dx == 0 then
		return
	end
	local target_x<const> = clamp(self.x + dx, 0, max_x)
	if collides_at(self, target_x, self.y) then
		if telemetry_enabled then
			self:emit_event('collision_block_x', string.format('x=%.3f|y=%.3f|dx=%.3f', target_x, self.y, dx))
		end
		return
	end
	self.x = target_x
end

local try_move_y<const> = function(self, dy, max_y)
	if dy == 0 then
		return
	end
	local target_y<const> = clamp(self.y + dy, 0, max_y)
	if collides_at(self, self.x, target_y) then
		if telemetry_enabled then
			self:emit_event('collision_block_y', string.format('x=%.3f|y=%.3f|dy=%.3f', self.x, target_y, dy))
		end
		return
	end
	self.y = target_y
end

function player:update_position()
	local visual_sources<const> = self.visual_sources
	local max_x<const> = playfield_width - player_width
	local max_y<const> = playfield_height - player_height
	local previous_x<const> = self.x
	local previous_y<const> = self.y
	local movement_speed<const> = player_base_movement_speed
		+ player_movement_speed_increase * self.powerup_levels[powerup_slot_speed]
	self.last_speed = movement_speed

	if self.left_held then
		try_move_x(self, -movement_speed, max_x)
	end
	if self.right_held then
		try_move_x(self, movement_speed, max_x)
	end

	if self.up_held then
		try_move_y(self, -movement_speed, max_y)
		self.sprite = visual_sources.up
	elseif self.down_held then
		try_move_y(self, movement_speed, max_y)
		self.sprite = visual_sources.down
	else
		self.sprite = visual_sources.neutral
	end

	self.last_dx = self.x - previous_x
	self.last_dy = self.y - previous_y
end

function player:update_options()
	-- Nemesis 2 retains sixteen player positions in E450-E46F. The write
	-- cursor advances only when at least one input axis has a direction; the
	-- first and second options consume the samples eight and sixteen entries
	-- behind that cursor respectively.
	if self.left_held == self.right_held and self.up_held == self.down_held then
		return
	end
	local history_index = self.option_history_index
	self.option_history_x[history_index] = self.x
	self.option_history_y[history_index] = self.y
	history_index = history_index + 1
	if history_index > player_option_history_count then
		history_index = 1
	end
	self.option_history_index = history_index
	place_options_from_history(self)
end

function player:on_powerups_changed(_event, _source, slot)
	if slot == powerup_slot_option then
		append_option(self)
		place_options_from_history(self)
	end
end

function player:bind()
	self.events:on({
		event = player_state_module.events.powerups_changed,
		emitter = self.player_state.id,
		handler = player.on_powerups_changed,
	})
end

function player:refresh_uplaser_dimensions(uplaser)
	uplaser.width = uplaser.length_units * weapons_uplaser.length_unit_px
	uplaser.height = weapons_uplaser.tile_height
	uplaser.tile_count = uplaser.width / weapons_uplaser.tile_width
end

function player:spawn_bullet(vessel_id)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local bullet<const> = {
		vessel_id = vessel_id,
		x = vessel_x + player_fire_spawn_offset_x,
		y = vessel_y + player_fire_spawn_offset_y,
	}
	self.bullets[#self.bullets + 1] = bullet
	self.weapon_slots.bullet[vessel_id] = self.weapon_slots.bullet[vessel_id] + 1
	if telemetry_enabled then
		self:emit_event(
			'weapon_spawn',
			string.format(
				'weapon=bullet|vessel=%d|active=%d|x=%.3f|y=%.3f',
				vessel_id,
				self.weapon_slots.bullet[vessel_id],
				bullet.x,
				bullet.y
			)
		)
	end
end

function player:spawn_laser(vessel_id)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local laser<const> = {
		vessel_id = vessel_id,
		x = vessel_x + weapons_laser.spawn_offset_x,
		y = vessel_y + weapons_laser.spawn_offset_y,
		left_x = vessel_x + weapons_laser.spawn_offset_x,
		right_x = vessel_x + weapons_laser.spawn_offset_x,
		length_expanded = 0,
		originator_last_x = vessel_x,
		originator_last_y = vessel_y,
	}
	self.lasers[#self.lasers + 1] = laser
	self.weapon_slots.laser[vessel_id] = self.weapon_slots.laser[vessel_id] + 1
	if telemetry_enabled then
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
end

function player:spawn_missile(vessel_id)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local missile<const> = {
		vessel_id = vessel_id,
		x = vessel_x + weapons_missile_spawn_offset_x,
		y = vessel_y + weapons_missile_spawn_offset_y,
		state = missile_state_fall_from_vessel,
		sprite = weapon_sources.missile_falling,
	}
	self.missiles[#self.missiles + 1] = missile
	self.weapon_slots.missile[vessel_id] = self.weapon_slots.missile[vessel_id] + 1
	if telemetry_enabled then
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
end

function player:spawn_uplaser(vessel_id, level)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local length_units
	if level >= 2 then
		length_units = weapons_uplaser.level2_initial_length_units
	else
		length_units = weapons_uplaser.level1_length_units
	end
	local aligned_x<const> = ((vessel_x + weapons_uplaser.spawn_offset_x) // weapons_uplaser.tile_width) *
		weapons_uplaser.tile_width
	local initial_width<const> = length_units * weapons_uplaser.length_unit_px
	local uplaser<const> = {
		vessel_id = vessel_id,
		x = aligned_x,
		center_x = aligned_x + (initial_width * 0.5),
		y = vessel_y + weapons_uplaser.spawn_offset_y,
		level = level,
		gate_counter = weapons_uplaser.level2_gate_frames,
		length_units = length_units,
		tile_count = 0,
		width = 0,
		height = 0,
	}
	self:refresh_uplaser_dimensions(uplaser)
	self.uplasers[#self.uplasers + 1] = uplaser
	self.weapon_slots.uplaser[vessel_id] = self.weapon_slots.uplaser[vessel_id] + 1
	if telemetry_enabled then
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
end

function player:fire_weapon_salvo()
	local vessel_count<const> = #self.options + 1
	local powerup_levels<const> = self.powerup_levels
	local laser_equipped<const> = powerup_levels[powerup_slot_laser] > 0
	local missile_equipped<const> = powerup_levels[powerup_slot_missile] > 0
	local uplaser_level<const> = self.player_state.uplaser_level
	for vessel_id = 1, vessel_count do
		if missile_equipped then
			local missile_slots<const> = self.weapon_slots.missile[vessel_id]
			if missile_slots < weapons_missile_max_active then
				self:spawn_missile(vessel_id)
			elseif telemetry_enabled then
				self:emit_event(
					'weapon_blocked',
					string.format(
						'weapon=missile|vessel=%d|active=%d|max=%d',
						vessel_id,
						missile_slots,
						weapons_missile_max_active
					)
				)
			end
		end

		if laser_equipped then
			local laser_slots<const> = self.weapon_slots.laser[vessel_id]
			if laser_slots < weapons_laser.max_active then
				self:spawn_laser(vessel_id)
			elseif telemetry_enabled then
				self:emit_event(
					'weapon_blocked',
					string.format(
						'weapon=laser|vessel=%d|active=%d|max=%d',
						vessel_id,
						laser_slots,
						weapons_laser.max_active
					)
				)
			end
		else
			local bullet_slots<const> = self.weapon_slots.bullet[vessel_id]
			if bullet_slots < player_max_projectiles then
				self:spawn_bullet(vessel_id)
			elseif telemetry_enabled then
				self:emit_event(
					'weapon_blocked',
					string.format(
						'weapon=bullet|vessel=%d|active=%d|max=%d',
						vessel_id,
						bullet_slots,
						player_max_projectiles
					)
				)
			end
		end

		if uplaser_level > 0 then
			local uplaser_slots<const> = self.weapon_slots.uplaser[vessel_id]
			if uplaser_slots < weapons_uplaser.max_active then
				self:spawn_uplaser(vessel_id, uplaser_level)
			elseif telemetry_enabled then
				self:emit_event(
					'weapon_blocked',
					string.format(
						'weapon=uplaser|vessel=%d|active=%d|max=%d',
						vessel_id,
						uplaser_slots,
						weapons_uplaser.max_active
					)
				)
			end
		end
	end
end

function player:despawn_bullet(index, reason)
	local bullet<const> = self.bullets[index]
	swap_remove(self.bullets, index)
	self.weapon_slots.bullet[bullet.vessel_id] = self.weapon_slots.bullet[bullet.vessel_id] - 1
	if telemetry_enabled then
		self:emit_event(
			'weapon_despawn',
			string.format(
				'weapon=bullet|vessel=%d|active=%d|x=%.3f|y=%.3f|reason=%s',
				bullet.vessel_id,
				self.weapon_slots.bullet[bullet.vessel_id],
				bullet.x,
				bullet.y,
				reason
			)
		)
	end
end

function player:despawn_laser(index, reason)
	local laser<const> = self.lasers[index]
	swap_remove(self.lasers, index)
	self.weapon_slots.laser[laser.vessel_id] = self.weapon_slots.laser[laser.vessel_id] - 1
	if telemetry_enabled then
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
end

function player:despawn_missile(index, reason)
	local missile<const> = self.missiles[index]
	swap_remove(self.missiles, index)
	self.weapon_slots.missile[missile.vessel_id] = self.weapon_slots.missile[missile.vessel_id] - 1
	if telemetry_enabled then
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
end

function player:despawn_uplaser(index, reason)
	local uplaser<const> = self.uplasers[index]
	swap_remove(self.uplasers, index)
	self.weapon_slots.uplaser[uplaser.vessel_id] = self.weapon_slots.uplaser[uplaser.vessel_id] - 1
	if telemetry_enabled then
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
end

function player:update_bullets()
	local index = #self.bullets
	while index >= 1 do
		local bullet<const> = self.bullets[index]
		bullet.x = bullet.x + projectile_movement_speed
		if self.stage:is_solid_pixel(bullet.x + projectile_width + 2, bullet.y + projectile_height)
			or bullet.x >= playfield_width then
			self:despawn_bullet(index, 'collision_or_bounds')
		end
		index = index - 1
	end
end

function player:update_lasers()
	local index = #self.lasers
	while index >= 1 do
		local laser<const> = self.lasers[index]
		local wall_hit_x = -1
		local scan_x = laser.left_x
		local scan_end_x<const> = laser.right_x + weapons_laser.movement_speed

		while scan_x <= scan_end_x do
			if self.stage:is_solid_pixel(scan_x + weapons_laser.tile_width, laser.y + 1) then
				wall_hit_x = scan_x
				laser.right_x = wall_hit_x
				break
			end
			scan_x = scan_x + weapons_laser.tile_width
		end

		local origin_x<const> , origin_y<const> = self:get_vessel_snapshot(laser.vessel_id)
		if wall_hit_x < 0 and laser.right_x < playfield_width then
			laser.right_x = laser.right_x + weapons_laser.movement_speed
			if laser.length_expanded < weapons_laser.max_length_px then
				laser.right_x = laser.right_x + (origin_x - laser.originator_last_x)
			end
		end

		laser.length_expanded = laser.length_expanded + weapons_laser.movement_speed
		if laser.length_expanded < weapons_laser.max_length_px then
			laser.left_x = origin_x + weapons_laser.spawn_offset_x
			laser.y = origin_y + weapons_laser.spawn_offset_y
		else
			laser.left_x = laser.left_x + weapons_laser.movement_speed
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
			missile.sprite = weapon_sources.missile_falling
			missile.y = missile.y + weapons_missile_movement_speed
			if self.stage:is_solid_pixel(missile.x + 8, missile.y) then
				missile.y = missile.y - (weapons_missile_movement_speed * 0.5)
			end
			if missile.state == missile_state_fall_from_floor then
				missile.x = missile.x + (weapons_missile_movement_speed * 0.5)
			end
		else
			missile.sprite = weapon_sources.missile_flying
			missile.state = missile_state_fall_from_floor
			missile.x = missile.x + weapons_missile_movement_speed
		end

		if self.stage:is_solid_pixel(missile.x + 8, missile.y)
			or missile.x >= playfield_width
			or missile.y >= playfield_height then
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

		uplaser.y = uplaser.y - weapons_uplaser.movement_speed
		if uplaser.y < 0 then
			despawn_reason = 'screen_edge'
		end

		if despawn_reason == nil and uplaser.level >= 2 then
			uplaser.gate_counter = uplaser.gate_counter - 1
			if uplaser.gate_counter == 0 then
				uplaser.gate_counter = weapons_uplaser.level2_gate_frames
				local growth_units
				if uplaser.y ~= 0 then
					growth_units = weapons_uplaser.level2_growth_units_per_gate
					uplaser.y = uplaser.y - weapons_uplaser.level2_extra_rise_px
					if uplaser.y < 0 then
						despawn_reason = 'screen_edge'
					end
				else
					growth_units = weapons_uplaser.level2_growth_units_at_top
				end
				uplaser.length_units = uplaser.length_units + growth_units
				self:refresh_uplaser_dimensions(uplaser)
				uplaser.x = ((uplaser.center_x - (uplaser.width * 0.5)) // weapons_uplaser.tile_width) *
					weapons_uplaser.tile_width
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
	self:update_bullets()
	self:update_lasers()
	self:update_missiles()
	self:update_uplasers()
end

function player:update_runtime()
	self:update_position()
	self:update_options()
	if self.fire_pressed then
		self.actioneffects:try_trigger(player_actioneffects.effect_ids.fire_salvo)
	end
	self:update_weapons()
	self:emit_metric()
	self.fire_pressed = false
	self.frame = self.frame + 1
end

function player:ctor()
	self.visual_sources = player_sources[self.player_index]
	self.powerup_levels = self.player_state.powerup_levels
	local visual<const> = self:get_component(custom_visual_component)
	visual:set_draw_function(draw_player_visual)
end

local define_player_fsm<const> = function()
	fsm_library.register(ids_player_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/flying'
				end,
			},
			flying = {
				update = player.update_runtime,
				input_event_handlers = {
					{
						pattern = 'left[jp]',
						go = function(self)
							self.left_held = true
						end,
					},
					{
						pattern = 'left[jr]',
						go = function(self)
							self.left_held = false
						end,
					},
					{
						pattern = 'right[jp]',
						go = function(self)
							self.right_held = true
						end,
					},
					{
						pattern = 'right[jr]',
						go = function(self)
							self.right_held = false
						end,
					},
					{
						pattern = 'up[jp]',
						go = function(self)
							self.up_held = true
						end,
					},
					{
						pattern = 'up[jr]',
						go = function(self)
							self.up_held = false
						end,
					},
					{
						pattern = 'down[jp]',
						go = function(self)
							self.down_held = true
						end,
					},
					{
						pattern = 'down[jr]',
						go = function(self)
							self.down_held = false
						end,
					},
					{
						pattern = 'fire[jp]',
						go = function(self)
							self.fire_held = true
							self.fire_pressed = true
						end,
					},
					{
						pattern = 'fire[jr] && fire[r]',
						go = function(self)
							self.fire_held = false
						end,
					},
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
							frame_duration = 1,
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
	prefab.define({
		def_id = ids_player_def,
		class = player,
		components = {
			custom_visual_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_player_fsm }),
			actioneffect_component.factory({ player_actioneffects.effect_ids.fire_salvo }),
		},
		defaults = {
			player_index = 1,
			z = 70,
			frame = 0,
			last_dx = 0,
			last_dy = 0,
			last_speed = 0,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			fire_held = false,
			fire_pressed = false,
			option_anim_index = 1,
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = ids_player_def,
	player_fsm_id = ids_player_fsm,
}
