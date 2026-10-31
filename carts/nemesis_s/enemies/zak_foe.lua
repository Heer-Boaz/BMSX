local actioneffects<const> = require('cartlib/actioneffects')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local ballistic_movement_component<const> = require('cartlib/physics/ballistic_movement_component')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local enemy_bullet<const> = require('enemies/enemy_bullet')
local foe<const> = require('enemies/foe')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local zak_foe<const> = {}
zak_foe.__index = zak_foe
setmetatable(zak_foe, { __index = foe })
zak_foe.destroyed_event = 'enemy.zak.destroyed'

local fire_effect_id<const> = 'nemesis_s.enemy.zak_foe.fire'
local players_view
local hit_area<const> = {
	left = 2,
	top = 2,
	right = 14,
	bottom = 14,
}

local set_direction<const> = function(self, direction)
	if self.direction ~= direction then
		self.direction = direction
		self.motion.velocity_x = -self.motion.velocity_x
	end
	self.sprite_component.flip_h = direction == zak_foe_direction_left
end

function zak_foe:ctor()
	self.motion = self:get_component(ballistic_movement_component)
	self.motion:set_enabled(false)
end

function zak_foe:onspawn()
	local _<const>, pose_y<const> = self:get_global_position()
	self.ground_y = pose_y
	set_direction(self, self.direction)
end

function zak_foe:update_stationary()
	if self:dispose_if_left_of_stage(zak_foe_width) then
		return
	end
	self.actioneffects:trigger(fire_effect_id)
end

function zak_foe:enter_jumping()
	self.motion:set_enabled(true)
	self.motion:set_velocity_pixels_per_second(
		zak_foe_horizontal_speed_px_per_second * self.direction,
		zak_foe_initial_vertical_speed_px_per_second
	)
	self.motion:set_acceleration_pixels_per_second_squared(
		0,
		zak_foe_vertical_acceleration_px_per_second_squared
	)
	self.sprite_component:set_imgid(assets_zak_foe_jump)
end

function zak_foe:update_jumping()
	local pose_x<const>, pose_y<const> = self:get_global_position()
	if self:dispose_if_left_of_stage(zak_foe_width) then
		return
	end
	self.actioneffects:trigger(fire_effect_id)

	local stage<const> = self.stage
	if self.direction == zak_foe_direction_left then
		if pose_x < 0
		or stage:is_solid_pixel(pose_x + hit_area.left, pose_y + hit_area.top)
		or not stage:is_solid_pixel(
			pose_x + hit_area.left - 4,
			pose_y + hit_area.bottom + stage.tile_size
		) then
			set_direction(self, zak_foe_direction_right)
		end
	else
		if pose_x + hit_area.right >= playfield_width
		or stage:is_solid_pixel(pose_x + hit_area.right, pose_y + hit_area.top)
		or not stage:is_solid_pixel(
			pose_x + hit_area.right,
			pose_y + hit_area.bottom + stage.tile_size
		) then
			set_direction(self, zak_foe_direction_left)
		end
	end
end

function zak_foe:enter_recovering()
	local pose_x<const> = self:get_global_position()
	local motion<const> = self.motion
	motion:set_enabled(false)
	motion.velocity_x = 0
	motion.velocity_y = 0
	motion.acceleration_x = 0
	motion.acceleration_y = 0
	motion.fraction_y = 0
	local next_y<const> = self.ground_y
	self:set_global_position(pose_x, next_y)
	self.sprite_component:set_imgid(assets_zak_foe_recover)
end

local define_fsm<const> = function()
	fsm_library.register(ids_zak_foe_fsm, {
		initial = 'prepare_jump',
		states = {
			prepare_jump = {
				entering_state = function(self)
					self.sprite_component:set_imgid(assets_zak_foe_stand)
				end,
				update = zak_foe.update_stationary,
				timelines = {
					prepare_jump = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_ms = zak_foe_prepare_ms,
							playback_mode = 'once',
						},
						on_finished = '/jumping',
					},
				},
			},
			jumping = {
				entering_state = zak_foe.enter_jumping,
				update = zak_foe.update_jumping,
				timelines = {
					jumping = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_ms = zak_foe_jump_ms,
							playback_mode = 'once',
						},
						on_finished = '/recovering',
					},
				},
			},
			recovering = {
				entering_state = zak_foe.enter_recovering,
				update = zak_foe.update_stationary,
				timelines = {
					recovering = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_ms = zak_foe_recovery_ms,
							playback_mode = 'once',
						},
						on_finished = '/prepare_jump',
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_zak_foe_def,
		class = zak_foe,
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			stage_scroll_follower_component.new,
			ballistic_movement_component.new,
			actioneffect_component.factory({ fire_effect_id }),
			timeline_component.new,
			fsm_component.factory({ ids_zak_foe_fsm }),
		},
		defaults = {
			imgid = assets_zak_foe_stand,
			order = zak_foe_draw_z,
			max_health = zak_foe_health,
			small_fry = true,
			drop_definition_id = ids_roodje_def,
			direction = zak_foe_direction_left,
		},
	})
end

function zak_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	actioneffects.register_effect(fire_effect_id, {
		initial_cooldown_ms = zak_foe_fire_initial_ms,
		calculate_cooldown_ms = function()
			local wait_ms<const> = math.random(zak_foe_fire_min_ms, zak_foe_fire_max_ms)
			if #players_view.objects == 2 then
				return wait_ms // 2
			end
			return wait_ms
		end,
		handler = function(self)
			local pose_x<const>, pose_y<const> = self:get_global_position()
			local players<const> = players_view.objects
			local target
			if #players == 1 then
				target = players[1]
			else
				target = players[math.random(1, #players)]
			end
			local target_pose_x<const>, target_pose_y<const> = target:get_global_position()
			local bullet_x<const> = pose_x + 4
			local bullet_y<const> = pose_y
			local velocity_x<const>, velocity_y<const> = enemy_bullet.aim_velocity(
				target_pose_x - bullet_x,
				target_pose_y - bullet_y
			)
			if velocity_x == nil then
				return
			end
			self.scene:spawn(ids_enemy_bullet_def, {
				position = { x = bullet_x, y = bullet_y },
				velocity_x = velocity_x,
				velocity_y = velocity_y,
				stage = self.stage,
			})
		end,
	})
	define_fsm()
	register_definition()
end

return zak_foe
