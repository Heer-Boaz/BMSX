local clock<const> = require('cartlib/clock')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local world_object<const> = require('cartlib/world/world_object')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_ray<const> = {}
schoorsteen_ray.__index = schoorsteen_ray

local frame_duration_ms<const> = clock.frame_milliseconds()
local ray_source<const> = image.resolve(assets_schoorsteen_ray)

local draw_ray<const> = function(component, draw)
	local owner<const> = component.parent
	for y = owner.top_y, owner.y - 1, schoorsteen_ray_tile_size do
		ray_source:blit(draw, owner.x, y)
	end
end

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
	self.top_y = self.top_y - schoorsteen_ray_growth_tiles * schoorsteen_ray_tile_size
end

function schoorsteen_ray:update_contracting()
	if self.y <= self.top_y then
		self:finish()
		return
	end
	local elapsed<const> = self.step_elapsed_ms + frame_duration_ms
	if elapsed < schoorsteen_ray_step_ms then
		self.step_elapsed_ms = elapsed
		return
	end
	self.step_elapsed_ms = elapsed - schoorsteen_ray_step_ms
	self.y = self.y - schoorsteen_ray_growth_tiles * schoorsteen_ray_tile_size
end

function schoorsteen_ray:ctor()
	self:get_component(custom_visual_component):set_draw_function(draw_ray)
	self.top_y = 0
end

function schoorsteen_ray:onspawn()
	self.top_y = self.y
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
			custom_visual_component.new,
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
