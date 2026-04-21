local constants<const> = require('constants')

local disappearingwall<const> = {}
disappearingwall.__index = disappearingwall

function disappearingwall:update_wall_size()
	self.sx = self.width_tiles * constants.room.tile_size
	self.sy = self.height_tiles * constants.room.tile_size
end

function disappearingwall:bind_visual()
	local renderer<const> = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		for ty = 0, self.height_tiles - 1 do
			local draw_y<const> = self.y + (ty * constants.room.tile_size)
			for tx = 0, self.width_tiles - 1 do
				local draw_x<const> = self.x + (tx * constants.room.tile_size)
				memwrite(
					vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
					sys_vdp_cmd_blit,
						13,
					0,
					assets.img[self.tiletype].handle,
					draw_x,
					draw_y,
					22,
					sys_vdp_layer_world,
					1,
					1,
					0,
					1,
					1,
					1,
					1,
					0
				)
			end
		end
	end
end

function disappearingwall:ctor()
	self:get_component('collider2dcomponent'):apply_collision_profile('enemy')
	self:update_wall_size()
	self:bind_visual()
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
