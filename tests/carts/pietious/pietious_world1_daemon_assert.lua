local combat_damage<const> = require('combat/damage')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

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
		and registry:get('ui') ~= nil
end

local find_daemon_def<const> = function(room)
	for index = 1, #room.enemies do
		local def<const> = room.enemies[index]
		if def.kind == 'daemon' then
			return def
		end
	end
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 1000, 'world 1 daemon scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	local director<const> = registry:get('d')
	if test.phase == 'setup' then
		local from_room_number<const> = castle.current_room_number
		room:load_room(100)
		castle:commit_room_switch({
			from_room_number = from_room_number,
			to_room_number = 100,
			direction = 'down',
		}, 1, 2, 5)
		player.state_machines:transition_to('/quiet')
		player.x = 32
		player.y = 96
		local def<const> = find_daemon_def(room)
		assert(def ~= nil, 'room 100 has no daemon definition')
		test.daemon_id = def.id
		test.phase = 'admitted'
		return false
	end

	local daemon<const> = registry:get(test.daemon_id)
	assert(daemon ~= nil, 'world 1 daemon was not admitted')
	if test.phase == 'admitted' then
		assert(not daemon.visible, 'daemon is visible before the appearance completes')
		assert(not daemon.collider.enabled, 'daemon collider is enabled before the fight')
		assert(not daemon.behaviour.enabled, 'daemon behaviour is enabled before the fight')
		director.events:emit('daemon_appearance')
		director.events:emit('daemon_appearance_done')
		test.phase = 'active'
		return false
	end

	if test.phase == 'active' then
		assert(daemon.visible, 'daemon remained hidden after appearance')
		assert(daemon.collider.enabled, 'daemon collider remained disabled after appearance')
		assert(daemon.behaviour.enabled, 'daemon behaviour remained disabled after appearance')
		if #daemon.spawn_projectiles == 0 then
			return false
		end
		assert(#daemon.spawn_projectiles == 12, 'first daemon burst did not contain twelve projectiles')
		assert(daemon.potatoes[1] ~= nil, 'first daemon burst did not include a potato')
		assert(daemon.potatoes[1].drop_health_chance_pct == 0
			and daemon.potatoes[1].drop_ammo_chance_pct == 0,
			'boss potato retained ordinary enemy drops')
		daemon.health = 1
		local request<const> = {
			source_id = player.id,
			source_kind = 'sword',
			target_id = daemon.id,
			target_kind = daemon.enemy_kind,
			damage_kind = 'weapon',
			weapon_kind = 'sword',
			amount = 1,
			room_number = room.room_number,
		}
		test.director_defeated_state = director.state_machines:bind_state_path('/daemon_defeated')
		test.director_key_state = director.state_machines:bind_state_path('/daemon_key')
		test.director_room_state = director.state_machines:bind_state_path('/room')
		test.daemon_dying_state = daemon.state_machines:bind_state_path('/dying')
		test.player_defeated_state = player.state_machines:bind_state_path('/daemon_defeated')
		test.player_quiet_state = player.state_machines:bind_state_path('/quiet')
		local result<const> = combat_damage.resolve(daemon, request)
		daemon:process_damage_result(result)
		assert(daemon.state_machines:matches_state(test.daemon_dying_state), 'daemon did not enter dying state')
		assert(director.state_machines:matches_state(test.director_defeated_state), 'director did not enter daemon defeated state')
		assert(player.state_machines:matches_state(test.player_defeated_state), 'player remained controllable during daemon death')
		test.phase = 'dying'
		return false
	end

	if test.phase == 'dying' then
		assert(not daemon.behaviour.enabled, 'daemon behaviour survived defeat')
		assert(not daemon.collider.enabled, 'daemon collider survived defeat')
		assert(world.gameplay_clock_running, 'daemon death incorrectly suspended all gameplay time')
		local key<const> = registry:get('world1_daemon_key')
		if key ~= nil then
			assert(world.gameplay_clock_running, 'gameplay clock did not resume for the key')
			assert(player.state_machines:matches_state(test.player_quiet_state), 'player remained locked after daemon death')
			assert(director.state_machines:matches_state(test.director_key_state), 'director did not enter daemon key state')
			assert(not daemon.visible, 'daemon remained visible beneath the key')
			assert(key.item_type == 'keyworld1', 'daemon dropped the wrong key')
			player.health = 1
			player:emit_health_changed()
			test.key_x = key.x
			test.key_y = key.y
			test.wait_frames = 4
			test.phase = 'health_drain'
			return false
		end
		assert(player.state_machines:matches_state(test.player_defeated_state), 'player control lock ended before daemon death')
		return false
	end

	if test.phase == 'health_drain' then
		test.wait_frames = test.wait_frames - 1
		if test.wait_frames > 0 then
			return false
		end
		local ui<const> = registry:get('ui')
		assert(ui.hud_health_level < player.max_health, 'health HUD did not begin its ordinary animated change')
		player.x = test.key_x
		player.y = test.key_y
		test.phase = 'pickup'
		return false
	end

	if test.phase == 'pickup' then
		if registry:get('world1_daemon_key') ~= nil then
			return false
		end
		local ui<const> = registry:get('ui')
		assert(player.inventory_items.keyworld1, 'daemon key was not added to the inventory')
		assert(player.health == player.max_health, 'daemon key did not restore player health')
		assert(ui.hud_health_target == player.max_health,
			'daemon key health restoration did not reach the HUD target')
		assert(ui.hud_health_level < player.max_health,
			'daemon key health restoration skipped the HUD animation')
		assert(castle.world_boss_defeated[1], 'world 1 daemon defeat was not retained')
		assert(director.state_machines:matches_state(test.director_room_state), 'director did not return to room state after key pickup')
		return true
	end

	return false
end
