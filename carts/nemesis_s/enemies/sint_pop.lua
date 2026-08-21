local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local foe<const> = require('enemies/foe')
require('constants')

local sint_pop<const> = {}
sint_pop.__index = sint_pop
local hit_area<const> = {
	left = 0,
	top = 0,
	right = 16,
	bottom = 32,
}

function sint_pop:ctor()
	self:get_component(collider_2d_component).local_area = hit_area
	self.motion = self:get_component(fixed_point_velocity_component)
	self.motion:set_velocity_pixels_per_second(sint_pop_move_to_player_speed_x_px_per_second, 0)
end

function sint_pop:update_move_to_player()
	if self.x > sint_pop_vertical_start_x then
		return
	end
	return '/move_vertical'
end

function sint_pop:update_move_vertical()
	if self.x > sint_pop_retreat_start_x then
		return
	end
	return '/move_away_from_player'
end

function sint_pop:update_move_away_from_player()
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
				entering_state = function(self)
					local velocity_y<const> = self.group_type == sint_pop_group_up
						and sint_pop_move_vertical_up_speed_y_px_per_second
						or sint_pop_move_vertical_down_speed_y_px_per_second
					self.motion:set_velocity_pixels_per_second(
						sint_pop_move_to_player_speed_x_px_per_second,
						velocity_y
					)
				end,
				update = sint_pop.update_move_vertical,
			},
			move_away_from_player = {
				entering_state = function(self)
					self.motion:set_velocity_pixels_per_second(
						sint_pop_move_away_speed_x_px_per_second,
						0
					)
				end,
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
			fixed_point_velocity_component.new,
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
