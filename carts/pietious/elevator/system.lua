local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local elevator_system<const> = {}
elevator_system.__index = elevator_system
setmetatable(elevator_system, { __index = base_system })
elevator_system.tick = {
	group = tick_group.gameplay,
	priority = 20,
	clock_source = clock.gameplay,
	method = 'update',
}

function elevator_system:update()
	local elevators<const> = self._definition_view.objects
	local elevator_count<const> = #elevators
	if elevator_count == 0 then
		return
	end
	local player<const> = elevators[1].player
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	for i = 1, elevator_count do
		elevators[i]:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

function elevator_system.new(world)
	local self<const> = setmetatable(base_system.new(elevator_system.tick), elevator_system)
	self._definition_view = world:active_definition_view('elevator_platform')
	return self
end

return elevator_system
