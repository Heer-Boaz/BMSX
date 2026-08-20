local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local prefab<const> = require('cartlib/world/prefab')
local world_object<const> = require('cartlib/world/world_object')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_ray<const> = {}
schoorsteen_ray.__index = schoorsteen_ray

local frame_duration_ms<const> = clock.frame_milliseconds()
local new_ray_strip<const> = tile_strip_component.factory(
	assets_schoorsteen_ray,
	0,
	-schoorsteen_ray_tile_size,
	1
)

function schoorsteen_ray:finish()
	local originator<const> = self.originator
	originator:ray_disposed()
	self:mark_for_disposal()
end

function schoorsteen_ray:update_expanding()
	local elapsed<const> = self.step_elapsed_ms + frame_duration_ms
	if elapsed < schoorsteen_ray_step_ms then
		self.step_elapsed_ms = elapsed
		return
	end
	self.step_elapsed_ms = elapsed - schoorsteen_ray_step_ms
	self.expansion_step = self.expansion_step + 1
	if self.expansion_step >= schoorsteen_ray_max_steps then
		return '/contracting'
	end
	self.ray_strip.last_tile = self.ray_strip.last_tile + schoorsteen_ray_growth_tiles
end

function schoorsteen_ray:update_contracting()
	local ray_strip<const> = self.ray_strip
	if ray_strip.first_tile > ray_strip.last_tile then
		self:finish()
		return
	end
	local elapsed<const> = self.step_elapsed_ms + frame_duration_ms
	if elapsed < schoorsteen_ray_step_ms then
		self.step_elapsed_ms = elapsed
		return
	end
	self.step_elapsed_ms = elapsed - schoorsteen_ray_step_ms
	ray_strip.first_tile = ray_strip.first_tile + schoorsteen_ray_growth_tiles
end

function schoorsteen_ray:ctor()
	self.ray_strip = self:get_component(tile_strip_component)
end

local define_fsm<const> = function()
	fsm_library.register(ids_schoorsteen_ray_fsm, {
		initial = 'expanding',
		states = {
			expanding = {
				update = schoorsteen_ray.update_expanding,
			},
			contracting = {
				update = schoorsteen_ray.update_contracting,
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
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_schoorsteen_ray_fsm }),
		},
		defaults = {
			expansion_step = 0,
			step_elapsed_ms = 0,
			z = schoorsteen_ray_draw_z,
		},
	})
end

function schoorsteen_ray.register()
	define_fsm()
	register_definition()
end

return schoorsteen_ray
