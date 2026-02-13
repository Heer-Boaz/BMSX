local constants = require('constants')
local eventemitter = require('eventemitter')

local room_view = {}
room_view.__index = room_view

local function render_elevators(room_number, elevator_routes)
	for i = 1, #elevator_routes do
		local elevator = elevator_routes[i]
		if elevator.current_room_number == room_number then
			put_sprite('elevator_platform', elevator.x, elevator.y, 21)
		end
	end
end

function room_view:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_room()
	end
end

function room_view:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			self.space_id = event.space
		end,
	})
end

function room_view:ctor()
	self:bind_visual()
	self:bind_events()
end

function room_view:render_room()
	local castle_service = service(constants.ids.castle_service_instance)
	local room = castle_service.current_room
	if get_space() ~= room.space_id then
		return
	end

	local tile_size = room.tile_size
	local origin_x = room.tile_origin_x
	local origin_y = room.tile_origin_y

	for y = 1, room.tile_rows do
		local draw_y = origin_y + ((y - 1) * tile_size)
		local row = room.tiles[y]
		for x = 1, room.tile_columns do
			local draw_x = origin_x + ((x - 1) * tile_size)
			put_sprite(row[x], draw_x, draw_y, 20)
		end
	end

	local elevator_service = service(constants.ids.elevator_service_instance)
	render_elevators(castle_service.current_room_number, elevator_service.elevator_routes)
end

local function define_room_view_fsm()
	define_fsm(constants.ids.room_view_fsm, {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_room_view_definition()
	define_prefab({
		def_id = constants.ids.room_view_def,
		class = room_view,
		fsms = { constants.ids.room_view_fsm },
		components = { 'customvisualcomponent' },
		defaults = {
			tick_enabled = false,
		},
	})
end

return {
	room_view = room_view,
	define_room_view_fsm = define_room_view_fsm,
	register_room_view_definition = register_room_view_definition,
	room_view_def_id = constants.ids.room_view_def,
	room_view_instance_id = constants.ids.room_view_instance,
	room_view_fsm_id = constants.ids.room_view_fsm,
}
