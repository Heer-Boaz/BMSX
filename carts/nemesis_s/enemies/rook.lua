local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local rook<const> = {}
rook.__index = rook
rook.primary_sprite_factory = sprite_animation_component.factory({
	frames = {
		assets_rook_1,
		assets_rook_2,
		assets_rook_3,
	},
	frame_run = rook_animation_frame_updates,
	loop = true,
})

local players_view
local hit_area<const> = {
	left = 3,
	top = 3,
	right = 13,
	bottom = 13,
}

function rook:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
end

function rook:onspawn()
	local pose<const> = self.spatial
	self.chimney_exit_y = pose.oy - self.rise_distance
	self.motion.velocity_x = 0
	self.motion.velocity_y = rook_rise_velocity_y_q8
end

function rook:update_leaving_chimney()
	local pose<const> = self.spatial
	if pose.oy > self.chimney_exit_y then
		return
	end
	local players<const> = players_view.objects
	local target
	if #players == 1 then
		target = players[1]
	else
		target = players[math.random(1, #players)]
	end
	self.target = target
	local motion<const> = self.motion
	local target_pose<const> = target.spatial
	motion.velocity_x = target_pose.ox < pose.ox
		and -rook_attack_velocity_x_q8
		or rook_attack_velocity_x_q8
	motion.velocity_y = 0
	self.stage_scroll_follower:set_enabled(false)
	return '/attacking_player'
end

function rook:update_attacking_player()
	local pose<const> = self.spatial
	local motion<const> = self.motion
	local target<const> = self.target.spatial
	if target.oy < pose.oy then
		motion.velocity_y = motion.velocity_y - rook_tracking_acceleration_y_q8
	else
		motion.velocity_y = motion.velocity_y + rook_tracking_acceleration_y_q8
	end
	if pose.ox < -rook_width
	or pose.ox > playfield_width
	or pose.oy < -rook_height
	or pose.oy > playfield_height then
		self:mark_for_disposal()
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_rook_fsm, {
		initial = 'leaving_chimney',
		states = {
			leaving_chimney = {
				update = rook.update_leaving_chimney,
			},
			attacking_player = {
				update = rook.update_attacking_player,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_rook_def,
		class = rook,
		base = foe,
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			fixed_point_velocity_component.new,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_rook_fsm }),
		},
		defaults = {
			imgid = assets_rook_1,
			order = rook_draw_z,
			max_health = rook_health,
			small_fry = true,
		},
	})
end

function rook.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return rook
