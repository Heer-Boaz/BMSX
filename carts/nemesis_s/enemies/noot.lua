local collision_storage<const> = require('collision_storage')
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

function noot:ctor()
	local color_index = math.random(1, #colors)
	if color_index == red_color_index and #roodje_view.objects >= noot_red_pickup_limit then
		color_index = 1
	end
	self.sprite_component.color = colors[color_index]
	if color_index == red_color_index then
		self.drop_definition_id = ids_roodje_def
	end
end

function noot:update_flying()
	local pose<const> = self.spatial
	if pose.ox < -noot_width
	or pose.ox > playfield_width
	or pose.oy < -noot_height
	or pose.oy > playfield_height then
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
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { imgid = assets_noot, order = noot_draw_z } },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_noot_fsm }),
		},
		defaults = {
			max_health = 1,
			small_fry = true,
		},
	})
end

function noot.register()
	define_fsm()
	register_definition()
end

return noot
