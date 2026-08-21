local actioneffects<const> = require('cartlib/actioneffects')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local bool01<const> = require('cartlib/util/bool01')
local clamp<const> = require('cartlib/util/clamp')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local input<const> = require('cartlib/input/input')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local sprite_component<const> = require('cartlib/component/sprite_component')
local registry<const> = require('cartlib/registry')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')
local player_actioneffects<const> = require('player/actioneffects')
local player_state_module<const> = require('player/player_state')

local player<const> = {}
player.__index = player
local active_state_tag<const> = 'nemesis_s.player.active'

local option_animation_timeline_id<const> = 'player_option_animation'
local player_death_timeline_id<const> = 'player_death'
local player_respawn_timeline_id<const> = 'player_respawn'
local player_body_collider_id<const> = 0
local player_vessel_visual_id<const> = 'vessel'
local player_projectile_visual_id<const> = 'projectiles'
local player_death_visual_id<const> = 'death'
local force_field_animation_strong<const> = 'strong'
local force_field_animation_weak<const> = 'weak'
local player_hit_area<const> = {
	left = 2,
	top = 2,
	right = 14,
	bottom = 8,
}
local new_player_collider<const> = collider_2d_component.factory({
	id_local = player_body_collider_id,
	layer = collision_player_layer,
	mask = collision_player_mask,
	local_area = player_hit_area,
})
local new_death_visual<const> = sprite_component.factory({
	id_local = player_death_visual_id,
	imgid = assets_player_death_3,
	offset_x = -8,
	offset_z = 1,
	enabled = false,
})
local new_force_field_visual<const> = sprite_animation_component.factory({
	animation = force_field_animation_strong,
	animations = {
		strong = {
			frames = { assets_force_field_1, assets_force_field_2 },
			frame_duration_ms = player_force_field_animation_frame_ms,
			loop = true,
		},
		weak = {
			frames = { assets_force_field_3, assets_force_field_4 },
			frame_duration_ms = player_force_field_animation_frame_ms,
			loop = true,
		},
	},
	offset_y = player_force_field_offset_y,
	offset_z = -1,
	enabled = false,
})
local player_death_frames<const> = timeline.build_frame_sequence({
	{ value = assets_player_death_3, hold = 3 },
	{ value = assets_player_death_1, hold = 5 },
	{ value = assets_player_death_2, hold = 4 },
	{ value = assets_player_death_3, hold = 4 },
})
local player_respawn_frames<const> = {
	{ visible = true },
	{ visible = false },
}
-- Values are the retained E470-E4F0 projectile type bytes dispatched by the
-- original ROM's table at ABC2. Zero is the free-slot representation.
local projectile_type_none<const> = 0
local projectile_type_bullet<const> = 1
local projectile_type_missile<const> = 4
local projectile_type_laser<const> = 7
local projectile_type_uplaser_level_1<const> = 10
local projectile_type_uplaser_level_2<const> = 12
local uplaser_projectile_type_by_level<const> = {
	projectile_type_uplaser_level_1,
	projectile_type_uplaser_level_2,
}
local laser_state_expand<const> = 0
local laser_state_travel<const> = 1
local laser_state_retract<const> = 2
local powerup_slot<const> = player_state_module.powerup_slot
local powerup_slot_speed<const> = powerup_slot.speed
local powerup_slot_missile<const> = powerup_slot.missile
local powerup_slot_laser<const> = powerup_slot.laser
local powerup_slot_option<const> = powerup_slot.option
local powerup_slot_shield<const> = powerup_slot.shield
local player_sources<const> = {
	{
		neutral = { imgid = assets_player_n, source = image.resolve(assets_player_n) },
		neutral_shield = {
			imgid = assets_player_n_shield,
			source = image.resolve(assets_player_n_shield),
		},
		up = { imgid = assets_player_u, source = image.resolve(assets_player_u) },
		down = { imgid = assets_player_d, source = image.resolve(assets_player_d) },
		down_shield = {
			imgid = assets_player_d_shield,
			source = image.resolve(assets_player_d_shield),
		},
		options = {
			image.resolve(assets_option1),
			image.resolve(assets_option2),
			image.resolve(assets_option3),
			image.resolve(assets_option4),
		},
	},
	{
		neutral = { imgid = assets_player_2_n, source = image.resolve(assets_player_2_n) },
		neutral_shield = {
			imgid = assets_player_n_shield_p2,
			source = image.resolve(assets_player_n_shield_p2),
		},
		up = { imgid = assets_player_2_u, source = image.resolve(assets_player_2_u) },
		down = { imgid = assets_player_2_d, source = image.resolve(assets_player_2_d) },
		down_shield = {
			imgid = assets_player_d_shield_p2,
			source = image.resolve(assets_player_d_shield_p2),
		},
		options = {
			image.resolve(assets_player_2_option_1),
			image.resolve(assets_player_2_option_2),
			image.resolve(assets_player_2_option_3),
			image.resolve(assets_player_2_option_4),
		},
	},
}
local no_powerup_slot<const> = player_state_module.no_powerup_slot
local weapon_sources<const> = {
	bullet = image.resolve(assets_projectile),
	laser = image.resolve(assets_laser),
	missile_falling = image.resolve(assets_missile1),
	missile_flying = image.resolve(assets_missile2),
	uplaser = image.resolve(assets_uplaser),
}

