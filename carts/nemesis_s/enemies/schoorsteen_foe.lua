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

local schoorsteen_foe<const> = {}
schoorsteen_foe.__index = schoorsteen_foe

local frame_duration_ms<const> = clock.frame_milliseconds()
local animation_images<const> = {
	assets_schoorsteen_foe_1,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_3,
	assets_schoorsteen_foe_4,
	assets_schoorsteen_foe_5,
}
local new_flash_animation<const> = sprite_animation_component.factory({
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	frame_duration_ms = frame_duration_ms,
	loop = true,
	offset_x = schoorsteen_flash_offset_x,
	offset_y = schoorsteen_flash_offset_y,
	offset_z = 0,
	enabled = false,
})
local deactivate_flash_animation<const> = function(target)
	target.flash_animation:deactivate()
end
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
	self.animation_frame = 0
	self.animation_elapsed_ms = 0
	self:set_imgid(animation_images[1])
end

function schoorsteen_foe:update_idle()
	if self:dispose_if_left_of_stage(schoorsteen_foe_width) or self.x <= 0 then
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
	self.animation_frame = 0
	self.animation_elapsed_ms = 0
end

function schoorsteen_foe:update_ready_to_fire()
	if self:dispose_if_left_of_stage(schoorsteen_foe_width) then
		return
	end
	local elapsed<const> = self.animation_elapsed_ms + frame_duration_ms
	if elapsed < schoorsteen_foe_animation_frame_ms then
		self.animation_elapsed_ms = elapsed
		return
	end
	self.animation_elapsed_ms = elapsed - schoorsteen_foe_animation_frame_ms
	local frame<const> = self.animation_frame + 1
	self.animation_frame = frame
	if frame >= #animation_images then
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
	self:set_imgid(animation_images[frame + 1])
end

function schoorsteen_foe:enter_firing(state)
	state.data.elapsed_ms = 0
end

function schoorsteen_foe:update_firing(state)
	if self:dispose_if_left_of_stage(schoorsteen_foe_width) then
		return
	end
	local elapsed<const> = state.data.elapsed_ms + frame_duration_ms
	if elapsed >= schoorsteen_foe_cooldown_ms then
		return '/cooling_down'
	end
	state.data.elapsed_ms = elapsed
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

function schoorsteen_foe:enter_cooling_down()
	self.animation_elapsed_ms = 0
end

function schoorsteen_foe:update_cooling_down()
	if self:dispose_if_left_of_stage(schoorsteen_foe_width) then
		return
	end
	local elapsed<const> = self.animation_elapsed_ms + frame_duration_ms
	if elapsed < schoorsteen_foe_animation_frame_ms then
		self.animation_elapsed_ms = elapsed
		return
	end
	self.animation_elapsed_ms = elapsed - schoorsteen_foe_animation_frame_ms
	local frame<const> = self.animation_frame - 1
	self.animation_frame = frame
	if frame < 0 then
		return '/idle'
	end
	self:set_imgid(animation_images[frame + 1])
end

local define_fsm<const> = function()
	fsm_library.register(ids_schoorsteen_foe_fsm, {
		initial = 'idle',
		states = {
			idle = {
				entering_state = schoorsteen_foe.enter_idle,
				update = schoorsteen_foe.update_idle,
			},
			ready_to_fire = {
				entering_state = schoorsteen_foe.enter_ready_to_fire,
				exiting_state = deactivate_flash_animation,
				update = schoorsteen_foe.update_ready_to_fire,
			},
			firing = {
				data = { elapsed_ms = 0 },
				entering_state = schoorsteen_foe.enter_firing,
				update = schoorsteen_foe.update_firing,
			},
			cooling_down = {
				entering_state = schoorsteen_foe.enter_cooling_down,
				update = schoorsteen_foe.update_cooling_down,
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
			fsm_component.factory({ ids_schoorsteen_foe_fsm }),
		},
		defaults = {
			imgid = assets_schoorsteen_foe_1,
			max_health = schoorsteen_foe_health,
			small_fry = false,
			animation_frame = 0,
			animation_elapsed_ms = 0,
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
