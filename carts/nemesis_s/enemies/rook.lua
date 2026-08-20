local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local rook_animation_system<const> = require('enemies/rook_animation_system')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local rook<const> = {}
rook.__index = rook

local players_view
local hit_area<const> = {
	left = 3,
	top = 3,
	right = 13,
	bottom = 13,
}

function rook:ctor()
	self:get_component(collider_2d_component).local_area = hit_area
	self.motion = self:get_component(fixed_point_velocity_component)
	self:set_imgid(rook_animation_system.current_imgid)
end

function rook:update_leaving_chimney()
	self.y = self.y - rook_leave_speed
	local distance<const> = self.distance_left_chimney + rook_leave_speed
	self.distance_left_chimney = distance
	if distance <= rook_leave_distance then
		return
	end
	local players<const> = players_view.objects
	local target
	if #players == 1 then
		target = players[1]
	else
		target = players[math.random(1, #players)]
	end
	self.motion:set_dominant_axis_velocity(
		target.x - self.x,
		target.y - self.y,
		rook_attack_speed_q8
	)
	self.stage_scroll_follower:set_enabled(false)
	return '/attacking_player'
end

function rook:update_attacking_player()
	if self.x < -rook_width
	or self.x > playfield_width
	or self.y < -rook_height
	or self.y > playfield_height then
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
		base = enemy,
		components = {
			enemy.new_collider,
			fixed_point_velocity_component.new,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_rook_fsm }),
		},
		defaults = {
			imgid = assets_rook_1,
			max_health = rook_health,
			small_fry = true,
			distance_left_chimney = 0,
			z = rook_draw_z,
		},
	})
end

function rook.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return rook
