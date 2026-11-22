local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')
require('constants')

local flight_system<const> = {}
flight_system.__index = flight_system
setmetatable(flight_system, { __index = base_system })
flight_system.tick = {
	group = tick_group.gameplay,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}

function flight_system.new(world)
	local self<const> = setmetatable(base_system.new(flight_system.tick), flight_system)
	self._formation_members = world:active_definition_view(ids_sint_pop_def)
	return self
end

function flight_system:update()
	local members<const> = self._formation_members.objects
	for index = 1, #members do
		local foe<const> = members[index]
		local x<const> = foe:get_global_position()
		local phase<const> = foe.flight_phase
		-- One position-triggered phase change per gameplay step. The velocity
		-- system remains responsible for the subsequent movement and fractions.
		if phase == sint_pop_flight_approach then
			if x <= sint_pop_vertical_start_x then
				foe.flight_phase = sint_pop_flight_vertical
				local vy<const> = foe.group_type == sint_pop_group_up
					and sint_pop_move_vertical_up_speed_y_px_per_second
					or sint_pop_move_vertical_down_speed_y_px_per_second
				foe.motion:set_velocity_pixels_per_second(sint_pop_move_to_player_speed_x_px_per_second, vy)
			end
		elseif phase == sint_pop_flight_vertical then
			if x <= sint_pop_retreat_start_x then
				foe.flight_phase = sint_pop_flight_retreat
				foe.motion:set_velocity_pixels_per_second(sint_pop_move_away_speed_x_px_per_second, 0)
			end
		elseif x > playfield_width then
			foe:mark_for_disposal()
		end
	end
end

return flight_system
