local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local sint_pop<const> = {}
sint_pop.__index = sint_pop
local update_seconds<const> = clock.update_milliseconds() * 0.001
local approach_step_x<const> = sint_pop_move_to_player_speed_x_px_per_second * update_seconds
local vertical_up_step_y<const> = sint_pop_move_vertical_up_speed_y_px_per_second * update_seconds
local vertical_down_step_y<const> = sint_pop_move_vertical_down_speed_y_px_per_second * update_seconds
local retreat_step_x<const> = sint_pop_move_away_speed_x_px_per_second * update_seconds
local hit_area<const> = {
	left = 0,
	top = 0,
	right = 16,
	bottom = 32,
}

function sint_pop:ctor()
	self:get_component(collider_2d_component).local_area = hit_area
end

function sint_pop:update_move_to_player()
	self.x = self.x + approach_step_x
	if self.x > sint_pop_vertical_start_x then
		return
	end
	self.vertical_step_y = self.group_type == sint_pop_group_up
		and vertical_up_step_y
		or vertical_down_step_y
	return '/move_vertical'
end

function sint_pop:update_move_vertical()
	self.x = self.x + approach_step_x
	self.y = self.y + self.vertical_step_y
	if self.x > sint_pop_retreat_start_x then
		return
	end
	return '/move_away_from_player'
end

function sint_pop:update_move_away_from_player()
	self.x = self.x + retreat_step_x
	if self.x > playfield_width then
		self:mark_for_disposal()
	end
end

function sint_pop:on_destroyed(projectile)
	local formation<const> = self.formation
	local remaining<const> = formation.remaining - 1
	formation.remaining = remaining
	local drop_definition_id
	if remaining == 0 then
		drop_definition_id = ids_roodje_def
	end
	world:spawn(ids_small_explosion_def, {
		stage = self.stage,
		drop_definition_id = drop_definition_id,
		pos = { x = self.x, y = self.y + 8 },
	})
	self.events:emit('enemy.small.destroyed')
	enemy.on_destroyed(self, projectile)
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
		base = foe,
		components = {
			enemy.new_collider,
			fsm_component.factory({ ids_sint_pop_fsm }),
		},
		defaults = {
			imgid = assets_sint_pop,
			group_type = sint_pop_group_up,
			max_health = 1,
			small_fry = true,
			z = sint_pop_draw_z,
		},
	})
end

return sint_pop
