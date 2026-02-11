local constants = require('constants.lua')
local castle_map = require('castle_map.lua')

local elevator_service = {}

local function build_elevator_routes()
	local route_specs = castle_map.elevator_routes()
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
			player.y = player.y + constants.room.tile_unit
		end
		elevator.y = elevator.y + constants.room.tile_unit
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
		player.y = player.y - constants.room.tile_unit
	end
	elevator.y = elevator.y - constants.room.tile_unit
	if elevator.y < top_boundary then
		elevator.y = constants.room.height - constants.room.tile_size
		elevator.current_room_number = target.room_number
	end
	if character_over then
		player.on_vertical_elevator = true
	end
end

function elevator_service:tick()
	local player = object(constants.ids.player_instance)
	player.on_vertical_elevator = false

	local castle_service = service(self.castle_service_id)
	local map_id = castle_service.map_id
	local current_room_number = castle_service.current_room_number

	for i = 1, #self.elevator_routes do
		local elevator = self.elevator_routes[i]
		local character_over = false

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
			elevator.x = elevator.x + constants.room.tile_unit
			if character_over then
				player.x = player.x + constants.room.tile_unit
			end
		end
		if elevator.x > target.x then
			elevator.x = elevator.x - constants.room.tile_unit
			if character_over then
				player.x = player.x - constants.room.tile_unit
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
	define_fsm(constants.ids.elevator_service_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function()
					return '/active'
				end,
			},
			active = {
				tick = elevator_service.tick,
			},
		},
	})
end

local function register_elevator_service_definition()
	local elevator_routes = build_elevator_routes()
	define_service({
		def_id = constants.ids.elevator_service_def,
		class = elevator_service,
		fsms = { constants.ids.elevator_service_fsm },
		defaults = {
			id = constants.ids.elevator_service_instance,
			castle_service_id = constants.ids.castle_service_instance,
			elevator_routes = elevator_routes,
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	define_elevator_service_fsm = define_elevator_service_fsm,
	register_elevator_service_definition = register_elevator_service_definition,
	elevator_service_def_id = constants.ids.elevator_service_def,
	elevator_service_instance_id = constants.ids.elevator_service_instance,
	elevator_service_fsm_id = constants.ids.elevator_service_fsm,
}
