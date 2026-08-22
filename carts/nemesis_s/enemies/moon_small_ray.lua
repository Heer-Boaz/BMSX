local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local tile_strip_collider_2d_component<const> = require('cartlib/collision/tile_strip_collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world_object<const> = require('cartlib/world/world_object')
require('constants')

local moon_small_ray<const> = {}
moon_small_ray.__index = moon_small_ray

local new_ray_strip<const> = tile_strip_component.factory({
	imgid = assets_schoorsteen_ray,
	step_x = 0,
	step_y = 0,
	first_tile = 0,
	enabled = false,
})
local new_ray_collider<const> = tile_strip_collider_2d_component.factory({
	id_local = 0,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
	local_area = {
		left = 1,
		top = 0,
		right = 6,
		bottom = moon_small_ray_tile_size,
	},
	enabled = false,
})

function moon_small_ray:ctor()
	self.ray_strip = self:get_component(tile_strip_component)
	self.ray_collider = self:get_component(tile_strip_collider_2d_component)
end

function moon_small_ray:onspawn()
	local strip<const> = self.ray_strip
	strip.step_y = self.direction * moon_small_ray_tile_size
	if self.direction == moon_vertical_direction_up then
		strip.first_tile = 1
	else
		strip.first_tile = 0
	end
	strip.last_tile = strip.first_tile - 1
end

function moon_small_ray:apply_expansion_frame(frame)
	local strip<const> = self.ray_strip
	local tile_count<const> = frame * moon_small_ray_growth_tiles
	if self.direction == moon_vertical_direction_up then
		strip.last_tile = tile_count
	else
		strip.last_tile = tile_count - 1
	end
	local active<const> = tile_count ~= 0
	strip:set_enabled(active)
	self.ray_collider:set_enabled(active)
end

function moon_small_ray:update_moving()
	self.y = self.y + self.direction * moon_small_ray_speed
	if self.direction == moon_vertical_direction_up then
		if self.y < 0 then
			self:mark_for_disposal()
		end
	elseif self.y > playfield_height then
		self:mark_for_disposal()
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_moon_small_ray_fsm, {
		initial = 'expanding',
		states = {
			expanding = {
				timelines = {
					expansion = {
						def = {
							frames = timeline.range(moon_small_ray_max_steps),
							frame_duration = moon_small_ray_step_ms,
							playback_mode = 'once',
							apply = moon_small_ray.apply_expansion_frame,
						},
						on_finished = '/moving',
					},
				},
			},
			moving = {
				update = moon_small_ray.update_moving,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_moon_small_ray_def,
		class = moon_small_ray,
		base = world_object,
		components = {
			new_ray_strip,
			new_ray_collider,
			timeline_component.new,
			fsm_component.factory({ ids_moon_small_ray_fsm }),
		},
		defaults = {
			force_field_hit = player_force_field_hit_overload,
			direction = moon_vertical_direction_up,
			z = name_table_weapon_draw_z,
		},
	})
end

function moon_small_ray.register()
	define_fsm()
	register_definition()
end

return moon_small_ray
