local constants = require('constants')

local disappearingwall = {}
disappearingwall.__index = disappearingwall

function disappearingwall:update_wall_size()
	self.sx = self.width_tiles * constants.room.tile_size
	self.sy = self.height_tiles * constants.room.tile_size
end

function disappearingwall:bind_visual()
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
end

function disappearingwall:bind()
	self.events:on({
		event = 'room.condition_set',
		subscriber = self,
		handler = function(event)
			if event.condition ~= self.trigger then
				return
			end
			self:mark_for_disposal()
		end,
	})
end

function disappearingwall:ctor()
	self:get_component('collider2dcomponent'):apply_collision_profile('enemy')
	self:update_wall_size()
	self:bind_visual()
end

function disappearingwall.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.disappearingwall',
		class = disappearingwall,
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
			tiletype = 'frontworld_l',
			enemy_kind = 'disappearingwall',
		},
	})
end

return disappearingwall
