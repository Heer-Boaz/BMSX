local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')

local abs<const> = math.abs
local mijter_foe<const> = {}
mijter_foe.__index = mijter_foe

local images_by_type<const> = {
	[mijter_foe_type_blue] = {
		neutral = assets_mijter_foe_blue_neutral,
		up = assets_mijter_foe_blue_up,
		down = assets_mijter_foe_blue_down,
	},
	[mijter_foe_type_red] = {
		neutral = assets_mijter_foe_red_neutral,
		up = assets_mijter_foe_red_up,
		down = assets_mijter_foe_red_down,
	},
}

local players_view

function mijter_foe:onspawn()
	self.images = images_by_type[self.mijter_type]
	self:set_imgid(self.images.neutral)
	self.moved_before_attack = 0
	self.move_before_attack = math.random(
		mijter_foe_attack_distance_min,
		mijter_foe_attack_distance_max
	)
end

function mijter_foe:update_default()
	self.x = self.x - mijter_foe_default_speed
	self.moved_before_attack = self.moved_before_attack + mijter_foe_default_speed
	if self.moved_before_attack <= self.move_before_attack then
		return
	end

	local players<const> = players_view.objects
	local target
	if #players == 1 then
		target = players[1]
	else
		target = players[math.random(1, #players)]
	end
	local dx<const> = target.x - self.x
	local dy<const> = target.y - self.y
	local abs_dx<const> = abs(dx)
	local abs_dy<const> = abs(dy)
	if abs_dx < mijter_foe_axis_epsilon then
		self.speed_x = 0
		self.speed_y = dy > 0 and mijter_foe_attack_speed or -mijter_foe_attack_speed
	elseif abs_dy < mijter_foe_axis_epsilon then
		self.speed_x = dx > 0 and mijter_foe_attack_speed or -mijter_foe_attack_speed
		self.speed_y = 0
	elseif abs_dx > abs_dy then
		self.speed_x = dx > 0 and mijter_foe_attack_speed or -mijter_foe_attack_speed
		self.speed_y = (dy / abs_dx) * mijter_foe_attack_speed
	else
		self.speed_x = (dx / abs_dy) * mijter_foe_attack_speed
		self.speed_y = dy > 0 and mijter_foe_attack_speed or -mijter_foe_attack_speed
	end
	if self.speed_y > 0 then
		self:set_imgid(self.images.down)
	else
		self:set_imgid(self.images.up)
	end
	return '/attacking_player'
end

function mijter_foe:update_attacking_player()
	self.x = self.x + self.speed_x
	self.y = self.y + self.speed_y
	if self.x < -mijter_foe_width
	or self.x > playfield_width
	or self.y < -mijter_foe_height
	or self.y > playfield_height then
		self:mark_for_disposal()
	end
end

function mijter_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	fsm_library.register(ids_mijter_foe_fsm, {
		initial = 'default',
		states = {
			default = {
				update = mijter_foe.update_default,
			},
			attacking_player = {
				update = mijter_foe.update_attacking_player,
			},
		},
	})
	prefab.define({
		def_id = ids_mijter_foe_def,
		class = mijter_foe,
		base = sprite_object,
		components = {
			fsm_component.factory({ ids_mijter_foe_fsm }),
		},
		defaults = {
			imgid = assets_mijter_foe_blue_neutral,
			mijter_type = mijter_foe_type_blue,
			speed_x = 0,
			speed_y = 0,
			z = mijter_foe_draw_z,
		},
	})
end

return mijter_foe
