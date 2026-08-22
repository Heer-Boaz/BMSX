local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local tile_strip_collider_2d_component<const> = require('cartlib/collision/tile_strip_collider_2d_component')
local sprite_component<const> = require('cartlib/component/sprite_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world_object<const> = require('cartlib/world/world_object')
require('constants')

local moon_death_ray<const> = {}
moon_death_ray.__index = moon_death_ray

local expansion_timeline_id<const> = 'nemesis_s.enemy.moon_death_ray.expansion'
local hold_timeline_id<const> = 'nemesis_s.enemy.moon_death_ray.hold'
local new_ray_strip<const> = tile_strip_component.factory({
	id_local = moon_death_ray_strip_id,
	imgid = assets_moon_death_ray,
	step_x = -moon_death_ray_tile_size,
	step_y = 0,
	first_tile = 1,
	enabled = false,
})
local new_ray_strip_collider<const> = tile_strip_collider_2d_component.factory({
	id_local = moon_death_ray_strip_id,
	tile_strip_id_local = moon_death_ray_strip_id,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
	enabled = false,
})
local new_ray_cap<const> = sprite_component.factory({
	id_local = moon_death_ray_cap_id,
	imgid = assets_moon_death_ray_start,
})
local new_ray_cap_collider<const> = collider_2d_component.factory({
	id_local = moon_death_ray_cap_id,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
	local_area = {
		left = 0,
		top = 0,
		right = moon_death_ray_cap_width,
		bottom = moon_death_ray_cap_height,
	},
})

function moon_death_ray:ctor()
	self.ray_strip = self:get_component(tile_strip_component, moon_death_ray_strip_id)
	self.ray_strip_collider = self:get_component(
		tile_strip_collider_2d_component,
		moon_death_ray_strip_id
	)
end

function moon_death_ray:begin_expansion()
	self.ray_strip.last_tile = 1
	self.ray_strip:set_enabled(true)
	self.ray_strip_collider:set_enabled(true)
end

function moon_death_ray:apply_expansion_frame(frame)
	self.y = self.originator.y + moon_death_ray_offset_y
	self.ray_strip.last_tile = frame + 2
end

function moon_death_ray:follow_originator()
	self.y = self.originator.y + moon_death_ray_offset_y
end

local define_fsm<const> = function()
	fsm_library.register(ids_moon_death_ray_fsm, {
		initial = 'expanding',
		states = {
			expanding = {
				entering_state = moon_death_ray.begin_expansion,
				timelines = {
					[expansion_timeline_id] = {
						def = {
							frames = timeline.range(moon_death_ray_expansion_updates),
							playback_mode = 'once',
							apply = moon_death_ray.apply_expansion_frame,
						},
						play_options = { snap_to_start = false },
						on_finished = '/holding',
					},
				},
			},
			holding = {
				timelines = {
					[hold_timeline_id] = {
						def = {
							duration_frames = moon_death_ray_hold_updates,
							playback_mode = 'once',
							apply = moon_death_ray.follow_originator,
						},
						on_finished = '/finished',
					},
				},
			},
			finished = {
				entering_state = world_object.mark_for_disposal,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_moon_death_ray_def,
		class = moon_death_ray,
		base = world_object,
		components = {
			new_ray_strip,
			new_ray_strip_collider,
			new_ray_cap,
			new_ray_cap_collider,
			timeline_component.new,
			fsm_component.factory({ ids_moon_death_ray_fsm }),
		},
		defaults = {
			force_field_hit = player_force_field_hit_overload,
			z = name_table_weapon_draw_z,
		},
	})
end

function moon_death_ray.register()
	define_fsm()
	register_definition()
end

return moon_death_ray
