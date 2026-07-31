local ecs<const> = require('cartlib/ecs/index')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup

local elevator_update_system<const> = {}
elevator_update_system.__index = elevator_update_system

function elevator_update_system:update()
	local player<const> = world_instance:get('pietolon')
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	for elevator in world_instance:objects_by_type('elevator_platform') do
		elevator:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

function elevator_update_system.new(priority)
	return setmetatable({
		group = tickgroup.moderesolution,
		priority = priority,
	}, elevator_update_system)
end

return {
	elevator_update_system = elevator_update_system,
}
