const TIMEOUT_MS = 15000;
const GAMEPLAY_OBJECTS = {
	castle: 'c',
	room: 'room',
	player: 'pietolon',
};

function prepareScene(test, logger) {
	const [state] = test.evalLua(`
		local constants = require('constants')
		local room_spawner = require('room_spawner')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')

		castle.current_room_number = 2
		room:load_room(2)
		room_spawner.spawn_all_for_room(room)

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.sword_cooldown = 0
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.previous_x_collision = false
		player.previous_y_collision = false
		player.stairs_landing_sound_pending = false
		player.events:emit('landed_to_quiet')

		local rock = oget('rock_002_01')
		_probe_room_rock_damage_events = 0
		rock.events:on({
			event = 'damage.resolved',
			subscriber = rock,
			handler = function()
				_probe_room_rock_damage_events = _probe_room_rock_damage_events + 1
			end,
		})

		return {
			rock_exists = rock ~= nil,
			rock_x = rock and rock.x or -1,
			rock_y = rock and rock.y or -1,
		}
	`);
	logger(`[assert] room rock scene rockExists=${state.rock_exists} rock=${state.rock_x},${state.rock_y}`);
	test.assert(state.rock_exists, 'expected room rock_002_01 to exist');
}

function spawnProjectile(test, id, direction) {
	test.evalLua(`
		local constants = require('constants')
		local rock = oget('rock_002_01')
		local player = oget('pietolon')
		local projectile_x = rock.x - constants.secondary_weapon.pepernoot_speed_px
		if ${direction} < 0 then
			projectile_x = rock.x + constants.rock.width
		end
		inst('pepernoot_projectile', {
			id = '${id}',
			space_id = 'main',
			owner_id = player.id,
			direction = ${direction},
			pos = { x = projectile_x, y = rock.y, z = 113 },
		})
	`);
}

function readScene(test) {
	const [state] = test.evalLua(`
		local rock = oget('rock_002_01')
		local projectile_r = oget('probe.room.projectile.r')
		local projectile_l = oget('probe.room.projectile.l')
		return {
			rock_exists = rock ~= nil,
			rock_health = rock and rock.health or -1,
			projectile_r_exists = projectile_r ~= nil,
			projectile_l_exists = projectile_l ~= nil,
			damage_events = _probe_room_rock_damage_events or 0,
		}
	`);
	return state;
}

export default function schedule({ logger, test }) {
	test.run(async () => {
		await test.waitForGameplay({
			objects: GAMEPLAY_OBJECTS,
			timeoutMs: TIMEOUT_MS,
		});

		prepareScene(test, logger);
		spawnProjectile(test, 'probe.room.projectile.r', 1);
		await test.waitFrames(6);

		let state = readScene(test);
		logger(`[assert] room rock projectile rightward health=${state.rock_health} events=${state.damage_events} projectileExists=${state.projectile_r_exists}`);
		test.assert(state.rock_exists, 'room rock disappeared unexpectedly after rightward shot');
		test.assert(state.rock_health === 2, `expected rightward projectile to damage room rock once, got health=${state.rock_health}`);
		test.assert(state.damage_events === 1, `expected one room-rock damage event after rightward shot, got ${state.damage_events}`);
		test.assert(!state.projectile_r_exists, 'expected rightward projectile to be disposed after room rock hit');

		spawnProjectile(test, 'probe.room.projectile.l', -1);
		await test.waitFrames(6);

		state = readScene(test);
		logger(`[assert] room rock projectile leftward health=${state.rock_health} events=${state.damage_events} projectileExists=${state.projectile_l_exists}`);
		test.assert(state.rock_exists, 'room rock disappeared unexpectedly after leftward shot');
		test.assert(state.rock_health === 1, `expected leftward projectile to damage room rock once, got health=${state.rock_health}`);
		test.assert(state.damage_events === 2, `expected two room-rock damage events after both shots, got ${state.damage_events}`);
		test.assert(!state.projectile_l_exists, 'expected leftward projectile to be disposed after room rock hit');
		test.finish('[assert] room rock projectile overlap passed');
	});
}
