local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local elevatorsystem<const> = {}
elevatorsystem.__index = elevatorsystem
setmetatable(elevatorsystem, { __index = basesystem })

function elevatorsystem:update()
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

function elevatorsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.gameplay, 20), elevatorsystem)
	self._definition_view = world:active_definition_view('elevator_platform')
	return self
end

return elevatorsystem
