const TIMEOUT_MS = 12000;
const GAMEPLAY_OBJECTS = {
	castle: 'c',
	room: 'room',
	player: 'pietolon',
};

function setupProbeState(test, logger) {
	test.evalLua(`
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')

		room:load_room(castle.current_room_number)
		_probe_pairs_delete_values = {
			first = 11,
			second = 22,
			third = 33,
		}
		_probe_crossfoe = inst('enemy.crossfoe', {
			id = 'probe.cross',
			space_id = 'main',
			pos = { x = player.x + 32, y = player.y, z = 140 },
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			dangerous = false,
			health = 3,
			max_health = 3,
		})
	`);
	logger('[assert] sword-hit probe state prepared');
}

function readPairsDeleteState(test) {
	const [state] = test.evalLua(`
		local values = {}
		for key, value in pairs(_probe_pairs_delete_values) do
			values[key] = value
		end
		local count = 0
		local trace = {}
		for key, value in pairs(values) do
			count = count + 1
			trace[#trace + 1] = tostring(key) .. ':' .. tostring(value)
			values[key] = nil
		end
		table.sort(trace)
		return {
			count = count,
			trace = table.concat(trace, ','),
		}
	`);
	return state;
}

function emitSwordHit(test) {
	const [state] = test.evalLua(`
		local constants = require('constants')
		local player = object('pietolon')
		local enemy = object('probe.cross')
		local events = {}

		enemy.events:on({
			event = 'damage.resolved',
			subscriber = enemy,
			handler = function(event)
				events[#events + 1] = event.status .. ':' .. tostring(event.amount_applied)
			end,
		})

		local before = enemy.health
		enemy.events:emit('overlap.begin', {
			other_id = player.id,
			other_kind = 'player',
			other_layer = constants.collision.player_layer,
			other_collider_local_id = 'sword',
		})

		return {
			before = before,
			after = enemy.health,
			damage_events = #events,
			damage_trace = table.concat(events, ','),
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

		setupProbeState(test, logger);

		const pairsDelete = readPairsDeleteState(test);
		await test.waitFrames(1);
		logger(`[assert] pairs delete count=${pairsDelete.count}`);
		test.assert(pairsDelete.count === 3, `pairs delete iteration expected 3 entries, got ${pairsDelete.count}: ${pairsDelete.trace}`);

		const firstHit = emitSwordHit(test);
		await test.waitFrames(1);
		const secondHit = emitSwordHit(test);

		logger(`[assert] sword hits ${firstHit.before}->${firstHit.after}->${secondHit.after}`);
		test.assert(firstHit.before === 3, `first sword hit expected starting health 3, got ${firstHit.before}`);
		test.assert(firstHit.after === 2, `first sword hit expected health 2, got ${firstHit.after}`);
		test.assert(firstHit.damage_events === 1, `first sword hit expected 1 damage event, got ${firstHit.damage_events}: ${firstHit.damage_trace}`);
		test.assert(secondHit.before === 2, `second sword hit expected starting health 2, got ${secondHit.before}`);
		test.assert(secondHit.after === 1, `second sword hit expected health 1, got ${secondHit.after}`);
		test.assert(secondHit.damage_events === 1, `second sword hit expected 1 damage event, got ${secondHit.damage_events}: ${secondHit.damage_trace}`);

		test.finish('[assert] sword-hit regression probe passed');
	});
}
