const POLL_MS = 20;
const TIMEOUT_MS = 30000;
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
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	return state.has_castle && state.has_room && state.has_player;
}

function runAssert(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle_map = require('castle_map')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local room_numbers = {}
		local result = {
			bad_candidate_found = false,
			valid_step_off_count = 0,
		}

		local function reset_player(stair, test_y, dir)
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
			player.x = stair.x
			player.y = test_y
			player.facing = dir
			player.events:emit('landed_to_quiet')
			player:start_stairs(-1, stair, 'stairs_up')
			if dir < 0 then
				player.events:emit('stairs_quiet_left')
				player.left_held = true
				player.right_held = false
			else
				player.events:emit('stairs_quiet_right')
				player.left_held = false
				player.right_held = true
			end
			player.up_held = false
			player.down_held = false
			player:update_collision_state()
		end

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local room_number = room_numbers[i]
			castle.current_room_number = room_number
			room:load_room(room_number)
			for stair_i = 1, #room.stairs do
				local stair = room.stairs[stair_i]
				for test_y = stair.top_y, stair.bottom_y do
					for dir_i = 1, 2 do
						local dir = -1
						if dir_i == 2 then
							dir = 1
						end

						reset_player(stair, test_y, dir)
						local before_x = player.x
						local before_y = player.y
						local stepped = player:try_step_off_stairs()
						local after_x = player.x
						local after_y = player.y
						local overlap_after = player:collides_at(player.x, player.y, false)

						if stepped then
							result.valid_step_off_count = result.valid_step_off_count + 1
						end
						if stepped and overlap_after then
							result.bad_candidate_found = true
							result.room_number = room_number
							result.stair_index = stair_i
							result.dir = dir
							result.before_x = before_x
							result.before_y = before_y
							result.after_x = after_x
							result.after_y = after_y
							result.upper_probe_y = (before_y + player.height) - constants.room.tile_size - 1
							result.lower_probe_y = (before_y + player.height) - 1
							return result
						end
					end
				end
			end
		end

		return result
	`);

	logger(`[assert] stairs stepoff scan valid_step_offs=${state.valid_step_off_count}`);
	assert(state.valid_step_off_count > 0, 'stairs stepoff scan found no valid stepoff cases');
	assert(
		state.bad_candidate_found === false,
		`stairs stepoff overlapped wall: room=${state.room_number} stair=${state.stair_index} dir=${state.dir} before=(${state.before_x},${state.before_y}) after=(${state.after_x},${state.after_y}) probes=(${state.upper_probe_y},${state.lower_probe_y})`,
	);
	logger('[assert] stairs stepoff side wall ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for stairs stepoff side wall assert');
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
