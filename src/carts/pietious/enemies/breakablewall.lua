local constants = require('constants')
local combat_overlap = require('combat_overlap')
local combat_damage = require('combat_damage')

local breakablewall = {}
breakablewall.__index = breakablewall

function breakablewall:apply_damage(request)
	if request.weapon_kind ~= 'sword' then
		return combat_damage.build_rejected_result(request, 'wrong_weapon')
	end
	self.health = self.health - 1
	if self.health > 0 then
		return combat_damage.build_applied_result(request, 1, false, 'damaged')
	end
	self.health = 0
	return combat_damage.build_applied_result(request, 1, true, 'destroyed')
end

function breakablewall:process_damage_result(result)
	if result.status == 'rejected' then
		return
	end
	if result.destroyed then
		object('c').events:emit('room.condition_set', {
			room_number = result.room_number,
			condition = self.trigger,
		})
		object('c').events:emit('appearance')
		self:mark_for_disposal()
		return
	end
end

function breakablewall:ctor()
	self:get_component('collider2dcomponent'):apply_collision_profile('enemy')
	self.sx = self.width_tiles * constants.room.tile_size
	self.sy = self.height_tiles * constants.room.tile_size
	local renderer = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		for ty = 0, self.height_tiles - 1 do
			local draw_y = self.y + (ty * constants.room.tile_size)
			for tx = 0, self.width_tiles - 1 do
				local draw_x = self.x + (tx * constants.room.tile_size)
				put_sprite(self.tiletype, draw_x, draw_y, 22)
			end
		end
	end
	self.events:on({
		event = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			local contact_kind = combat_overlap.classify_player_contact(event)
			if contact_kind == nil then
				return
			end
			local result = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, contact_kind))
			self:process_damage_result(result)
		end,
	})
end

function breakablewall.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.breakablewall',
		class = breakablewall,
		components = { 'collider2dcomponent', 'customvisualcomponent' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 0,
			max_health = 1,
			health = 1,
			direction = nil,
			speed_x_num = nil,
			speed_y_num = nil,
			width_tiles = 1,
			height_tiles = 1,
			tiletype = 'castle_front_blue_1',
			enemy_kind = 'breakablewall',
		},
	})
end

return breakablewall
