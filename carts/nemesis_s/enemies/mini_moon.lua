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
	self:get_component(collider_2d_component).local_area = hit_area
	self.motion = self:get_component(fixed_point_velocity_component)
end

function mini_moon:onspawn()
	if self.red then
		self:set_imgid(assets_mini_moon_red)
		self.drop_definition_id = ids_roodje_def
	end
	local target<const> = self.target
	self.motion:set_dominant_axis_speed_pixels_per_second(
		target.x - self.x,
		target.y - self.y,
		mini_moon_speed_px_per_second
	)
	self.target = nil
end

function mini_moon:update_flying()
	if self.x < -mini_moon_width
	or self.x > playfield_width
	or self.y < -mini_moon_height
	or self.y > playfield_height then
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
		components = {
			enemy.new_collider,
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_mini_moon_fsm }),
		},
		defaults = {
			imgid = assets_mini_moon,
			max_health = mini_moon_health,
			red = false,
			small_fry = true,
			z = mini_moon_draw_z,
		},
	})
end

function mini_moon.register()
	define_fsm()
	register_definition()
end

return mini_moon
