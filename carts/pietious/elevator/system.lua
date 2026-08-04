local ecs<const> = require('cartlib/ecs')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group

local elevator_system<const> = {}
elevator_system.__index = elevator_system

function elevator_system:update()
	local player<const> = world:get('pietolon')
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	for elevator in world:objects_by_type('elevator_platform') do
		elevator:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

function elevator_system.new(priority)
	return setmetatable({
		group = tick_group.gameplay,
		priority = priority or 20,
	}, elevator_system)
end

return elevator_system.new
