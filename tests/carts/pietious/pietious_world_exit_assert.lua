local castle_map<const> = require('castle/map')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	phase = 'setup',
	frames = 0,
}

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get('d')
	director.state_machines:transition_to('/room')
	world:set_space('main')
	world:set_gameplay_clock_running(true)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 600, 'world exit timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.banner_state = director.state_machines:bind_state_path(
			'/world_transition/castle_emerge_showing'
		)
		test.emerge_state = director.state_machines:bind_state_path('/world_transition/emerge')
		test.wait_state = player.state_machines:bind_state_path('/waiting_world_emerge')
		test.emerging_state = player.state_machines:bind_state_path('/emerging_world')
		test.quiet_state = player.state_machines:bind_state_path('/quiet')
	end

	if test.phase == 'setup' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end

		local transition<const> = castle_map.world_transitions.world_1
		local switch<const> = castle:enter_world(transition.target)
		player:apply_spawn_position(switch)
		player.state_machines:transition_to('/quiet')
		castle:emit_room_enter()
		assert(player:switch_room('right', false), 'world exit was not accepted')
		assert(castle.current_room_number == transition.castle_room_number,
			'world exit did not load the castle room')
		assert(room.world_number == 0 and room.map_id == 0,
			'world exit retained the world map')
		test.phase = 'transition'
		return false
	end

	local sprite<const> = player.sprite_component
	if director.state_machines:matches_state(test.banner_state) then
		test.saw_banner = true
		assert(player.state_machines:matches_state(test.wait_state),
			'player did not wait during the castle banner')
		assert(not world.gameplay_clock_running,
			'gameplay advanced during the castle banner')
	end

	if director.state_machines:matches_state(test.emerge_state) then
		test.saw_emerge_state = true
	end

	if player.state_machines:matches_state(test.emerging_state) then
		test.saw_emerging = true
		assert(world.active_space_id == 'main',
			'player emergence did not render in the main space')
		assert(not world.gameplay_clock_running,
			'gameplay advanced during the player emergence')
		local emergence<const> = player.timelines:get('p.tl.wx')
		if emergence.head == 0 then
			assert(sprite.visible and sprite.region_height == 1,
				'world emergence retained a hidden pre-roll after the castle banner')
			test.saw_first_emerge_sample = true
		end
		if sprite.region_height ~= nil
		and sprite.region_height > 0
		and sprite.region_height < player.height then
			test.saw_partial_player = true
		end
	end

	if test.phase == 'transition'
	and test.saw_emerging
	and director.state_machines:matches_state(test.room_state)
	and player.state_machines:matches_state(test.quiet_state) then
		assert(test.saw_banner, 'castle banner state was skipped')
		assert(test.saw_emerge_state, 'director emergence state was skipped')
		assert(test.saw_first_emerge_sample,
			'world emergence did not publish its first scanline sample')
		assert(test.saw_partial_player, 'player scanline emergence was not presented')
		assert(world.gameplay_clock_running, 'gameplay did not resume after world exit')
		assert(world.active_space_id == 'main', 'main space was not restored')
		assert(not castle.room_enter_pending, 'castle room entry was not published')
		assert(sprite.visible and sprite.region_width == nil,
			'player presentation remained clipped or hidden')
		test.phase = 'control'
		test.control_frames = 0
		return host.down('ArrowRight')
	end

	if test.phase == 'control' then
		if player.right_held then
			return { up = 'ArrowRight', done = true }
		end
		test.control_frames = test.control_frames + 1
		assert(test.control_frames < 10,
			'player did not receive fresh gameplay input after world exit')
	end
	return false
end