local set_projectile_collider<const> = function(owner, projectile, width, height)
	local collider<const> = projectile.collider
	collider.shape_offset_x = projectile.x - owner.x
	collider.shape_offset_y = projectile.y - owner.y
	local area<const> = collider.local_area
	area.right = width
	area.bottom = height
end

local attach_projectile_collider<const> = function(owner, projectile, local_id)
	local collider<const> = collider_2d_component.new({
		parent = owner,
		id_local = local_id,
		enabled = false,
		layer = collision_player_projectile_layer,
		mask = collision_player_projectile_mask,
		local_area = { left = 0, top = 0, right = 0, bottom = 0 },
	})
	projectile.collider = collider
	owner.projectiles_by_collider_local_id[local_id] = projectile
	owner:add_component(collider)
end

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

local get_projectile_metrics<const> = function(projectiles, projectile_type, alternate_type)
	local count = 0
	local x = -1
	local y = -1
	for vessel_id = 1, player_vessel_capacity do
		local projectile<const> = projectiles[vessel_id]
		if projectile.type == projectile_type or projectile.type == alternate_type then
			count = count + 1
			if x < 0 then
				x = projectile.x
				y = projectile.y
			end
		end
	end
	return count, x, y
end

function player:emit_metric()
	if not telemetry_enabled then
		return
	end
	local bullet_count<const> , b0x<const> , b0y<const> =
		get_projectile_metrics(self.primary_projectiles, projectile_type_bullet)
	local laser_count<const> , l0x<const> , l0y<const> =
		get_projectile_metrics(self.primary_projectiles, projectile_type_laser)
	local missile_count<const> , m0x<const> , m0y<const> =
		get_projectile_metrics(self.missile_projectiles, projectile_type_missile)
	local uplaser_count<const> , u0x<const> , u0y<const> =
		get_projectile_metrics(
			self.secondary_projectiles,
			projectile_type_uplaser_level_1,
			projectile_type_uplaser_level_2
		)
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
		bullet_count,
		laser_count,
		missile_count,
		uplaser_count,
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
	self:deactivate_force_field()
	self.sprite = self.visual_sources.neutral
	for vessel_id = 1, player_vessel_capacity do
		local primary<const> = self.primary_projectiles[vessel_id]
		local missile<const> = self.missile_projectiles[vessel_id]
		local secondary<const> = self.secondary_projectiles[vessel_id]
		primary.type = projectile_type_none
		missile.type = projectile_type_none
		secondary.type = projectile_type_none
		primary.collider:set_enabled(false)
		missile.collider:set_enabled(false)
		secondary.collider:set_enabled(false)
	end
	self:initialize_options()
	if self.powerup_levels[powerup_slot_shield] > 0 then
		self:activate_force_field()
	end
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

