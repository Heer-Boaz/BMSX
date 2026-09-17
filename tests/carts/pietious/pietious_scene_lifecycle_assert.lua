local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local scene_library<const> = require('cartlib/world/scene_library')
local castle_map<const> = require('castle/map')
local progression<const> = require('cartlib/progression')

__bmsx_host_test = { phase = 0 }
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup() registry:get('d').request_new_game() end

function __bmsx_host_test.update()
	if world.active_space_id ~= 'main' then return false end
	local test<const> = __bmsx_host_test
	local castle<const> = registry:get('c')
	local room = castle.room
	if test.phase == 0 then
		local ids<const> = {}
		local count = 0
		for _, template in pairs(castle_map.definition.rooms) do
			local members<const> = scene_library.definition(template.scene_id).objects
			for i = 1, #members do
				local member<const> = members[i]
				assert(not ids[member.member_id], 'persistence keys must identify one authored placement')
				ids[member.member_id] = true
				count = count + 1
				assert(member.progression_filter == nil, 'compiled progression mutated scene source')
				assert(member.options.room == nil and member.options.player == nil,
					'admission leaked runtime bindings into authored options')
			end
		end
		assert(count == 122, 'all 122 placements must be authored scene members')
		test.room = room
		test.player = room.player
		castle:switch_room('right', 0, 0)
		room = castle.room
		test.phase = 1
	elseif test.phase == 1 then
		local members<const> = scene_library.definition('pietious.room_002').objects
		assert(room.enemies[1] == members[1] and room.rocks[2] == members[5],
			'room indices must reference the canonical scene members')
		test.enemy = registry:get('c').room.scene.members['enemy_002_01']
		test.rock = registry:get('c').room.scene.members['rock_002_02']
		test.room2 = room
		room.player.status.inventory_items.schoentjes = false
		test.rock.events:emit('break')
		test.phase = 2
	elseif test.phase == 2 then
		local drop<const> = registry:get('c').room.scene.members['drop.rock_002_02']
		assert(drop ~= nil, 'destroying the authored rock must still create its procedural drop')
		room.player:collect_item(drop.item_type, drop.item_id)
		drop:on_collected()
		assert(progression.get(castle, 'item_picked_drop.rock_002_02'), 'pickup must remain castle progression')
		castle:switch_room('right', 0, 0)
		room = castle.room
		test.phase = 3
	elseif test.phase == 3 then
		assert(registry:get(test.enemy.id) == nil and test.enemy.marked_for_disposal,
			'room departure must dispose its scene actors')
		castle:switch_room('left', 0, 0)
		room = castle.room
		test.phase = 4
	else
		assert(room ~= test.room and room ~= test.room2 and room.player == test.player,
			'room reentry must construct a new room while the travelling player stays alive')
		assert(test.room.world == nil and test.room2.world == nil
			and #test.room2.scene.objects.items == 0, 'departed room retained runtime state or actors')
		assert(room.player.status == castle.session.player
			and room.player.status.inventory_items.schoentjes and room.progress.destroyed_rocks[test.rock.scene_member_id],
			'room reentry lost collected items or destroyed terrain')
		assert(registry:get(test.rock.id) == nil and registry:get('c').room.scene.members['drop.rock_002_02'] == nil,
			'room reentry resurrected the rock or its collected item')
		local enemy<const> = room.scene.members[test.enemy.scene_member_id]
		assert(enemy ~= nil and enemy ~= test.enemy, 'ordinary enemies must receive a fresh room instance')
		local authored<const> = room.enemies[1].options
		assert(authored.pos.x == 112 and authored.pos.y == 56 and authored.room == nil,
			'instance motion or reentry mutated authored placement')
		return true
	end
	return false
end
