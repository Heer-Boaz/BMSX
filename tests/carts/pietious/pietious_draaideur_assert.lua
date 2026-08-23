local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')

local selected_apu_source<const>: *word = 0x0800018c
local rotatedoor_source_address<const> = rom_dir.audio('rotatedoor').addr

local player<const> = {
	x = 0,
	y = 64,
	width = 16,
	height = 16,
	walking_right = false,
	doorpass_count = 0,
}

function player:has_tag(tag)
	return self.walking_right and tag == 'v.wr'
end

function player:start_slow_doorpass()
	self.doorpass_count = self.doorpass_count + 1
end

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
	gameplay_steps = 0,
}

function __bmsx_host_test.setup()
	registry:get('d').request_new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 180, 'draaideur scenario timed out phase=' .. test.phase)

	if test.phase == 'spawn' then
		local door_x<const> = 128
		player.x = door_x - player.width + 1
		world:spawn('draaideur', {
			id = 'probe.draaideur',
			space_id = 'main',
			castle = registry:get('c'),
			player = player,
			pos = { x = door_x, y = player.y, z = 22 },
		})
		test.phase = 'admission'
		return false
	end

	local door<const> = registry:get('probe.draaideur')
	if door == nil then
		return false
	end
	if test.opening_state == nil then
		test.opening_state = door.state_machines:bind_state_path('/opening_rightward')
		test.active_state = door.state_machines:bind_state_path('/active')
	end

	if test.phase == 'admission' then
		assert(door.state_machines:matches_state(test.active_state),
			'draaideur did not enter its active state')
		assert(door.collision_enabled, 'closed draaideur did not block room collision')
		assert(door.sprite_component.imgid == 'draaideur_1_closed',
			'draaideur did not begin in its closed pose')
		player.walking_right = true
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'pushing'
		return false
	end

	if world.gameplay_time_ms == test.gameplay_time_ms then
		return false
	end
	test.gameplay_time_ms = world.gameplay_time_ms
	test.gameplay_steps = test.gameplay_steps + 1
	local step<const> = test.gameplay_steps

	if step < draaideur_push_steps then
		assert(door.state_machines:matches_state(test.active_state),
			'draaideur opened before the 0x1e-update push boundary')
		assert(door.collision_enabled, 'draaideur released collision while still closed')
		return false
	end

	if step == draaideur_push_steps then
		assert(door.state_machines:matches_state(test.opening_state),
			'draaideur did not open at the 0x1e-update push boundary')
		assert(not door.collision_enabled, 'opening draaideur retained room collision')
		assert(player.doorpass_count == 1, 'draaideur did not admit exactly one player passage')
		assert(*selected_apu_source == rotatedoor_source_address,
			'draaideur admission did not select its authored sound')
		assert(door.sprite_component.imgid == 'draaideur_1_closed',
			'draaideur rotated before its first six-update phase elapsed')
		return false
	end

	local opening_step<const> = step - draaideur_push_steps
	if opening_step < draaideur_pose_steps then
		assert(door.sprite_component.imgid == 'draaideur_1_closed',
			'draaideur left its closed pose before six updates')
		return false
	end
	if opening_step < draaideur_pose_steps * 2 then
		assert(door.sprite_component.imgid == 'draaideur_1_open_1',
			'draaideur selected the wrong first rightward pose')
		return false
	end
	if opening_step < draaideur_pose_steps * 3 then
		assert(door.sprite_component.imgid == 'draaideur_1_open_2',
			'draaideur selected the wrong middle pose')
		return false
	end
	if opening_step < draaideur_pose_steps * 4 then
		assert(door.sprite_component.imgid == 'draaideur_1_open_3',
			'draaideur selected the wrong final rightward pose')
		return false
	end

	assert(door.state_machines:matches_state(test.active_state),
		'draaideur did not return to its active state after four poses')
	assert(door.collision_enabled, 'closed draaideur did not restore room collision')
	assert(door.sprite_component.imgid == 'draaideur_1_closed',
		'draaideur did not restore its closed pose')
	return true
end