local draw_player_projectiles<const> = function(component, draw)
	local self<const> = component.parent
	for vessel_id = 1, player_vessel_capacity do
		local projectile<const> = self.primary_projectiles[vessel_id]
		if projectile.type ~= projectile_type_none then
			if projectile.type == projectile_type_bullet then
				weapon_sources.bullet:blit(draw, projectile.x, projectile.y)
			else
				for tile_index = 0, projectile.length_tiles - 1 do
					weapon_sources.laser:blit(
						draw,
						projectile.x + tile_index * weapons_laser.tile_width,
						projectile.y
					)
				end
			end
		end
		local uplaser<const> = self.secondary_projectiles[vessel_id]
		if uplaser.type ~= projectile_type_none then
			for tile_index = 0, uplaser.length_tiles - 1 do
				weapon_sources.uplaser:blit(
					draw,
					uplaser.x + tile_index * weapons_uplaser.tile_width,
					uplaser.y
				)
			end
		end
	end
	for vessel_id = 1, player_vessel_capacity do
		local missile<const> = self.missile_projectiles[vessel_id]
		if missile.type ~= projectile_type_none then
			missile.sprite:blit(draw, missile.x, missile.y)
		end
	end
end
local new_projectile_visual<const> = custom_visual_component.factory({
	id_local = player_projectile_visual_id,
	draw = draw_player_projectiles,
})

local draw_player_vessel<const> = function(component, draw)
	local owner<const> = component.parent
	local option_source<const> = owner.visual_sources.options[owner.option_anim_index]
	for i = 1, #owner.options do
		local option<const> = owner.options[i]
		option_source:blit(draw, option.x, option.y)
	end
	owner.sprite.source:blit(draw, owner.x, owner.y)
end
local new_vessel_visual<const> = custom_visual_component.factory({
	id_local = player_vessel_visual_id,
	draw = draw_player_vessel,
})

local collides_at<const> = function(self, x, y)
	for i = 1, #player_hitcheck_x do
		if self.stage:is_solid_pixel(x + player_hitcheck_x[i], y + player_hitcheck_y[i]) then
			return true
		end
	end
	return false
end

local move_x<const> = function(self, dx, max_x)
	if dx == 0 then
		return
	end
	self.x = clamp(self.x + dx, 0, max_x)
end

local move_y<const> = function(self, dy, max_y)
	if dy == 0 then
		return
	end
	self.y = clamp(self.y + dy, 0, max_y)
end

function player:update_position()
	local visual_sources<const> = self.visual_sources
	local max_x<const> = playfield_width - player_width
	local max_y<const> = playfield_height - player_height
	local previous_x<const> = self.x
	local previous_y<const> = self.y
	local movement_speed<const> = player_base_movement_speed
		+ player_movement_speed_increase * self.powerup_levels[powerup_slot_speed]
	local strong_force_field<const> = self.force_field_strength > 1
	self.last_speed = movement_speed

	if self.left_held then
		move_x(self, -movement_speed, max_x)
	end
	if self.right_held then
		move_x(self, movement_speed, max_x)
	end

	if self.up_held then
		move_y(self, -movement_speed, max_y)
		self.sprite = visual_sources.up
	elseif self.down_held then
		move_y(self, movement_speed, max_y)
		self.sprite = strong_force_field and visual_sources.down_shield or visual_sources.down
	else
		self.sprite = strong_force_field and visual_sources.neutral_shield or visual_sources.neutral
	end

	self.last_dx = self.x - previous_x
	self.last_dy = self.y - previous_y
end

function player:activate_force_field()
	self.force_field_strength = player_force_field_strength
	local visual = self.force_field_visual
	if visual == nil then
		visual = new_force_field_visual({ parent = self })
		self.force_field_visual = visual
		self:add_component(visual)
	end
	visual:set_animation(force_field_animation_strong)
	visual:activate()
end

function player:deactivate_force_field()
	self.force_field_strength = 0
	local visual<const> = self.force_field_visual
	if visual ~= nil then
		self.force_field_visual = nil
		visual:deactivate()
		self:remove_component(visual)
	end
end

function player:damage_force_field(destroys_in_one_blow)
	local strength = self.force_field_strength - 1
	if destroys_in_one_blow then
		strength = 0
	end
	self.force_field_strength = strength
	if strength == 1 then
		self.force_field_visual:set_animation(force_field_animation_weak)
	elseif strength <= 0 then
		self.player_state:remove_powerup(powerup_slot_shield)
	end
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
	elseif slot == powerup_slot_shield then
		if self.powerup_levels[powerup_slot_shield] > 0 then
			self:activate_force_field()
		else
			self:deactivate_force_field()
		end
	elseif slot == nil then
		self:initialize_options()
		self:deactivate_force_field()
	end
