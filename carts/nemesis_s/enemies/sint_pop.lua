local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
require('constants')

local sint_pop<const> = {}
sint_pop.__index = sint_pop

function sint_pop:update_move_to_player()
	self.x = self.x + sint_pop_move_to_player_speed_x
	if self.x <= sint_pop_vertical_start_x then
		if self.group_type == sint_pop_group_up then
			self.vertical_speed = sint_pop_move_vertical_up_speed_y
		else
			self.vertical_speed = sint_pop_move_vertical_down_speed_y
		end
		return '/move_vertical'
	end
end

function sint_pop:update_move_vertical()
	self.x = self.x + sint_pop_move_to_player_speed_x
	self.y = self.y + self.vertical_speed
	if self.x <= sint_pop_retreat_start_x then
		return '/move_away_from_player'
	end
end

function sint_pop:update_move_away_from_player()
	self.x = self.x + sint_pop_move_away_speed_x
	if self.x > playfield_width then
		self:mark_for_disposal()
	end
end

function sint_pop.register()
	fsm_library.register(ids_sint_pop_fsm, {
		initial = 'move_to_player',
		states = {
			move_to_player = {
				update = sint_pop.update_move_to_player,
			},
			move_vertical = {
				update = sint_pop.update_move_vertical,
			},
			move_away_from_player = {
				update = sint_pop.update_move_away_from_player,
			},
		},
	})
	prefab.define({
		def_id = ids_sint_pop_def,
		class = sint_pop,
		base = sprite_object,
		components = {
			fsm_component.factory({ ids_sint_pop_fsm }),
		},
		defaults = {
			imgid = assets_sint_pop,
			group_type = sint_pop_group_up,
			group_id = 0,
			vertical_speed = 0,
			z = sint_pop_draw_z,
		},
	})
end

return sint_pop
