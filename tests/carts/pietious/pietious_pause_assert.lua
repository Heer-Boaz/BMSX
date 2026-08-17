local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
		and registry:get('room') ~= nil
		and registry:get('pietolon') ~= nil
		and registry:get('d') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1500, 'pause scenario timed out phase=' .. test.phase)

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.room_state == nil then
		test.room_state = director.state_machines:bind_state_path('/room')
		test.pause_state = director.state_machines:bind_state_path('/pause')
		test.quiet_state = player.state_machines:bind_state_path('/quiet')
	end

	if test.pause_started and director.state_machines:matches_state(test.pause_state) then
		assert(world.active_space_id == 'main', 'pause changed the active room space')
		assert(not world.gameplay_clock_running, 'gameplay clock advanced during pause')
		assert(player.state_machines:matches_state(test.quiet_state),
			'pause replaced the retained player gameplay state')
		assert(player.x == test.player_x and player.y == test.player_y,
			'player moved while gameplay was paused')
		local enemy<const> = registry:get('probe.pause.enemy')
		assert(enemy ~= nil, 'enemy was disposed while gameplay was paused')
		assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y,
			'enemy moved while gameplay was paused')
		local projectile<const> = registry:get('probe.pause.projectile')
		assert(projectile ~= nil, 'projectile was disposed while gameplay was paused')
		assert(projectile.x == test.projectile_x and projectile.y == test.projectile_y,
			'projectile moved while gameplay was paused')
		assert(player.visible, 'pause presentation hid the player')
		assert(player.sprite_component.color == 0xffffffff,
			'pause presentation retained a gameplay color modifier')
		assert(player.sprite_component.scale_x == 1 and player.sprite_component.scale_y == 1,
			'pause presentation retained gameplay scaling')
		assert(not player.sprite_component.flip_h,
			'pause presentation retained gameplay horizontal mirroring')
		assert(player.sprite_component.offset_x == -2 and player.sprite_component.offset_y == -8,
			'pause presentation used the wrong MSX sprite offset')
		assert(not player.sword_sprite.enabled, 'sword remained visible during pause')
	end

	if test.phase == 'setup' then
		if world.active_space_id ~= 'main'
		or not director.state_machines:matches_state(test.room_state) then
			return false
		end
		player.state_machines:transition_to('/quiet')
		player:clear_input_state()
		player:zero_motion()
		player:cancel_sword()
		player.facing = -1
		player.x = 32
		player.y = 152
		player:apply_presentation_state()
		world:spawn('enemy.crossfoe', {
			id = 'probe.pause.enemy',
			space_id = 'main',
			castle = castle,
			room = room,
			player = player,
			pos = { x = 160, y = 96, z = 110 },
		}).cross_state = 'flying_right'
		world:spawn('pepernoot_projectile', {
			id = 'probe.pause.projectile',
			space_id = 'main',
			room = room,
			room_number = castle.current_room_number,
			owner_id = player.id,
			direction = 1,
			pos = { x = 64, y = 64, z = 113 },
		})
		test.phase = 'admission'
		return false
	end

	if test.phase == 'admission' then
		if registry:get('probe.pause.enemy') == nil
		or registry:get('probe.pause.projectile') == nil then
			return false
		end
		assert(player.state_machines:matches_state(test.quiet_state),
			'pause setup did not retain the quiet player state')
		test.normal_imgid = player.sprite_component.imgid
		test.normal_color = player.sprite_component.color
		test.normal_scale_x = player.sprite_component.scale_x
		test.normal_scale_y = player.sprite_component.scale_y
		test.normal_flip_h = player.sprite_component.flip_h
		test.normal_offset_x = player.sprite_component.offset_x
		test.normal_offset_y = player.sprite_component.offset_y
		test.normal_sword_enabled = player.sword_sprite.enabled
		test.phase = 'enter_pause'
		return host.press('F2', 4)
	end

	if test.phase == 'enter_pause' then
		if not director.state_machines:matches_state(test.pause_state)
		or world.gameplay_clock_running then
			return false
		end
		local enemy<const> = registry:get('probe.pause.enemy')
		local projectile<const> = registry:get('probe.pause.projectile')
		test.player_x = player.x
		test.player_y = player.y
		test.enemy_x = enemy.x
		test.enemy_y = enemy.y
		test.projectile_x = projectile.x
		test.projectile_y = projectile.y
		test.pause_started = true
		local wait<const> = player.timelines:get('p.tl.pw')
		assert(wait.playing and wait.head == 0,
			'pause seated countdown did not start on its first frame')
		assert(player.sprite_component.imgid == 'pietolon_pause_seated',
			'pause did not begin with the seated MSX pose')
		test.wait_head = wait.head
		test.seated_ticks = 0
		test.phase = 'seated'
		return false
	end

	if test.phase == 'seated' then
		local wait<const> = player.timelines:get('p.tl.pw')
		if wait.playing then
			local head<const> = wait.head
			local elapsed<const> = head - test.wait_head
			assert(elapsed == 0 or elapsed == 1,
				'pause seated countdown skipped a gameplay update')
			test.seated_ticks = test.seated_ticks + elapsed
			test.wait_head = head
			assert(player.sprite_component.imgid == 'pietolon_pause_seated',
				'pause left the seated pose before the 600-update boundary')
			return false
		end
		test.seated_ticks = test.seated_ticks + 1
		assert(test.seated_ticks == flow_pause_seated_frames,
			'pause seated pose did not last exactly 600 gameplay updates')
		local animation<const> = player.timelines:get('p.tl.pa')
		assert(animation.playing and animation.head == 0,
			'stuck animation did not begin on its first frame')
		assert(player.sprite_component.imgid == 'pietolon_pause_stuck_1',
			'pause selected the wrong first stuck pose')
		test.animation_head = animation.head
		test.animation_ticks = 0
		test.phase = 'animation'
		return false
	end

	if test.phase == 'animation' then
		local animation<const> = player.timelines:get('p.tl.pa')
		assert(animation.playing, 'stuck animation stopped before F2 resumed gameplay')
		local head<const> = animation.head
		local elapsed
		if head >= test.animation_head then
			elapsed = head - test.animation_head
		else
			assert(test.animation_head == flow_pause_stuck_frame_hold * 2 - 1 and head == 0,
				'stuck animation wrapped at the wrong frame')
			elapsed = 1
		end
		assert(elapsed == 0 or elapsed == 1, 'stuck animation skipped a gameplay update')
		test.animation_ticks = test.animation_ticks + elapsed
		test.animation_head = head
		if head < flow_pause_stuck_frame_hold then
			assert(player.sprite_component.imgid == 'pietolon_pause_stuck_1',
				'first stuck pose did not hold for eight gameplay updates')
		else
			assert(player.sprite_component.imgid == 'pietolon_pause_stuck_2',
				'second stuck pose did not begin at the eight-update boundary')
		end
		if test.animation_ticks == flow_pause_stuck_frame_hold then
			assert(head == flow_pause_stuck_frame_hold,
				'second stuck pose began on the wrong animation frame')
			test.saw_second_stuck_pose = true
		end
		if test.animation_ticks < flow_pause_stuck_frame_hold * 2 then
			return false
		end
		assert(test.animation_ticks == flow_pause_stuck_frame_hold * 2 and head == 0,
			'stuck animation did not wrap after sixteen gameplay updates')
		assert(test.saw_second_stuck_pose, 'pause never displayed the second stuck pose')
		test.phase = 'resume'
		return host.press('F2', 4)
	end

	if test.phase == 'resume' then
		if not director.state_machines:matches_state(test.room_state)
		or not world.gameplay_clock_running then
			return false
		end
		assert(player.state_machines:matches_state(test.quiet_state),
			'resuming pause changed the retained player gameplay state')
		assert(player.sprite_component.imgid == test.normal_imgid,
			'resume did not restore the retained gameplay image')
		assert(player.sprite_component.color == test.normal_color,
			'resume did not restore the retained gameplay color')
		assert(player.sprite_component.scale_x == test.normal_scale_x
			and player.sprite_component.scale_y == test.normal_scale_y,
			'resume did not restore the retained gameplay scale')
		assert(player.sprite_component.flip_h == test.normal_flip_h,
			'resume did not restore the retained gameplay mirroring')
		assert(player.sprite_component.offset_x == test.normal_offset_x
			and player.sprite_component.offset_y == test.normal_offset_y,
			'resume did not restore the retained gameplay offsets')
		assert(player.sword_sprite.enabled == test.normal_sword_enabled,
			'resume did not restore the retained sword presentation')
		test.phase = 'resumed_gameplay'
		test.resume_frames = 0
		return false
	end

	test.resume_frames = test.resume_frames + 1
	assert(test.resume_frames < 12, 'gameplay objects did not resume after F2')
	local enemy<const> = registry:get('probe.pause.enemy')
	local projectile<const> = registry:get('probe.pause.projectile')
	return (enemy ~= nil and (enemy.x ~= test.enemy_x or enemy.y ~= test.enemy_y))
		or (projectile ~= nil
			and (projectile.x ~= test.projectile_x or projectile.y ~= test.projectile_y))
end
