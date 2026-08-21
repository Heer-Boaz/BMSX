local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local ground_foe<const> = require('enemies/ground_foe')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local sneeuwpop<const> = {}
sneeuwpop.__index = sneeuwpop

local new_flash_animation<const> = sprite_animation_component.factory({
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	frame_duration_ms = clock.update_milliseconds(),
	loop = true,
	offset_x = sneeuwpop_flash_offset_x,
	offset_y = sneeuwpop_flash_offset_y,
	offset_z = 0,
	enabled = false,
})

function sneeuwpop:ctor()
	self.flash_animation = self:get_component(sprite_animation_component)
end

function sneeuwpop:update_idle()
	if self.x <= 0 then
		return
	end
	return '/ready_to_fire'
end

function sneeuwpop:fire_ray()
	local ray<const> = world:spawn(ids_sneeuwpop_ray_def, {
		pos = {
			x = self.x + sneeuwpop_ray_offset_x,
			y = self.y + sneeuwpop_ray_offset_y,
		},
	})
	ray.events:on({
		event = 'enemy.ray.finished',
		subscriber = self,
		handler = sneeuwpop.ray_finished,
		once = true,
	})
	self.ray = ray
	self.events:emit('enemy.ray_fired')
	return '/firing'
end

function sneeuwpop:ray_finished()
	self.ray = nil
	self.state_machines:transition_to('/cooling_down')
end

function sneeuwpop:on_destroyed(projectile)
	world:spawn(ids_destroyed_sneeuwpop_def, {
		stage = self.stage,
		pos = { x = self.x, y = self.y },
	})
	ground_foe.on_destroyed(self, projectile)
end

local define_fsm<const> = function()
	fsm_library.register(ids_sneeuwpop_fsm, {
		initial = 'idle',
		update = enemy.update_stage_follower,
		states = {
			idle = {
				update = sneeuwpop.update_idle,
			},
			ready_to_fire = {
				entering_state = function(self)
					self.flash_animation:activate()
				end,
				exiting_state = function(self)
					self.flash_animation:deactivate()
				end,
				timelines = {
					ready = {
						def = {
							continuous = true,
							duration_ms = sneeuwpop_ready_ms,
							playback_mode = 'once',
						},
						on_finished = sneeuwpop.fire_ray,
					},
				},
			},
			firing = {},
			cooling_down = {
				timelines = {
					cooldown = {
						def = {
							continuous = true,
							duration_ms = sneeuwpop_cooldown_ms,
							playback_mode = 'once',
						},
						on_finished = '/idle',
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_sneeuwpop_def,
		class = sneeuwpop,
		base = ground_foe,
		components = {
			enemy.collider_factory(assets.collision_shape_sneeuwpop_body_addr),
			new_flash_animation,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_sneeuwpop_fsm }),
		},
		defaults = {
			imgid = assets_sneeuwpop,
			max_health = sneeuwpop_health,
			small_fry = false,
			stage_scroll_width = sneeuwpop_width,
			z = sneeuwpop_draw_z,
		},
	})
end

function sneeuwpop.register()
	define_fsm()
	register_definition()
end

return sneeuwpop