end

function player:bind()
	self.events:on({
		event = player_state_module.events.powerups_changed,
		emitter = self.player_state.id,
		handler = player.on_powerups_changed,
	})
end

function player:spawn_bullet(vessel_id)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local bullet<const> = self.primary_projectiles[vessel_id]
	bullet.type = projectile_type_bullet
	bullet.pierces_small_fry = false
	bullet.x = ((vessel_x + player_bullet_spawn_offset_x) // 8) * 8
	bullet.y = (vessel_y + player_bullet_spawn_offset_y) // 1
	bullet.collider:set_enabled(true)
	if telemetry_enabled then
		self:emit_event(
			'weapon_spawn',
			string.format(
				'weapon=bullet|vessel=%d|active=1|x=%.3f|y=%.3f',
				vessel_id,
				bullet.x,
				bullet.y
			)
		)
	end
end

function player:spawn_laser(vessel_id, level)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local laser<const> = self.primary_projectiles[vessel_id]
	laser.type = projectile_type_laser
	laser.pierces_small_fry = true
	laser.x = ((vessel_x + weapons_laser.spawn_offset_x) // weapons_laser.tile_width) *
		weapons_laser.tile_width
	laser.y = (vessel_y + weapons_laser.spawn_offset_y) // 1
	laser.state = laser_state_expand
	laser.length_tiles = 0
	laser.expansion_tiles_remaining = weapons_laser.length_tiles_by_level[level]
	laser.collider:set_enabled(true)
	if telemetry_enabled then
		self:emit_event(
			'weapon_spawn',
			string.format(
				'weapon=laser|vessel=%d|active=1|x=%.3f|y=%.3f|level=%d',
				vessel_id,
				laser.x,
				laser.y,
				level
			)
		)
	end
end

function player:spawn_missile(vessel_id, level)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local motion<const> = weapons_missile_motion_by_level[level]
	local missile<const> = self.missile_projectiles[vessel_id]
	missile.type = projectile_type_missile
	missile.pierces_small_fry = false
	missile.x = (vessel_x + weapons_missile_spawn_offset_x) // 1
	missile.y = (vessel_y + weapons_missile_spawn_offset_y) // 1
	missile.fraction_x = 0
	missile.fraction_y = 0
	missile.fall_velocity_x_q8 = motion.fall_velocity_x_q8
	missile.fall_velocity_y_q8 = motion.fall_velocity_y_q8
	missile.surface_velocity_x_q8 = motion.surface_velocity_x_q8
	missile.sprite = weapon_sources.missile_falling
	missile.collider:set_enabled(true)
	if telemetry_enabled then
		self:emit_event(
			'weapon_spawn',
			string.format(
				'weapon=missile|vessel=%d|active=1|x=%.3f|y=%.3f|level=%d',
				vessel_id,
				missile.x,
				missile.y,
				level
			)
		)
	end
end

function player:spawn_uplaser(vessel_id, level)
	local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
	local uplaser<const> = self.secondary_projectiles[vessel_id]
	uplaser.type = uplaser_projectile_type_by_level[level]
	uplaser.pierces_small_fry = true
	uplaser.x = ((vessel_x + weapons_uplaser.spawn_offset_x) // weapons_uplaser.tile_width) *
		weapons_uplaser.tile_width
	uplaser.y = (vessel_y + weapons_uplaser.spawn_offset_y) // 1
	uplaser.gate_counter = weapons_uplaser.level2_gate_frames
	uplaser.length_tiles = weapons_uplaser.initial_length_tiles
	uplaser.collider:set_enabled(true)
	if telemetry_enabled then
		self:emit_event(
			'weapon_spawn',
			string.format(
				'weapon=uplaser|vessel=%d|active=1|x=%.3f|y=%.3f|level=%d|tiles=%d',
				vessel_id,
				uplaser.x,
				uplaser.y,
				level,
				uplaser.length_tiles
			)
		)
	end
end

function player:fire_weapon_salvo()
	local vessel_count<const> = #self.options + 1
	local powerup_levels<const> = self.powerup_levels
	local laser_level<const> = powerup_levels[powerup_slot_laser]
	local missile_level<const> = powerup_levels[powerup_slot_missile]
	local uplaser_level<const> = self.player_state.uplaser_level
	for vessel_id = 1, vessel_count do
		local vessel_x<const> , vessel_y<const> = self:get_vessel_snapshot(vessel_id)
		local primary<const> = self.primary_projectiles[vessel_id]
		if vessel_y < 166 and vessel_x < 217 then
			if primary.type == projectile_type_none then
				if laser_level > 0 then
					self:spawn_laser(vessel_id, laser_level)
				else
					self:spawn_bullet(vessel_id)
				end
			elseif telemetry_enabled then
				local weapon<const> = primary.type == projectile_type_bullet and 'bullet' or 'laser'
				self:emit_event(
					'weapon_blocked',
					'weapon=' .. weapon .. '|vessel=' .. tostring(vessel_id) .. '|active=1|max=1'
				)
			end
		end

		local missile<const> = self.missile_projectiles[vessel_id]
		if missile_level > 0 and missile.type == projectile_type_none and vessel_y < 165 and vessel_x < 232 then
			self:spawn_missile(vessel_id, missile_level)
		elseif telemetry_enabled and missile_level > 0 and missile.type ~= projectile_type_none then
			self:emit_event('weapon_blocked', 'weapon=missile|vessel=' .. tostring(vessel_id) .. '|active=1|max=1')
		end

		local uplaser<const> = self.secondary_projectiles[vessel_id]
		if uplaser_level > 0 and uplaser.type == projectile_type_none and vessel_y < 166 and vessel_x < 217 then
			self:spawn_uplaser(vessel_id, uplaser_level)
		elseif telemetry_enabled and uplaser_level > 0 and uplaser.type ~= projectile_type_none then
			self:emit_event('weapon_blocked', 'weapon=uplaser|vessel=' .. tostring(vessel_id) .. '|active=1|max=1')
		end
	end
end

function player:despawn_primary_projectile(projectile, reason)
	local weapon
	if projectile.type == projectile_type_bullet then
		weapon = 'bullet'
	else
		weapon = 'laser'
	end
	projectile.type = projectile_type_none
	projectile.collider:set_enabled(false)
	if telemetry_enabled then
		self:emit_event(
			'weapon_despawn',
			string.format(
				'weapon=%s|vessel=%d|active=0|x=%.3f|y=%.3f|reason=%s',
				weapon,
				projectile.vessel_id,
				projectile.x,
				projectile.y,
				reason
			)
		)
	end
end

function player:despawn_missile(missile, reason)
	missile.type = projectile_type_none
	missile.collider:set_enabled(false)
	if telemetry_enabled then
		self:emit_event(
			'weapon_despawn',
			string.format(
				'weapon=missile|vessel=%d|active=0|x=%.3f|y=%.3f|reason=%s',
				missile.vessel_id,
				missile.x,
				missile.y,
				reason
			)
		)
	end
end

function player:despawn_uplaser(uplaser, reason)
	uplaser.type = projectile_type_none
	uplaser.collider:set_enabled(false)
	if telemetry_enabled then
		self:emit_event(
			'weapon_despawn',
			string.format(
				'weapon=uplaser|vessel=%d|active=0|x=%.3f|y=%.3f|reason=%s',
				uplaser.vessel_id,
				uplaser.x,
				uplaser.y,
				reason
			)
		)
	end
end

function player:update_bullet(bullet)
	bullet.x = bullet.x + player_bullet_movement_speed
	if bullet.x >= playfield_width then
		self:despawn_primary_projectile(bullet, 'screen_edge')
		return
	end
	local stage<const> = self.stage
	if stage:first_solid_tile_offset(
		bullet.x - player_bullet_collision_backtrack,
		bullet.y,
		2
	) < 2 or stage:first_solid_tile_offset(bullet.x, bullet.y, 2) < 2 then
		self:despawn_primary_projectile(bullet, 'stage_collision')
	end
end

function player:update_laser(laser)
	local state<const> = laser.state
	if state == laser_state_expand then
		local origin_x<const> , origin_y<const> = self:get_vessel_snapshot(laser.vessel_id)
		laser.x = ((origin_x + weapons_laser.spawn_offset_x) // weapons_laser.tile_width) *
			weapons_laser.tile_width
		laser.y = (origin_y + weapons_laser.spawn_offset_y) // 1
		if laser.x >= playfield_width - weapons_laser.tile_width then
			self:despawn_primary_projectile(laser, 'screen_edge')
			return
		end

		local expansion<const> = laser.expansion_tiles_remaining
		local step = weapons_laser.expansion_tiles_per_tick
		if expansion < step then
			step = expansion
		end
		laser.length_tiles = laser.length_tiles + step
		laser.expansion_tiles_remaining = expansion - step
		if laser.expansion_tiles_remaining == 0 then
			laser.state = laser_state_travel
		end

		local visible_tiles<const> = (playfield_width - laser.x) // weapons_laser.tile_width
		if laser.length_tiles > visible_tiles then
			laser.length_tiles = visible_tiles
		end
	else
		laser.x = laser.x + weapons_laser.travel_speed
		if laser.x >= playfield_width then
			self:despawn_primary_projectile(laser, 'screen_edge')
			return
		end
		if state == laser_state_retract then
			if laser.length_tiles <= weapons_laser.collision_retract_tiles then
				self:despawn_primary_projectile(laser, 'exhausted')
				return
			end
			laser.length_tiles = laser.length_tiles - weapons_laser.collision_retract_tiles
		else
			local visible_tiles<const> = (playfield_width - laser.x) // weapons_laser.tile_width
			if laser.length_tiles > visible_tiles then
				laser.length_tiles = visible_tiles
				if visible_tiles == 0 then
					self:despawn_primary_projectile(laser, 'exhausted')
					return
				end
			end
		end
	end

	local collision_offset<const> = self.stage:first_solid_tile_offset(laser.x, laser.y, laser.length_tiles)
	if collision_offset < laser.length_tiles then
		local retained_length<const> = collision_offset - 1
		if retained_length <= 0 then
			self:despawn_primary_projectile(laser, 'stage_collision')
		else
			laser.length_tiles = retained_length
			laser.state = laser_state_retract
		end
	end
end

function player:update_missile(missile)
	local stage<const> = self.stage
	if stage:first_solid_tile_offset(missile.x, missile.y + 8, 2) == 2 then
		missile.sprite = weapon_sources.missile_falling
		local x<const> = missile.fraction_x + missile.fall_velocity_x_q8
		local y<const> = missile.fraction_y + missile.fall_velocity_y_q8
		missile.fraction_x = x & 0xff
		missile.fraction_y = y & 0xff
		missile.x = missile.x + (x >> 8)
		missile.y = missile.y + (y >> 8)
	elseif stage:first_solid_tile_offset((missile.x + 8) & 0xff, missile.y + 8, 2) == 2 then
		missile.sprite = weapon_sources.missile_flying
		local x<const> = missile.fraction_x + missile.surface_velocity_x_q8
		local y<const> = missile.fraction_y + missile.fall_velocity_y_q8
		missile.fraction_x = x & 0xff
		missile.fraction_y = y & 0xff
		missile.x = missile.x + (x >> 8)
		missile.y = missile.y + (y >> 8)
	elseif stage:first_solid_tile_offset((missile.x + 8) & 0xff, missile.y, 2) < 2 then
		self:despawn_missile(missile, 'stage_collision')
		return
	else
		missile.sprite = weapon_sources.missile_flying
		local x<const> = missile.fraction_x + missile.surface_velocity_x_q8
		missile.fraction_x = x & 0xff
		missile.x = missile.x + (x >> 8)
	end

	if missile.x >= playfield_width or missile.y >= weapons_missile_despawn_y then
		self:despawn_missile(missile, 'screen_edge')
		return
	end
	if stage:first_solid_tile_offset(missile.x, missile.y, 2) < 2 then
		self:despawn_missile(missile, 'stage_collision')
	end
end

function player:update_uplaser(uplaser)
	uplaser.y = uplaser.y - weapons_uplaser.movement_speed
	if uplaser.y < 0 then
		self:despawn_uplaser(uplaser, 'screen_edge')
		return
	end

	if uplaser.type == projectile_type_uplaser_level_2 then
		uplaser.gate_counter = uplaser.gate_counter - 1
		if uplaser.gate_counter == 0 then
			uplaser.gate_counter = weapons_uplaser.level2_gate_frames
			if uplaser.x ~= 0 then
				uplaser.x = (uplaser.x - weapons_uplaser.level2_left_growth_px) & 0xff
				uplaser.length_tiles = uplaser.length_tiles + weapons_uplaser.level2_growth_tiles
			else
				uplaser.length_tiles = uplaser.length_tiles + weapons_uplaser.level2_edge_growth_tiles
			end
			local visible_tiles<const> = (playfield_width - uplaser.x) // weapons_uplaser.tile_width
			if uplaser.length_tiles > visible_tiles then
				uplaser.length_tiles = visible_tiles
			end
		end
	end

	if self.stage:first_solid_tile_offset(uplaser.x, uplaser.y, uplaser.length_tiles) < uplaser.length_tiles then
		self:despawn_uplaser(uplaser, 'stage_collision')
	end
end

function player:update_weapons()
	for vessel_id = 1, player_vessel_capacity do
		local primary<const> = self.primary_projectiles[vessel_id]
		if primary.type ~= projectile_type_none then
			if primary.type == projectile_type_bullet then
				self:update_bullet(primary)
			else
				self:update_laser(primary)
			end
			if primary.type == projectile_type_bullet then
				set_projectile_collider(self, primary, 6, 2)
			elseif primary.type == projectile_type_laser then
				set_projectile_collider(self, primary, primary.length_tiles * weapons_laser.tile_width, 2)
			end
		end
		local uplaser<const> = self.secondary_projectiles[vessel_id]
		if uplaser.type ~= projectile_type_none then
			self:update_uplaser(uplaser)
			if uplaser.type ~= projectile_type_none then
				set_projectile_collider(self, uplaser, uplaser.length_tiles * weapons_uplaser.tile_width, 8)
			end
		end
	end
	for vessel_id = 1, player_vessel_capacity do
		local missile<const> = self.missile_projectiles[vessel_id]
		if missile.type ~= projectile_type_none then
			self:update_missile(missile)
			if missile.type ~= projectile_type_none then
				local height<const> = missile.sprite == weapon_sources.missile_falling and 8 or 4
				set_projectile_collider(self, missile, 8, height)
			end
		end
	end
end

function player:resolve_projectile_overlap(collider_local_id, enemy, enemy_collider_local_id)
	local projectile<const> = self.projectiles_by_collider_local_id[collider_local_id]
	if projectile.type == projectile_type_none then
		return
	end
	if enemy:receive_player_projectile(projectile, enemy_collider_local_id) then
		projectile.despawn(self, projectile, 'enemy_collision')
	end
end

function player:update_runtime()
	local player_index<const> = self.player_index
	self.left_held = input.is_action_pressed(player_index, 'left')
	self.right_held = input.is_action_pressed(player_index, 'right')
	self.up_held = input.is_action_pressed(player_index, 'up')
	self.down_held = input.is_action_pressed(player_index, 'down')
	self.fire_held = input.is_action_pressed(player_index, 'fire')
	self.fire_pressed = input.is_action_just_pressed(player_index, 'fire')
	self:update_position()
	self:update_options()
	if self.player_state.current_powerup_slot ~= no_powerup_slot
	and input.is_action_just_pressed(player_index, 'powerup')
	and self.player_state:activate_selected_powerup() ~= nil then
		self.events:emit('player.powerup_activated')
	end
	if self.fire_pressed then
		self.actioneffects:trigger(player_actioneffects.effect_ids.fire_salvo)
	end
	self:emit_metric()
	self.frame = self.frame + 1
end

function player:update_flying()
	self:update_runtime()
	if collides_at(self, self.x, self.y) then
		return '/dying'
	end
end

function player:enter_flying()
	self.vessel_visual.visible = true
	self.body_collider:set_enabled(true)
end

function player:enter_dying()
	self.vessel_visual.visible = false
	self.body_collider:set_enabled(false)
	self.death_visual:set_enabled(true)
	self.player_state:lose_life()
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.fire_held = false
	self.fire_pressed = false
	self.events:emit('player.death')
end

function player:finish_dying()
	self.death_visual:set_enabled(false)
	if self.player_state.lives < 0 then
		self.events:emit('player.exhausted')
		return '/exhausted'
	end
	local start<const> = player_starts[self.player_index]
	self:set_pos(start.x, start.y)
	self.sprite = self.visual_sources.neutral
	self:initialize_options()
	return '/active/respawning'
end

function player:on_body_overlap(_state, event)
	if event.collider_local_id ~= player_body_collider_id
	or event.other_layer == collision_pickup_layer then
		return
	end
	local other<const> = registry:get(event.other_id)
	if event.other_layer == collision_enemy_projectile_layer then
		if self.force_field_strength > 0 then
			self:damage_force_field(other.destroys_shield)
			return
		end
		return '/dying'
	end
	if other.small_fry and self.force_field_strength > 0 then
		self:damage_force_field(false)
		return
	end
	return '/dying'
end

function player:ctor()
	self.vessel_visual = self:get_component(custom_visual_component, player_vessel_visual_id)
	self.death_visual = self:get_component(sprite_component, player_death_visual_id)
	self.force_field_visual = nil
	self.body_collider = self:get_component(collider_2d_component, player_body_collider_id)
	self.visual_sources = player_sources[self.player_index]
	self.powerup_levels = self.player_state.powerup_levels
	self.primary_projectiles = {}
	self.missile_projectiles = {}
	self.secondary_projectiles = {}
	self.projectiles_by_collider_local_id = {}
	for vessel_id = 1, player_vessel_capacity do
		local primary<const> = {
			type = projectile_type_none,
			vessel_id = vessel_id,
			damage = 1,
			despawn = player.despawn_primary_projectile,
		}
		local missile<const> = {
			type = projectile_type_none,
			vessel_id = vessel_id,
			damage = 1,
			despawn = player.despawn_missile,
		}
		local secondary<const> = {
			type = projectile_type_none,
			vessel_id = vessel_id,
			damage = 1,
			despawn = player.despawn_uplaser,
		}
		self.primary_projectiles[vessel_id] = primary
		self.missile_projectiles[vessel_id] = missile
		self.secondary_projectiles[vessel_id] = secondary
		local collider_base<const> = (vessel_id - 1) * 3
		attach_projectile_collider(self, primary, collider_base + 1)
		attach_projectile_collider(self, missile, collider_base + 2)
		attach_projectile_collider(self, secondary, collider_base + 3)
	end
end

local define_player_fsm<const> = function()
	fsm_library.register(ids_player_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/active/flying'
				end,
			},
			active = {
				initial = 'flying',
				tags = { active_state_tag },
				on = {
					['overlap.begin'] = {
						emitter = false,
						go = player.on_body_overlap,
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
				states = {
					flying = {
						entering_state = player.enter_flying,
						update = player.update_flying,
					},
					respawning = {
						update = player.update_runtime,
						timelines = {
							[player_respawn_timeline_id] = {
								def = {
									frames = player_respawn_frames,
									repetitions = player_respawn_invulnerability_ms
										// (player_respawn_blink_ms * 2),
									frame_duration = player_respawn_blink_ms,
									playback_mode = 'once',
									apply = true,
								},
								target_path = { 'vessel_visual' },
								on_finished = '/active/flying',
							},
						},
					},
				},
			},
			dying = {
				entering_state = player.enter_dying,
				timelines = {
					[player_death_timeline_id] = {
						def = {
							frames = player_death_frames,
							frame_duration = 100,
							playback_mode = 'once',
							apply = sprite_component.set_imgid,
						},
						target_path = { 'death_visual' },
						on_finished = player.finish_dying,
					},
				},
			},
			exhausted = {},
			projectiles = {
				is_concurrent = true,
				update = player.update_weapons,
			},
		},
	})
end

local register_player_definition<const> = function()
	prefab.define({
		def_id = ids_player_def,
		class = player,
		components = {
			new_vessel_visual,
			new_projectile_visual,
			new_death_visual,
			new_player_collider,
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
			force_field_strength = 0,
			option_anim_index = 1,
		},
	})
end

return {
	player = player,
	active_state_tag = active_state_tag,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = ids_player_def,
	player_fsm_id = ids_player_fsm,
}
