-- The same poses run against the pre-migration ROM for scanout comparison.
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local rooms<const> = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110 }
__bmsx_host_test = { index = 0, ticks = 0 }
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup() registry:get('d').request_new_game() end
function __bmsx_host_test.update()
	if world.active_space_id ~= 'main' then return false end
	local test<const> = __bmsx_host_test
	if test.ticks == 0 then
		test.index = test.index + 1
		if test.index > #rooms then return true end
		local castle<const> = registry:get('c')
		local room = registry:get('c').room
		local from<const> = castle.current_room_number
		local target<const> = rooms[test.index]
		world:set_gameplay_clock_running(false)
		room = castle:load_room(target)
		castle:commit_room_switch({ from_room_number = from, to_room_number = target, direction = 'right' }, room.world_number, 5, 12)
		room.player.x = 16
		room.player.y = 96
		assert(room.room_tile_layer.visible, 'fresh room must render immediately, even while gameplay is paused')
	end
	test.ticks = test.ticks + 1
	if test.ticks == 6 then
		test.ticks = 0
		return host.capture('room-' .. tostring(rooms[test.index]))
	end
	return false
end
