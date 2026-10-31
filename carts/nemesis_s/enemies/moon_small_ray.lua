local object_2d<const> = require('cartlib/world/object_2d')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local tile_strip_collider_2d_component<const> = require('cartlib/collision/tile_strip_collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local collision_storage<const> = require('collision_storage')
require('constants')

local moon_small_ray<const> = {}
moon_small_ray.__index = moon_small_ray
setmetatable(moon_small_ray, { __index = object_2d })

local new_ray_strip<const> = tile_strip_component.factory({
	imgid = assets_schoorsteen_ray,
	step_x = 0,
	step_y = 0,
	first_tile = 0,
	maximum_tiles = (moon_small_ray_max_steps - 1) * moon_small_ray_growth_tiles,
	order = name_table_weapon_draw_z,
	enabled = false,
})
local new_ray_collider<const> = tile_strip_collider_2d_component.factory({
	id_local = 0,
	geometry_pool = collision_storage.area,
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
	strip:set_step(0, self.direction * moon_small_ray_tile_size)
	local first<const> = self.direction == moon_vertical_direction_up and 1 or 0
	strip:set_range(first, first - 1)
end

function moon_small_ray:apply_expansion_frame(frame)
	local strip<const> = self.ray_strip
	local tile_count<const> = frame * moon_small_ray_growth_tiles
	if self.direction == moon_vertical_direction_up then
		strip:set_range(strip.first_tile, tile_count)
	else
		strip:set_range(strip.first_tile, tile_count - 1)
	end
	local active<const> = tile_count ~= 0
	strip:set_enabled(active)
	self.ray_collider:set_enabled(active)
end

function moon_small_ray:update_moving()
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local next_y<const> = pose_y + self.direction * moon_small_ray_speed
	self:set_global_position(pose_x, next_y)
	if self.direction == moon_vertical_direction_up then
		if next_y < 0 then
			self:mark_for_disposal()
		end
	elseif next_y > playfield_height then
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
							phase = 'physical',
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
		components = {
			new_ray_strip,
			new_ray_collider,
			timeline_component.new,
			fsm_component.factory({ ids_moon_small_ray_fsm }),
		},
		defaults = {
			force_field_hit = player_force_field_hit_overload,
			direction = moon_vertical_direction_up,
		},
	})
end

function moon_small_ray.register()
	define_fsm()
	register_definition()
end

return moon_small_ray
