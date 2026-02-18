local constants = require('constants')
local combat_overlap = require('combat_overlap')

local breakablewall = {}
breakablewall.__index = breakablewall

function breakablewall:take_weapon_hit()
	self.health = self.health - 1
	if self.health > 0 then
		service('c').events:emit('evt.cue.foedamage', {})
		return
	end
	self.health = 0
	local room_number = service('c').current_room.room_number
	service('c').events:emit('room.condition_set', {
		room_number = room_number,
		condition = self.trigger,
	})
	service('c').events:emit('evt.cue.appearance', {})
	self:mark_for_disposal()
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
		event_name = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			local contact_kind = combat_overlap.classify_player_contact(event)
			if contact_kind ~= 'sword' then
				return
			end
			self:take_weapon_hit()
		end,
	})
end

function breakablewall.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.breakablewall',
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
			despawn_on_room_switch = true,
			tick_enabled = false,
		},
	})
end

return breakablewall
