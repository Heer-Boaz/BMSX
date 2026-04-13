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
				for test_x = constants.room.tile_size + constants.physics.jump_dx, constants.room.width - player.width do
					local next_x = test_x - constants.physics.jump_dx
					local next_y = test_y + constants.physics.popolon_jump_dy_by_substate[constants.physics.jump_release_cut_substate]
					player.x = test_x
					player.y = test_y
					player:update_collision_state()
					local next_left_wall_collision_primary = player:collides_at_left_wall_primary_profile(next_x, test_y, false)
					local next_left_wall_collision_secondary = player:collides_at_left_wall_secondary_profile(next_x, test_y, false)
					if (not player.left_wall_collision)
						and (next_left_wall_collision_primary or next_left_wall_collision_secondary)
						and not player:collides_at_jump_ceiling_profile(next_x, next_y, false)
					then
						player:clear_input_state()
						player:zero_motion()
						player:reset_fall_substate_sequence()
						player:cancel_sword()
						player.jump_inertia = -1
						player.jump_substate = constants.physics.jump_release_cut_substate
						player.previous_x_collision = false
						player.previous_y_collision = false
						player.on_vertical_elevator = false
						player.jumping_from_elevator = false
						player.stairs_landing_sound_pending = false
						player.x = test_x
						player.y = test_y
						player.sc:transition_to('player:/jumping')
						player:update_collision_state()
						local before_x = player.x
						player:update_jump_motion()
						local after_x = player.x
						local collided_x = player.previous_x_collision
						local last_dx = player.last_dx
						local last_dy = player.last_dy
						player:update_collision_state()
						candidate = {
							room_number = room_number,
							before_x = before_x,
							after_x = after_x,
							collided_x = collided_x,
							last_dx = last_dx,
							last_dy = last_dy,
							left_wall_after = player.left_wall_collision,
							left_wall_primary_after = player.left_wall_collision_primary,
							body_overlap_after = player:collides_at(player.x, player.y, false),
						}
						break
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
			error('no jump-left wall candidate found for targeted assert')
		end

		return candidate
	`);

	logger(`[assert] jump-left wall snap state room=${state.room_number} jump=(${state.before_x}->${state.after_x})`);
	assert(state.collided_x === true, `jump-left wall snap missed collision: room=${state.room_number}`);
	assert(state.after_x < state.before_x, `jump-left wall snap did not move left: before=${state.before_x} after=${state.after_x}`);
	assert(state.left_wall_primary_after === false, `jump-left wall snap primary profile still buried: room=${state.room_number} x=${state.after_x}`);
	assert(state.body_overlap_after === false, `jump-left wall snap body still overlaps solids: room=${state.room_number} x=${state.after_x} leftWall=${state.left_wall_after}`);
	assert(state.last_dx === (state.after_x - state.before_x), `jump-left wall snap wrong dx bookkeeping: expected=${state.after_x - state.before_x} actual=${state.last_dx}`);
	assert(state.last_dy < 0, `jump-left wall snap lost jump rise dy=${state.last_dy}`);
	logger('[assert] jump-left wall snap ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for jump-left wall snap assert');
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
