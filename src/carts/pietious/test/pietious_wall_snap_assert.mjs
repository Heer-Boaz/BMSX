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
		local candidate = nil

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local room_number = room_numbers[i]
			castle.current_room_number = room_number
			room:load_room(room_number)
			for test_y = constants.room.tile_origin_y, constants.room.height - player.height do
				for test_x = constants.room.tile_size + 1, constants.room.width - player.width do
					player.x = test_x
					player.y = test_y
					player:update_collision_state()
					if player:collides_at_support_profile(test_x, test_y, false)
						and player.right_wall_collision
						and not player:collides_at_jump_ceiling_profile(test_x, test_y, false)
					then
						local quiet_expected_x = (math.modf((test_x + constants.room.tile_size) / constants.room.tile_size) * constants.room.tile_size) - constants.room.tile_size
						player:snap_x_to_current_wall_grid()
						player:update_collision_state()
						if player.x == quiet_expected_x and not player.right_wall_collision then
							candidate = {
								room_number = room_number,
								x = test_x,
								y = test_y,
								expected_x = quiet_expected_x,
							}
							break
						end
					end
				end
				if candidate ~= nil then
					break
				end
			end
			if candidate ~= nil then
				break
			end
		end

		if candidate == nil then
			error('no wall-overlap candidate found for focused wall snap assert')
		end

		local function reset_player(x, y)
			player:clear_input_state()
			player:zero_motion()
			player:reset_fall_substate_sequence()
			player:cancel_sword()
			player.jump_substate = 0
			player.jump_inertia = 0
			player.on_vertical_elevator = false
			player.jumping_from_elevator = false
			player.stairs_landing_sound_pending = false
			player.x = x
			player.y = y
			player.events:emit('landed_to_quiet')
			player:update_collision_state()
		end

		reset_player(candidate.x, candidate.y)
		player.right_held = true
		player.sc:transition_to('player:/walking_right')
		player:update_collision_state()
		local walking_before_x = player.x
		player:update_walking_right()
		player:update_collision_state()
		local walking_after_x = player.x
		local walking_after_right_wall = player.right_wall_collision

		return {
			room_number = candidate.room_number,
			expected_x = candidate.expected_x,
			walking_before_x = walking_before_x,
			walking_after_x = walking_after_x,
			walking_after_right_wall = walking_after_right_wall,
		}
	`);

	logger(`[assert] wall snap state room=${state.room_number} walk=(${state.walking_before_x}->${state.walking_after_x}) expected=${state.expected_x}`);
	assert(state.walking_after_x === state.expected_x, `walking snap wrong x=${state.walking_after_x} expected=${state.expected_x}`);
	assert(state.walking_after_right_wall === false, `walking snap left right-wall bit set at x=${state.walking_after_x}`);
	logger('[assert] wall snap ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for wall snap assert');
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
