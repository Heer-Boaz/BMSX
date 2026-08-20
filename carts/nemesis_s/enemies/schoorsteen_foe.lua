local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_foe<const> = {}
schoorsteen_foe.__index = schoorsteen_foe

local animation_images<const> = {
	assets_schoorsteen_foe_1,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_3,
	assets_schoorsteen_foe_4,
	assets_schoorsteen_foe_5,
}
local cooling_animation_images<const> = {
	assets_schoorsteen_foe_5,
	assets_schoorsteen_foe_5,
	assets_schoorsteen_foe_4,
	assets_schoorsteen_foe_3,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_1,
}
local new_flash_animation<const> = sprite_animation_component.factory({
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	frame_duration_ms = clock.frame_milliseconds(),
	loop = true,
	offset_x = schoorsteen_flash_offset_x,
	offset_y = schoorsteen_flash_offset_y,
	offset_z = 0,
	enabled = false,
})
local players_view

function schoorsteen_foe:ctor()
	self:get_component(collider_2d_component):set_shape_asset(
		assets.collision_shape_schoorsteen_foe_body_addr
	)
	self.flash_animation = self:get_component(sprite_animation_component)
end

function schoorsteen_foe:onspawn()
	if #players_view.objects == 2 then
		self.health = schoorsteen_foe_health * 2
	end
end

function schoorsteen_foe:enter_idle()
	self.vulnerable = false
	self.flash_animation:deactivate()
	self:set_imgid(animation_images[1])
end

function schoorsteen_foe:update_idle()
	if self.x <= 0 then
		return
	end
	local players<const> = players_view.objects
	local fire_left<const> = self.x + schoorsteen_foe_fire_left
	local fire_right<const> = self.x + schoorsteen_foe_fire_right
	for player_index = 1, #players do
		local player_x<const> = players[player_index].x
		if player_x >= fire_left and player_x <= fire_right then
			return '/ready_to_fire'
		end
	end
end

function schoorsteen_foe:enter_ready_to_fire()
	self.vulnerable = true
	self.flash_animation:activate()
end

function schoorsteen_foe:fire_ray()
	self.ray = world:spawn(ids_schoorsteen_ray_def, {
		originator = self,
		pos = {
			x = self.x + schoorsteen_ray_offset_x,
			y = self.y + schoorsteen_ray_offset_y,
		},
	})
	self.events:emit('enemy.ray_fired')
	return '/firing'
end

function schoorsteen_foe:ray_disposed()
	self.ray = nil
	self.state_machines:transition_to('/cooling_down')
end

function schoorsteen_foe:on_destroyed(projectile)
	local ray<const> = self.ray
	if ray ~= nil then
		ray:mark_for_disposal()
		self.ray = nil
	end
	enemy.on_destroyed(self, projectile)
end

local define_fsm<const> = function()
	fsm_library.register(ids_schoorsteen_foe_fsm, {
		initial = 'idle',
		update = enemy.update_stage_follower,
		states = {
			idle = {
				entering_state = schoorsteen_foe.enter_idle,
				update = schoorsteen_foe.update_idle,
			},
			ready_to_fire = {
				entering_state = schoorsteen_foe.enter_ready_to_fire,
				exiting_state = function(self)
					self.flash_animation:deactivate()
				end,
				timelines = {
					open = {
						def = {
							frames = animation_images,
							frame_duration = schoorsteen_foe_animation_frame_ms,
							playback_mode = 'once',
							apply = schoorsteen_foe.set_imgid,
						},
						on_finished = schoorsteen_foe.fire_ray,
					},
				},
			},
			firing = {
				timelines = {
					firing = {
						def = {
							continuous = true,
							duration_ms = schoorsteen_foe_cooldown_ms,
							playback_mode = 'once',
						},
						on_finished = '/cooling_down',
					},
				},
			},
			cooling_down = {
				timelines = {
					close = {
						def = {
							frames = cooling_animation_images,
							frame_duration = schoorsteen_foe_animation_frame_ms,
							playback_mode = 'once',
							apply = schoorsteen_foe.set_imgid,
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
		def_id = ids_schoorsteen_foe_def,
		class = schoorsteen_foe,
		base = enemy,
		components = {
			enemy.new_collider,
			new_flash_animation,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_schoorsteen_foe_fsm }),
		},
		defaults = {
			imgid = assets_schoorsteen_foe_1,
			max_health = schoorsteen_foe_health,
			small_fry = false,
			stage_scroll_width = schoorsteen_foe_width,
			z = schoorsteen_foe_draw_z,
		},
	})
end

function schoorsteen_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return schoorsteen_foe
