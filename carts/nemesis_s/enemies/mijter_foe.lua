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
	local players<const> = players_view.objects
	if #players == 1 then
		self.target = players[1]
	else
		self.target = players[math.random(1, #players)]
	end
	local motion<const> = self.motion
	motion.velocity_x = mijter_foe_velocity_x_q8
	motion.velocity_y = 0
end

function mijter_foe:update_flying()
	local motion<const> = self.motion
	if self.target.y < self.y then
		motion.velocity_y = motion.velocity_y - mijter_foe_tracking_acceleration_y_q8
	else
		motion.velocity_y = motion.velocity_y + mijter_foe_tracking_acceleration_y_q8
	end
	local imgid<const> = motion.velocity_y > 0 and self.images.down or self.images.up
	if self.sprite_component.imgid ~= imgid then
		self:set_imgid(imgid)
	end
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
		initial = 'flying',
		states = {
			flying = {
				update = mijter_foe.update_flying,
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
