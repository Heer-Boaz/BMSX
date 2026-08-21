local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local mijter_foe<const> = {}
mijter_foe.__index = mijter_foe

local images_by_type<const> = {
	[mijter_foe_type_blue] = {
		neutral = assets_mijter_foe_blue_neutral,
		up = assets_mijter_foe_blue_up,
		down = assets_mijter_foe_blue_down,
	},
	[mijter_foe_type_red] = {
		neutral = assets_mijter_foe_red_neutral,
		up = assets_mijter_foe_red_up,
		down = assets_mijter_foe_red_down,
	},
}

local players_view
local hit_area<const> = {
	left = 2,
	top = 2,
	right = 24,
	bottom = 14,
}

function mijter_foe:ctor()
	self:get_component(collider_2d_component).local_area = hit_area
	self.motion = self:get_component(fixed_point_velocity_component)
end

function mijter_foe:onspawn()
	self.images = images_by_type[self.mijter_type]
	self:set_imgid(self.images.neutral)
	if self.mijter_type == mijter_foe_type_red then
		self.drop_definition_id = ids_roodje_def
	end
	self.moved_before_attack = 0
	self.move_before_attack = math.random(
		mijter_foe_attack_distance_min,
		mijter_foe_attack_distance_max
	)
end

function mijter_foe:update_default()
	self.x = self.x - mijter_foe_default_speed
	self.moved_before_attack = self.moved_before_attack + mijter_foe_default_speed
	if self.moved_before_attack <= self.move_before_attack then
		return
	end

	local players<const> = players_view.objects
	local target
	if #players == 1 then
		target = players[1]
	else
		target = players[math.random(1, #players)]
	end
	local dx<const> = target.x - self.x
	local dy<const> = target.y - self.y
	local motion<const> = self.motion
	motion:set_dominant_axis_velocity(
		dx,
		dy,
		mijter_foe_attack_speed_q8
	)
	if motion.velocity_y > 0 then
		self:set_imgid(self.images.down)
	else
		self:set_imgid(self.images.up)
	end
	return '/attacking_player'
end

function mijter_foe:update_attacking_player()
	if self.x < -mijter_foe_width
	or self.x > playfield_width
	or self.y < -mijter_foe_height
	or self.y > playfield_height then
		self:mark_for_disposal()
	end
end

function mijter_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	fsm_library.register(ids_mijter_foe_fsm, {
		initial = 'default',
		states = {
			default = {
				update = mijter_foe.update_default,
			},
			attacking_player = {
				update = mijter_foe.update_attacking_player,
			},
		},
	})
	prefab.define({
		def_id = ids_mijter_foe_def,
		class = mijter_foe,
		base = foe,
		components = {
			enemy.new_collider,
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_mijter_foe_fsm }),
		},
		defaults = {
			imgid = assets_mijter_foe_blue_neutral,
			mijter_type = mijter_foe_type_blue,
			max_health = 1,
			small_fry = true,
			z = mijter_foe_draw_z,
		},
	})
end

return mijter_foe
