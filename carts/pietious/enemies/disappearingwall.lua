require('constants')

local disappearingwall<const> = {}
disappearingwall.__index = disappearingwall

function disappearingwall:update_wall_size()
	self.sx = self.width_tiles * room_tile_size
	self.sy = self.height_tiles * room_tile_size
end

function disappearingwall:ctor()
	self:get_component('collider2dcomponent'):apply_collision_profile('enemy')
	self:update_wall_size()
	local tile_layer<const> = self:get_component('tilelayercomponent')
	local tile_count<const> = self.width_tiles * self.height_tiles
	local tile_source<const> = gx_img_rect(self.tiletype)
	local sources<const> = {}
	for index = 1, tile_count do
		sources[index] = tile_source
	end
	tile_layer.sources = sources
	tile_layer.tile_count = tile_count
	tile_layer.columns = self.width_tiles
	tile_layer.tile_size = room_tile_size
	tile_layer.offset.x = 0
	tile_layer.offset.y = 0
	tile_layer.empty_source = false
end

function disappearingwall.register_enemy_fsm()
	define_fsm('disappearingwall', {
		initial = 'active',
		on = {
			['room.condition_set'] = function(self, _state, event)
				if event.condition == self.trigger then
					self:mark_for_disposal()
				end
			end,
		},
		states = {
			active = {},
		},
	})
end

function disappearingwall.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.disappearingwall',
		class = disappearingwall,
		fsms = { 'disappearingwall' },
		components = { 'collider2dcomponent', 'tilelayercomponent' },
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
