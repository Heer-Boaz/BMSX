local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local mini_moon<const> = {}
mini_moon.__index = mini_moon

local hit_area<const> = {
	left = 0,
	top = 0,
	right = mini_moon_width,
	bottom = mini_moon_height,
}

function mini_moon:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
end

function mini_moon:onspawn()
	local pose<const> = self.spatial
	if self.red then
		self.sprite_component:set_imgid(assets_mini_moon_red)
		self.drop_definition_id = ids_roodje_def
	end
	local target<const> = self.target.spatial
	self.motion:set_dominant_axis_speed_pixels_per_second(
		target.ox - pose.ox,
		target.oy - pose.oy,
		mini_moon_speed_px_per_second
	)
	self.target = nil
end

function mini_moon:update_flying()
	local pose<const> = self.spatial
	if pose.ox < -mini_moon_width
	or pose.ox > playfield_width
	or pose.oy < -mini_moon_height
	or pose.oy > playfield_height then
		self:mark_for_disposal()
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_mini_moon_fsm, {
		initial = 'flying',
		states = {
			flying = {
				update = mini_moon.update_flying,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_mini_moon_def,
		class = mini_moon,
		base = foe,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { imgid = assets_mini_moon, order = mini_moon_draw_z } },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_mini_moon_fsm }),
		},
		defaults = {
			max_health = mini_moon_health,
			red = false,
			small_fry = true,
		},
	})
end

function mini_moon.register()
	define_fsm()
	register_definition()
end

return mini_moon
