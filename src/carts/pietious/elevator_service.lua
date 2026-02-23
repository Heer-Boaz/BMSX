local constants = require('constants')
local castle_map = require('castle_map')

local elevator_service = {}

local function build_elevator_routes()
	local route_specs = castle_map.elevator_routes
	local routes = {}
	for i = 1, #route_specs do
		local spec = route_specs[i]
		local path = {}
		for j = 1, #spec.path do
			local point = spec.path[j]
			path[j] = {
				room_number = point.room_number,
				x = point.x,
				y = point.y,
			}
		end
		local start_point = path[1]
		routes[i] = {
			current_room_number = start_point.room_number,
			x = start_point.x,
			y = start_point.y,
			path = path,
			vertical_to_point = spec.vertical_to_point,
			going_to = spec.going_to,
		}
	end
	return routes
end

local function move_elevator_vertical(elevator, target, vertical, character_over, player)
	local top_boundary = constants.room.hud_height + constants.room.tile_size
	local top = elevator.y - constants.player.height

	if vertical == 'down' then
		if character_over and player.y == top then
			player.y = player.y + 2
		end
		elevator.y = elevator.y + 2
		if elevator.y > constants.room.height then
			elevator.y = top_boundary
			elevator.current_room_number = target.room_number
		end
		if character_over then
			player.on_vertical_elevator = true
		end
		return
	end

	if character_over and player.y == top then
		player.y = player.y - 2
	end
	elevator.y = elevator.y - 2
	if elevator.y < top_boundary then
		elevator.y = constants.room.height - constants.room.tile_size
		elevator.current_room_number = target.room_number
	end
	if character_over then
		player.on_vertical_elevator = true
	end
end

function elevator_service:tick()
	local player = object('pietolon')
	player.on_vertical_elevator = false

	local current_room = service('c').current_room
	local map_id = current_room.map_id
	local current_room_number = current_room.room_number

	for i = 1, #self.elevator_routes do
		local elevator = self.elevator_routes[i]
		local character_over

		if map_id == 0
			and current_room_number == elevator.current_room_number
			and player.y >= (elevator.y - constants.room.tile_size2)
			and player.y < (elevator.y + constants.room.tile_size2)
		then
			if player.x > (elevator.x - constants.room.tile_size2)
				and player.x < (elevator.x + constants.room.tile_size4)
				and player:has_tag('g.et')
			then
				character_over = true
			end
			if player.x > (elevator.x - (constants.room.tile_size2 - 5))
				and player.x < ((elevator.x + constants.room.tile_size4) - constants.room.tile_half)
			then
				character_over = true
			end
		end

		local target = elevator.path[elevator.going_to]
		local vertical = elevator.vertical_to_point[elevator.going_to]

		if elevator.x < target.x then
			elevator.x = elevator.x + 2
			if character_over then
				player.x = player.x + 2
			end
		end
		if elevator.x > target.x then
			elevator.x = elevator.x - 2
			if character_over then
				player.x = player.x - 2
			end
		end

		move_elevator_vertical(elevator, target, vertical, character_over, player)

			if elevator.x == target.x
				and elevator.y == target.y
				and elevator.current_room_number == target.room_number
			then
				if elevator.going_to == 1 then
					elevator.going_to = 2
				else
				elevator.going_to = 1
			end
		end
	end
end

local function define_elevator_service_fsm()
	define_fsm('elevator_service', {
		initial = 'active',
		states = {
			active = {
				tick = elevator_service.tick,
			},
		},
	})
end

local function register_elevator_service_definition()
	local elevator_routes = build_elevator_routes()
	define_service({
		def_id = 'elevator',
		class = elevator_service,
		fsms = { 'elevator_service' },
		defaults = {
			id = 'e',
			elevator_routes = elevator_routes,
			tick_enabled = true,
		},
	})
end

return {
	define_elevator_service_fsm = define_elevator_service_fsm,
	register_elevator_service_definition = register_elevator_service_definition,
}
