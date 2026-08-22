local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

local explosion_image_by_pose<const> = {
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
}

__bmsx_host_test = {
	phase = 'spawn',
	frame_count = 0,
}

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
end

function __bmsx_host_test.setup()
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frame_count = test.frame_count + 1
	assert(test.frame_count < 180, 'MSX timing scenario timed out phase=' .. test.phase)

	if test.phase == 'spawn' then
		local castle<const> = registry:get('c')
		world:set_space('main')
		world:set_gameplay_clock_running(true)
		world:spawn('enemy_explosion', {
			id = 'probe.enemy_explosion',
			space_id = 'main',
			room = registry:get('room'),
			player = registry:get('pietolon'),
			pos = { x = 40, y = 40, z = 113 },
		})
		world:spawn('world_entrance', {
			id = 'probe.world_entrance',
			space_id = 'main',
			castle = castle,
			target = 'probe_world',
			pos = { x = 80, y = 80, z = 22 },
		})
		test.phase = 'admission'
		return false
	end

	local explosion<const> = registry:get('probe.enemy_explosion')
	local entrance<const> = registry:get('probe.world_entrance')
	if test.phase == 'admission' then
		if explosion == nil or entrance == nil then
			return false
		end
		local castle<const> = registry:get('c')
		castle.world_entrance_states.probe_world = { state = 'closed' }
		castle:begin_open_world_entrance('probe_world')
		test.gameplay_time_ms = world.gameplay_time_ms
		test.gameplay_step = 0
		test.phase = 'timing'
		return false
	end

	if world.gameplay_time_ms == test.gameplay_time_ms then
		return false
	end
	test.gameplay_time_ms = world.gameplay_time_ms
	test.gameplay_step = test.gameplay_step + 1
	local step<const> = test.gameplay_step

	if explosion ~= nil then
		local admitted_source_update<const> = step + 1
		local pose<const> = admitted_source_update // enemy_explosion_pose_frames + 1
		assert(explosion.sprite_component.imgid == explosion_image_by_pose[pose],
			'enemy explosion left its three-update pose at step=' .. step)
	else
		assert(step == enemy_explosion_pose_frames * #explosion_image_by_pose - 1,
			'enemy explosion completed outside its eight three-update poses at step=' .. step)
	end

	local phase_frames<const> = world_entrance_open_phase_frames
	if step < phase_frames then
		assert(entrance.entrance_state == 'opening_1',
			'world entrance left opening state 1 before six updates')
	elseif step < phase_frames * 2 then
		assert(entrance.entrance_state == 'opening_2',
			'world entrance did not retain opening state 2 for six updates')
	elseif step < phase_frames * 3 then
		assert(entrance.entrance_state == 'opening_3',
			'world entrance did not retain opening state 3 for six updates')
	else
		assert(entrance.entrance_state == 'open',
			'world entrance did not admit entry after all three opening phases')
	end

	return explosion == nil and entrance.entrance_state == 'open'
end
