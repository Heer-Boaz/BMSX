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

local sneeuwpop_ray<const> = {}
sneeuwpop_ray.__index = sneeuwpop_ray

local sneeuwpop_ray_expand_timeline_id<const> = 'nemesis_s.enemy.sneeuwpop_ray.expand'
local sneeuwpop_ray_contract_timeline_id<const> = 'nemesis_s.enemy.sneeuwpop_ray.contract'
local new_ray_strip<const> = tile_strip_component.factory({
	imgid = assets_sneeuwpop_ray,
	step_x = -sneeuwpop_ray_tile_size,
	step_y = -sneeuwpop_ray_tile_size,
	first_tile = 0,
	enabled = false,
})
local new_ray_collider<const> = tile_strip_collider_2d_component.factory({
	id_local = 0,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
	enabled = false,
})

function sneeuwpop_ray:finish()
	local originator<const> = self.originator
	originator:ray_disposed()
	self:mark_for_disposal()
end

function sneeuwpop_ray:apply_expansion_frame(frame)
	local tile_count<const> = frame * sneeuwpop_ray_growth_tiles
	self.ray_strip.last_tile = tile_count - 1
	local active<const> = tile_count ~= 0
	self.ray_strip:set_enabled(active)
	self.ray_collider:set_enabled(active)
end

function sneeuwpop_ray:apply_contraction_frame(frame)
	local tile_count<const> = (sneeuwpop_ray_max_steps - 1 - frame) * sneeuwpop_ray_growth_tiles
	self.ray_strip.first_tile = self.ray_strip.last_tile - tile_count + 1
	local active<const> = tile_count ~= 0
	self.ray_strip:set_enabled(active)
	self.ray_collider:set_enabled(active)
end

function sneeuwpop_ray:ctor()
	self.ray_strip = self:get_component(tile_strip_component)
	self.ray_collider = self:get_component(tile_strip_collider_2d_component)
end

local define_fsm<const> = function()
	fsm_library.register(ids_sneeuwpop_ray_fsm, {
		initial = 'expanding',
		states = {
			expanding = {
				timelines = {
					[sneeuwpop_ray_expand_timeline_id] = {
						def = {
							frames = timeline.range(sneeuwpop_ray_max_steps),
							frame_duration = sneeuwpop_ray_step_ms,
							playback_mode = 'once',
							apply = sneeuwpop_ray.apply_expansion_frame,
						},
						on_finished = '/contracting',
					},
				},
			},
			contracting = {
				timelines = {
					[sneeuwpop_ray_contract_timeline_id] = {
						def = {
							frames = timeline.range(sneeuwpop_ray_max_steps),
							frame_duration = sneeuwpop_ray_step_ms,
							playback_mode = 'once',
							apply = sneeuwpop_ray.apply_contraction_frame,
						},
						on_finished = sneeuwpop_ray.finish,
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_sneeuwpop_ray_def,
		class = sneeuwpop_ray,
		base = world_object,
		components = {
			new_ray_strip,
			new_ray_collider,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_sneeuwpop_ray_fsm }),
		},
		defaults = {
			destroys_shield = true,
			z = sneeuwpop_ray_draw_z,
		},
	})
end

function sneeuwpop_ray.register()
	define_fsm()
	register_definition()
end

return sneeuwpop_ray
