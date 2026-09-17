local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local scene_library<const> = require('cartlib/world/scene_library')
local progression<const> = require('cartlib/progression')

__bmsx_host_test = {}
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup()
	local old_castle<const> = registry:get('c')
	local old_player<const> = old_castle.player
	local old_room<const> = old_castle.room
	local session<const> = old_castle.session
	session.player.health = 13
	session.player.weapon_level = 1
	session.player.inventory_items.schoentjes = true
	old_player:equip_subweapon('pepernoot')
	session.rooms['pietious.room_002'].destroyed_rocks.rock_002_02 = true
	progression.set(old_castle, 'item_picked_drop.rock_002_02', true)
	world:clear()
	assert(old_castle.world == nil and old_player.world == nil and old_room.world == nil,
		'World clear retained an actor from the old game composition')
	assert(#old_player.scene.objects.items == 0 and #old_room.scene.objects.items == 0,
		'parent teardown retained gameplay or room membership')

	-- Rebuild the actual prefabs against the retained model. No field copying
	-- from the old player/room and no replay of pickup/damage events is allowed.
	local scene<const> = scene_library.create('pietious.gameplay')
	local castle<const> = scene:spawn('castle', { id = 'c', session = session })
	local player<const> = scene:spawn_member(scene.definition.objects[1], { castle = castle, status = session.player })
	castle.player = player
	castle:initialize(2)
	assert(player ~= old_player and castle.room ~= old_room and player.status == session.player,
		'actor reconstruction reused the outgoing object graph')
	assert(player.status.health == 13 and player.status.weapon_level == 1
		and player.status.inventory_items.schoentjes and player.status.secondary_weapon == 'pepernoot',
		'player construction reset the session loadout or health')
	assert(progression.get(castle, 'item_picked_drop.rock_002_02')
		and castle.room.scene.members.rock_002_02 == nil
		and castle.room.scene.members['drop.rock_002_02'] == nil,
		'controller reconstruction lost progression or recreated collected terrain')
	local rebuilt_room<const> = castle.room
	scene:dispose()
	assert(castle.world == nil and player.world == nil and rebuilt_room.world == nil
		and #rebuilt_room.scene.objects.items == 0,
		'gameplay scene disposal failed to unload its owned room')
	new_game()
	local fresh<const> = registry:get('c').session
	assert(fresh ~= session and fresh.player ~= session.player and fresh.player.health == fresh.player.max_health
		and next(fresh.rooms['pietious.room_002'].destroyed_rocks) == nil,
		'New Game did not replace persistent state')
	assert(session.player.health == 13, 'New Game mutated an unrelated session model')
end
function __bmsx_host_test.update() return true end
