local actioneffects<const> = require('cartlib/actioneffects')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local zak_foe<const> = {}
zak_foe.__index = zak_foe

local fire_effect_id<const> = 'nemesis_s.enemy.zak_foe.fire'
local players_view
local hit_area<const> = {
	left = 2,
	top = 2,
	right = 14,
	bottom = 14,
}

local set_direction<const> = function(self, direction)
	self.direction = direction
	self.sprite_component.flip_h = direction == zak_foe_direction_left
end

function zak_foe:ctor()
	self:get_component(collider_2d_component).local_area = hit_area
end

function zak_foe:onspawn()
	self.ground_y = self.y
	set_direction(self, self.direction)
end

function zak_foe:update_stationary()
	if self:dispose_if_left_of_stage(zak_foe_width) then
		return
	end
	self.actioneffects:try_trigger(fire_effect_id)
end

function zak_foe:enter_jumping()
	self.vertical_speed = zak_foe_initial_vertical_speed
	self:set_imgid(assets_zak_foe_jump)
end

function zak_foe:update_jumping()
	if self:dispose_if_left_of_stage(zak_foe_width) then
		return
	end
	self.actioneffects:try_trigger(fire_effect_id)
	self.x = self.x + zak_foe_horizontal_speed * self.direction
	self.y = self.y + self.vertical_speed
	self.vertical_speed = self.vertical_speed + zak_foe_vertical_acceleration

	local stage<const> = self.stage
	if self.direction == zak_foe_direction_left then
		if self.x < 0
		or stage:is_solid_pixel(self.x + hit_area.left, self.y + hit_area.top)
		or not stage:is_solid_pixel(
			self.x + hit_area.left - 4,
			self.y + hit_area.bottom + stage.tile_size
		) then
			set_direction(self, zak_foe_direction_right)
		end
	else
		if self.x + hit_area.right >= playfield_width
		or stage:is_solid_pixel(self.x + hit_area.right, self.y + hit_area.top)
		or not stage:is_solid_pixel(
			self.x + hit_area.right,
			self.y + hit_area.bottom + stage.tile_size
		) then
			set_direction(self, zak_foe_direction_left)
		end
	end
end

function zak_foe:enter_recovering()
	self.y = self.ground_y
	self:set_imgid(assets_zak_foe_recover)
end

function zak_foe:enter_prepare_jump()
	self.vertical_speed = 0
	self:set_imgid(assets_zak_foe_stand)
end

local define_fsm<const> = function()
	fsm_library.register(ids_zak_foe_fsm, {
		initial = 'prepare_jump',
		states = {
			prepare_jump = {
				entering_state = zak_foe.enter_prepare_jump,
				update = zak_foe.update_stationary,
				timelines = {
					prepare_jump = {
						def = {
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
		base = enemy,
		components = {
			enemy.new_collider,
			stage_scroll_follower_component.new,
			actioneffect_component.factory({ fire_effect_id }),
			timeline_component.new,
			fsm_component.factory({ ids_zak_foe_fsm }),
		},
		defaults = {
			imgid = assets_zak_foe_stand,
			max_health = zak_foe_health,
			small_fry = true,
			direction = zak_foe_direction_left,
			vertical_speed = 0,
			z = zak_foe_draw_z,
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
			local players<const> = players_view.objects
			local target
			if #players == 1 then
				target = players[1]
			else
				target = players[math.random(1, #players)]
			end
			local bullet_x<const> = self.x + 4
			local bullet_y<const> = self.y
			local speed_x<const>, speed_y<const> = velocity.dominant_axis_velocity(
				target.x - bullet_x,
				target.y - bullet_y,
				enemy_bullet_speed
			)
			world:spawn(ids_enemy_bullet_def, {
				stage = self.stage,
				speed_x = speed_x,
				speed_y = speed_y,
				pos = { x = bullet_x, y = bullet_y },
			})
		end,
	})
	define_fsm()
	register_definition()
end

return zak_foe
