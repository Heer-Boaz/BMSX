local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local noot<const> = {}
noot.__index = noot

local colors<const> = {
	0xffffffff,
	0xffff0000,
	0xff00ffff,
	0xff00ff00,
	0xffffbfcc,
	0xffffff00,
	0xffed82ed,
}
local red_color_index<const> = 2
local hit_area<const> = {
	left = 1,
	top = 0,
	right = 8,
	bottom = 8,
}
local roodje_view

function noot:ctor(options)
	self:get_component(collider_2d_component).local_area = hit_area
	local color_index = math.random(1, #colors)
	if color_index == red_color_index and #roodje_view.objects >= noot_red_pickup_limit then
		color_index = 1
	end
	self.sprite_component.color = colors[color_index]
	if color_index == red_color_index then
		self.drop_definition_id = ids_roodje_def
	end
	local motion<const> = self:get_component(fixed_point_velocity_component)
	motion:set_velocity_pixels_per_second(options.velocity_x, options.velocity_y)
end

function noot:update_flying()
	if self.x < -noot_width
	or self.x > playfield_width
	or self.y < -noot_height
	or self.y > playfield_height then
		self:mark_for_disposal()
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_noot_fsm, {
		initial = 'flying',
		states = {
			flying = {
				update = noot.update_flying,
			},
		},
	})
end

local register_definition<const> = function()
	roodje_view = world:active_definition_view(ids_roodje_def)
	prefab.define({
		def_id = ids_noot_def,
		class = noot,
		base = foe,
		components = {
			enemy.new_collider,
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_noot_fsm }),
		},
		defaults = {
			imgid = assets_noot,
			max_health = 1,
			small_fry = true,
			z = noot_draw_z,
		},
	})
end

function noot.register()
	define_fsm()
	register_definition()
end

return noot
