local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local clock<const> = require('cartlib/clock')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local charge_flash<const> = require('enemies/charge_flash')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local sneeuwpop<const> = {}
sneeuwpop.__index = sneeuwpop

local frame_duration_ms<const> = clock.frame_milliseconds()
local flash_sources<const> = {
	image.resolve(assets_schoorsteen_flash_1),
	image.resolve(assets_schoorsteen_flash_2),
}

function sneeuwpop:ctor()
	self:get_component(collider_2d_component):set_shape_asset(
		assets.collision_shape_sneeuwpop_body_addr
	)
	self:get_component(custom_visual_component):set_draw_function(charge_flash)
	self.flash_sources = flash_sources
	self.flash_offset_x = sneeuwpop_flash_offset_x
	self.flash_offset_y = sneeuwpop_flash_offset_y
end

function sneeuwpop:enter_idle()
	self.flash_visible = false
	self.phase_elapsed_ms = 0
end

function sneeuwpop:update_idle()
	if self:dispose_if_left_of_stage(sneeuwpop_width) or self.x <= 0 then
		return
	end
	return '/ready_to_fire'
end

function sneeuwpop:enter_ready_to_fire()
	self.flash_visible = true
	self.flash_frame = 1
	self.phase_elapsed_ms = 0
end

function sneeuwpop:update_ready_to_fire()
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	self.flash_frame = 3 - self.flash_frame
	local elapsed<const> = self.phase_elapsed_ms + frame_duration_ms
	if elapsed < sneeuwpop_ready_ms then
		self.phase_elapsed_ms = elapsed
		return
	end
	self.flash_visible = false
	self.ray = world:spawn(ids_sneeuwpop_ray_def, {
		originator = self,
		pos = {
			x = self.x + sneeuwpop_ray_offset_x,
			y = self.y + sneeuwpop_ray_offset_y,
		},
	})
	self.events:emit('enemy.ray_fired')
	return '/firing'
end

function sneeuwpop:enter_firing()
	self.phase_elapsed_ms = 0
end

function sneeuwpop:update_firing()
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	local elapsed<const> = self.phase_elapsed_ms + frame_duration_ms
	if elapsed >= sneeuwpop_firing_ms then
		return '/cooling_down'
	end
	self.phase_elapsed_ms = elapsed
end

function sneeuwpop:ray_disposed()
	self.ray = nil
	self.state_machines:transition_to('/cooling_down')
end

function sneeuwpop:enter_cooling_down()
	self.phase_elapsed_ms = 0
end

function sneeuwpop:update_cooling_down()
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	local elapsed<const> = self.phase_elapsed_ms + frame_duration_ms
	if elapsed >= sneeuwpop_cooldown_ms then
		return '/idle'
	end
	self.phase_elapsed_ms = elapsed
end

function sneeuwpop:on_destroyed(projectile)
	local ray<const> = self.ray
	if ray ~= nil then
		ray:mark_for_disposal()
		self.ray = nil
	end
	world:spawn(ids_destroyed_sneeuwpop_def, {
		stage = self.stage,
		pos = { x = self.x, y = self.y },
	})
	enemy.on_destroyed(self, projectile)
end

local define_fsm<const> = function()
	fsm_library.register(ids_sneeuwpop_fsm, {
		initial = 'idle',
		states = {
			idle = {
				entering_state = sneeuwpop.enter_idle,
				update = sneeuwpop.update_idle,
			},
			ready_to_fire = {
				entering_state = sneeuwpop.enter_ready_to_fire,
				update = sneeuwpop.update_ready_to_fire,
			},
			firing = {
				entering_state = sneeuwpop.enter_firing,
				update = sneeuwpop.update_firing,
			},
			cooling_down = {
				entering_state = sneeuwpop.enter_cooling_down,
				update = sneeuwpop.update_cooling_down,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_sneeuwpop_def,
		class = sneeuwpop,
		base = enemy,
		components = {
			enemy.new_collider,
			custom_visual_component.new,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_sneeuwpop_fsm }),
		},
		defaults = {
			imgid = assets_sneeuwpop,
			max_health = sneeuwpop_health,
			small_fry = false,
			phase_elapsed_ms = 0,
			flash_frame = 1,
			flash_visible = false,
			z = sneeuwpop_draw_z,
		},
	})
end

function sneeuwpop.register()
	define_fsm()
	register_definition()
end

return sneeuwpop
