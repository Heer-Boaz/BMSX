local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')
local castle_map<const> = require('castle/map')
local castle_module<const> = require('castle/castle')

__bmsx_host_test = { phase = 0 }
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup()
	assert(registry:get('d'):reload_room() == 'Return to room gameplay before reloading its scene.',
		'intro reload must not replace a room owned by another flow')
	registry:get('d').request_new_game()
end
function __bmsx_host_test.update()
	if world.active_space_id ~= 'main' then return false end
	local test<const> = __bmsx_host_test
	local castle<const> = registry:get('c')
	if test.phase == 0 then
		castle:switch_room('right', 0, 0)
		test.phase = 1
		return false
	end
	local previous<const> = castle.room
	local old_scene<const> = previous.scene
	local old_level<const> = castle.level
	local player<const> = castle.player
	local session<const> = castle.session
	local x<const>, y<const> = player.x, player.y
	local map_x<const>, map_y<const> = previous.map_x, previous.map_y
	local state<const> = session.progression
	session.player.health = 13
	session.player.inventory_items.schoentjes = true
	previous.progress.destroyed_rocks.rock_002_02 = true
	progression.set(castle, 'item_picked_drop.rock_002_02', true)
	local enemy<const> = old_scene.members.enemy_002_01
	local rock<const> = old_scene.members.rock_002_01
	-- Repeat the same definition registration performed by <init> at Hot Resume.
	castle_map.initialize()
	castle_map.definition.rooms[2].rocks[1].options.pos.x = 120
	castle_module.register_castle_definition()
	assert(castle.level == old_level and old_level ~= castle_module.castle.level,
		'registration changed the active controller revision')
	assert(previous.enemies[1] == old_level.map.rooms[2].enemies[1]
		and old_scene.definition == old_level.map.rooms[2].scene_definition,
		'old scene mixes different definition revisions')
	assert(progression.matches(castle, old_level.filters[previous.enemies[1]]), 'old conditions became unreadable after registration')
	assert(rock.x == 104 and previous.rocks[1].options.pos.x == 104, 'registration mutated an existing scene')
	assert(registry:get('d'):reload_room() == 'Room reloaded; game progress and player position retained.', 'reload method refused settled gameplay')
	local room<const> = castle.room
	assert(room ~= previous and previous.world == nil and #old_scene.objects.items == 0 and old_scene.closed,
		'outgoing room/scene was retained')
	assert(enemy.world == nil and rock.world == nil and room.scene.members.enemy_002_01 ~= enemy,
		'reload did not reconstruct transient actors')
	assert(room.scene.members.rock_002_01.x == 120, 'reload ignored the latest authored placement')
	assert(castle.level == castle_module.castle.level and room.template == castle.level.map.rooms[2], 'reload retained the old definition')
	assert(castle.session == session and session.progression == state and castle.player == player and player.room == room,
		'reload replaced the session or travelling player')
	assert(player.x == x and player.y == y and room.map_x == map_x and room.map_y == map_y, 'reload moved the player or map position')
	assert(player.status.health == 13 and player.status.inventory_items.schoentjes
		and progression.get(castle, 'item_picked_drop.rock_002_02') and room.progress.destroyed_rocks.rock_002_02,
		'reload reset player or room progress')
	assert(room.scene.members.rock_002_02 == nil and room.scene.members['drop.rock_002_02'] == nil,
		'reload resurrected collected terrain')
	assert(room.tiles_visible and room.room_tile_count > 0, 'reconstructed room is invisible')
	-- Repeated reload does not accumulate actors or subscriptions.
	local count<const> = #room.scene.objects.items
	registry:get('d'):reload_room()
	assert(#room.scene.objects.items == 0 and #castle.room.scene.objects.items == count, 'repeated reload leaked members')
	return true
end
