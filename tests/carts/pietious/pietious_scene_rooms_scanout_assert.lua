local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local rooms<const> = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110 }
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		scene_rooms_scanout = function(t)
			fixture.start_game(t)
			for index = 1, #rooms do
				local castle<const> = registry:get('c')
				local room = registry:get('c').room
				local from<const> = castle.current_room_number
				local target<const> = rooms[index]
				world:set_gameplay_clock_running(false)
				room = castle:load_room(target)
				castle:commit_room_switch({ from_room_number = from, to_room_number = target, direction = 'right' }, room.world_number, 5, 12)
				room.player:set_global_position(16, 96)
				assert(room.room_tile_layer.visible, 'fresh room must render immediately, even while gameplay is paused')
				t:wait_ticks(5)
				t:capture('room-' .. tostring(rooms[index]))
			end
			local castle<const> = registry:get('c')
			local from<const> = castle.current_room_number
			local wet<const> = castle:load_room(8)
			castle:commit_room_switch({ from_room_number = from, to_room_number = 8, direction = 'right' }, wet.world_number, 5, 12)
			wet.player:set_global_position(16, 96)
			local surface<const> = wet.last_water_surface_frame
			world:set_gameplay_clock_running(true)
			t:wait_until('wet room animation after resuming gameplay', function()
				return wet.last_water_surface_frame ~= surface
			end, 12)
		end,
	},
}
