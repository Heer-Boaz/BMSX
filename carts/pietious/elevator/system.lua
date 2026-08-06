local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local elevatorsystem<const> = {}
elevatorsystem.__index = elevatorsystem
setmetatable(elevatorsystem, { __index = basesystem })

function elevatorsystem:update()
	local world<const> = self.world
	local player<const> = world:get('pietolon')
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	local elevators<const> = self._definition_view.items
	for i = 1, #elevators do
		elevators[i]:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

function elevatorsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.gameplay, 20), elevatorsystem)
	self.world = world
	self._definition_view = world:_active_definition_view('elevator_platform')
	return self
end

return elevatorsystem
