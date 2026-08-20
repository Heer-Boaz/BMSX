local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local sneeuwpop<const> = {}
sneeuwpop.__index = sneeuwpop

local frame_duration_ms<const> = clock.frame_milliseconds()
local new_flash_animation<const> = sprite_animation_component.factory({
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	frame_duration_ms = frame_duration_ms,
	loop = true,
	offset_x = sneeuwpop_flash_offset_x,
	offset_y = sneeuwpop_flash_offset_y,
	offset_z = 0,
	enabled = false,
})
local deactivate_flash_animation<const> = function(target)
	target.flash_animation:deactivate()
end

function sneeuwpop:ctor()
	self:get_component(collider_2d_component):set_shape_asset(
		assets.collision_shape_sneeuwpop_body_addr
	)
	self.flash_animation = self:get_component(sprite_animation_component)
end

function sneeuwpop:update_idle()
	if self:dispose_if_left_of_stage(sneeuwpop_width) or self.x <= 0 then
		return
	end
	return '/ready_to_fire'
end

function sneeuwpop:enter_ready_to_fire(state)
	self.flash_animation:activate()
	state.data.elapsed_ms = 0
end

function sneeuwpop:update_ready_to_fire(state)
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	local elapsed<const> = state.data.elapsed_ms + frame_duration_ms
	if elapsed < sneeuwpop_ready_ms then
		state.data.elapsed_ms = elapsed
		return
	end
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

function sneeuwpop:enter_firing(state)
	state.data.elapsed_ms = 0
end

function sneeuwpop:update_firing(state)
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	local elapsed<const> = state.data.elapsed_ms + frame_duration_ms
	if elapsed >= sneeuwpop_firing_ms then
		return '/cooling_down'
	end
	state.data.elapsed_ms = elapsed
end

function sneeuwpop:ray_disposed()
	self.ray = nil
	self.state_machines:transition_to('/cooling_down')
end

function sneeuwpop:enter_cooling_down(state)
	state.data.elapsed_ms = 0
end

function sneeuwpop:update_cooling_down(state)
	if self:dispose_if_left_of_stage(sneeuwpop_width) then
		return
	end
	local elapsed<const> = state.data.elapsed_ms + frame_duration_ms
	if elapsed >= sneeuwpop_cooldown_ms then
		return '/idle'
	end
	state.data.elapsed_ms = elapsed
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
				update = sneeuwpop.update_idle,
			},
			ready_to_fire = {
				data = { elapsed_ms = 0 },
				entering_state = sneeuwpop.enter_ready_to_fire,
				exiting_state = deactivate_flash_animation,
				update = sneeuwpop.update_ready_to_fire,
			},
			firing = {
				data = { elapsed_ms = 0 },
				entering_state = sneeuwpop.enter_firing,
				update = sneeuwpop.update_firing,
			},
			cooling_down = {
				data = { elapsed_ms = 0 },
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
			new_flash_animation,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_sneeuwpop_fsm }),
		},
		defaults = {
			imgid = assets_sneeuwpop,
			max_health = sneeuwpop_health,
			small_fry = false,
			z = sneeuwpop_draw_z,
		},
	})
end

function sneeuwpop.register()
	define_fsm()
	register_definition()
end

return sneeuwpop
