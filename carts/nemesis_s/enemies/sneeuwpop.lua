local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
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
	loop = true,
	attachment_affine = { 1, 0, 0, 1, sneeuwpop_flash_offset_x, sneeuwpop_flash_offset_y },
	order = sneeuwpop_draw_z,
	enabled = false,
})

function sneeuwpop:ctor()
	self.flash_animation = self:get_component(sprite_animation_component)
end

function sneeuwpop:update_idle()
	local pose<const> = self.spatial
	if pose.ox <= 0 then
		return
	end
	return '/ready_to_fire'
end

function sneeuwpop:fire_ray()
	local pose<const> = self.spatial
	local ray<const> = self.scene:spawn(ids_sneeuwpop_ray_def, {
	}, { local_transform = { 1, 0, 0, 1, pose.ox + sneeuwpop_ray_offset_x, pose.oy + sneeuwpop_ray_offset_y } })
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
	local pose<const> = self.spatial
	self.scene:spawn(ids_destroyed_sneeuwpop_def, {
		stage = self.stage,
	}, { local_transform = { 1, 0, 0, 1, pose.ox, pose.oy } })
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
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			enemy.collider_factory(assets.collision_shape_sneeuwpop_body_addr),
			new_flash_animation,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_sneeuwpop_fsm }),
		},
		defaults = {
			imgid = assets_sneeuwpop,
			order = sneeuwpop_draw_z,
			max_health = sneeuwpop_health,
			small_fry = false,
			stage_scroll_width = sneeuwpop_width,
		},
	})
end

function sneeuwpop.register()
	define_fsm()
	register_definition()
end

return sneeuwpop
