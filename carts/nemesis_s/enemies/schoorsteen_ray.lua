local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local tile_strip_collider_2d_component<const> = require('cartlib/collision/tile_strip_collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world_object<const> = require('cartlib/world/world_object')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_ray<const> = {}
schoorsteen_ray.__index = schoorsteen_ray

local expansion_finished_event<const> = 'schoorsteen_ray.expansion.finished'
local initial_first_tile<const> = 1
local max_tiles<const> = schoorsteen_ray_initial_tiles
	+ schoorsteen_ray_growth_updates * schoorsteen_ray_growth_tiles
local contraction_updates<const> = schoorsteen_ray_growth_updates + 1
local new_ray_strip<const> = tile_strip_component.factory({
	imgid = assets_schoorsteen_ray,
	step_x = 0,
	step_y = -schoorsteen_ray_tile_size,
	first_tile = initial_first_tile,
	enabled = false,
})
local new_ray_collider<const> = tile_strip_collider_2d_component.factory({
	id_local = 0,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
	enabled = false,
})

function schoorsteen_ray:apply_expansion_frame(frame)
	local ray_strip<const> = self.ray_strip
	local last_tile<const> = schoorsteen_ray_initial_tiles
		+ (frame + 1) * schoorsteen_ray_growth_tiles
	if last_tile < self.max_tiles then
		ray_strip.last_tile = last_tile
	else
		ray_strip.last_tile = self.max_tiles
	end
end

function schoorsteen_ray:apply_contraction_frame(frame)
	local ray_strip<const> = self.ray_strip
	local first_tile<const> = initial_first_tile + (frame + 1) * schoorsteen_ray_growth_tiles
	if first_tile > ray_strip.last_tile then
		self:mark_for_disposal()
		return
	end
	ray_strip.first_tile = first_tile
end

function schoorsteen_ray:ctor()
	self.ray_strip = self:get_component(tile_strip_component)
	self.ray_collider = self:get_component(tile_strip_collider_2d_component)
end

function schoorsteen_ray:onspawn()
	local direction<const> = self.direction
	local ray_strip<const> = self.ray_strip
	ray_strip.step_y = direction * schoorsteen_ray_tile_size
	self.max_tiles = self.stage:first_solid_vertical_tile_offset(
		self.x,
		self.y + ray_strip.step_y,
		max_tiles,
		direction
	)
	local active<const> = self.max_tiles > 0
	ray_strip.last_tile = active and schoorsteen_ray_initial_tiles or 0
	ray_strip:set_enabled(active)
	self.ray_collider:set_enabled(active)
end

local define_fsm<const> = function()
	fsm_library.register(ids_schoorsteen_ray_fsm, {
		initial = 'expanding',
		states = {
			expanding = {
				on = {
					[expansion_finished_event] = '/contracting',
				},
				timelines = {
					expand = {
						def = {
							frames = timeline.range(schoorsteen_ray_growth_updates),
							playback_mode = 'once',
							apply = schoorsteen_ray.apply_expansion_frame,
							tracks = {
								{
									kind = 'event',
									keys = {
										{
											frame = schoorsteen_ray_growth_updates - 1,
											event = expansion_finished_event,
											direction = 'forward',
										},
									},
								},
							},
						},
						play_options = { snap_to_start = false },
					},
				},
			},
			contracting = {
				timelines = {
					contract = {
						def = {
							frames = timeline.range(contraction_updates),
							playback_mode = 'once',
							apply = schoorsteen_ray.apply_contraction_frame,
						},
						play_options = { snap_to_start = false },
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_schoorsteen_ray_def,
		class = schoorsteen_ray,
		base = world_object,
		components = {
			new_ray_strip,
			new_ray_collider,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_schoorsteen_ray_fsm }),
		},
		defaults = {
			force_field_hit = player_force_field_hit_overload,
			direction = -1,
			z = schoorsteen_ray_draw_z,
		},
	})
end

function schoorsteen_ray.register()
	define_fsm()
	register_definition()
end

return schoorsteen_ray
