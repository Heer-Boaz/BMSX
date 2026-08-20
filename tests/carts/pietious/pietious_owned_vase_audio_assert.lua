local combat_damage<const> = require('combat/damage')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	frames = 0,
	phase = 'start',
	appearance_count = 0,
}

local record_appearance<const> = function(test)
	test.appearance_count = test.appearance_count + 1
end

function __bmsx_host_test.setup()
	new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 120, 'owned green vase scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	if test.phase == 'start' then
		castle.events:on({
			event = 'appearance',
			subscriber = test,
			handler = record_appearance,
		})
		assert(room.player.inventory_items.greenvase, 'debug loadout does not own the green vase')
		castle:switch_room('up', 0, 0)
		test.phase = 'room_6'
		return false
	end

	if test.phase == 'room_6' then
		assert(room.room_number == 6, 'owned green vase scenario did not enter room 6')
		castle:switch_room('up', 0, 0)
		test.phase = 'destroy_cloud'
		return false
	end

	if test.phase == 'destroy_cloud' then
		assert(room.room_number == 13, 'owned green vase scenario did not enter room 13')
		local cloud_def<const> = room.enemies[1]
		assert(cloud_def.kind == 'cloud', 'room 13 cloud definition is missing')
		local cloud<const> = registry:get(cloud_def.id)
		assert(cloud ~= nil, 'room 13 cloud did not spawn')
		cloud.health = 1
		local result<const> = combat_damage.resolve(cloud, combat_damage.build_weapon_request(
			cloud,
			cloud.enemy_kind,
			{ other_id = 'test.sword' },
			'sword'
		))
		cloud:process_damage_result(result)
		assert(progression.get(castle, 'cloud_1_destroyed'), 'cloud defeat did not retain its condition')
		test.vase_id = room.items[1].id
		test.phase = 'verify'
		return false
	end

	assert(registry:get(test.vase_id) == nil, 'owned green vase was spawned again')
	assert(test.appearance_count == 0, 'owned green vase emitted a false reveal cue')
	return true
end
