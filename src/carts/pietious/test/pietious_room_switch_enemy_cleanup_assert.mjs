const POLL_MS = 20;
const TIMEOUT_MS = 12000;
const CART_SETTLE_MS = 500;

function fail(message) {
	throw new Error(`[assert] ${message}`);
}

function assert(condition, message) {
	if (!condition) {
		fail(message);
	}
}

function evalLua(engine, source) {
	return engine.evaluate_lua(source);
}

function getGameplayState(engine) {
	const [state] = evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	return state && state.has_castle && state.has_room && state.has_player;
}

function runAssert(engine, logger) {
	const [state] = evalLua(engine, `
		local world = require('world').instance
		local castle_map = require('castle_map')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local room_numbers = {}
		local source_room_number = -1

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local candidate_room_number = room_numbers[i]
			local template = castle_map.room_templates[candidate_room_number]
			if template.room_links.right > 0 then
				source_room_number = candidate_room_number
				break
			end
		end

		if source_room_number < 0 then
			error('no right-linked room found for enemy cleanup assert')
		end

		local target_room_number = castle_map.room_templates[source_room_number].room_links.right

		local function count_leak_objects()
			local count = 0
			local ids = {}
			for obj in world:objects({ scope = 'all' }) do
				if obj.id ~= nil and obj.id:sub(1, 5) == 'leak.' and not obj.dispose_flag then
					count = count + 1
					ids[#ids + 1] = obj.id .. ':' .. tostring(obj.enemy_kind)
				end
			end
			table.sort(ids)
			return count, table.concat(ids, ',')
		end

		castle.current_room_number = source_room_number
		room:load_room(source_room_number)
		player:clear_input_state()
		player:zero_motion()
		player:cancel_sword()
		player:reset_fall_substate_sequence()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false

		inst('enemy.vlokfoe', {
			id = 'leak.vlok',
			space_id = 'main',
			pos = { x = 96, y = 96, z = 140 },
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
		})
		inst('enemy.paperfoe', {
			id = 'leak.paper',
			space_id = 'main',
			pos = { x = 112, y = 96, z = 140 },
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
		})
		inst('enemy.nootfoe', {
			id = 'leak.noot',
			space_id = 'main',
			pos = { x = 128, y = 96, z = 140 },
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
		})
		inst('enemy.staffspawn', {
			id = 'leak.staff',
			space_id = 'main',
			pos = { x = 144, y = 96, z = 140 },
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
		})

		local before_count, before_ids = count_leak_objects()
		local switch = castle:switch_room('right', player.y, player.y + player.height)
		player:emit_room_switched(switch.from_room_number, switch.to_room_number, switch.direction)
		local after_count, after_ids = count_leak_objects()

		return {
			source_room_number = source_room_number,
			target_room_number = target_room_number,
			before_count = before_count,
			before_ids = before_ids,
			after_count = after_count,
			after_ids = after_ids,
		}
	`);

	logger(`[assert] enemy cleanup source=${state.source_room_number} target=${state.target_room_number} before=${state.before_count} after=${state.after_count}`);
	assert(state.before_count === 4, `expected 4 leak test objects before switch, got ${state.before_count}: ${state.before_ids}`);
	assert(state.after_count === 0, `room switch leaked dynamic enemies: ${state.after_ids}`);
	logger('[assert] room-switch enemy cleanup ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for room-switch enemy cleanup assert');
	}, TIMEOUT_MS);

	const poll = setInterval(() => {
		if (completed) {
			return;
		}
		const engine = globalThis.$;
		if (!engine.initialized) {
			return;
		}
		if (!requestedNewGame) {
			if (!engine.is_cart_program_active()) {
				cartActiveAt = 0;
				return;
			}
			if (cartActiveAt === 0) {
				cartActiveAt = Date.now();
				logger('[assert] cart active, waiting for settle');
				return;
			}
			if (Date.now() - cartActiveAt < CART_SETTLE_MS) {
				return;
			}
			requestedNewGame = true;
			logger('[assert] cart active, requesting new_game');
			engine.request_new_game();
			return;
		}

		const state = getGameplayState(engine);
		if (!hasGameplayObjects(state)) {
			gameplayReadyAt = 0;
			return;
		}
		if (gameplayReadyAt === 0) {
			gameplayReadyAt = Date.now();
			logger('[assert] gameplay objects ready, waiting for settle');
			return;
		}
		if (Date.now() - gameplayReadyAt < 1000) {
			return;
		}

		runAssert(engine, logger);
		completed = true;
		clearInterval(poll);
		clearTimeout(timeout);
		logger('[assert] all targeted assertions passed');
	}, POLL_MS);
}
