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
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local elevator = oget('e.p1')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_elevator = elevator ~= nil,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	return state && state.has_castle && state.has_room && state.has_player && state.has_elevator;
}

function runAssert(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle_map = require('castle_map')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local room_numbers = {}
		local source_room_number = -1

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local candidate_room_number = room_numbers[i]
			local template = castle_map.room_templates[candidate_room_number]
			if template.room_links.up > 0 then
				source_room_number = candidate_room_number
				break
			end
		end

		if source_room_number < 0 then
			error('no upward room switch found for jump-hold assert')
		end

		castle.current_room_number = source_room_number
		room:load_room(source_room_number)
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = true
		player.jumping_from_elevator = false
		player.up_input_sources = 1
		player.up_held = true

		local switched = player:try_switch_room('up', false)
		player:start_jump(0)
		player:update_jump_motion()
		local room_switch_jump_substate = player.jump_substate
		local room_switch_up_input_sources = player.up_input_sources
		local room_switch_up_held = player.up_held
		local room_switch_jumping_from_elevator = player.jumping_from_elevator

		local saved_support_checker = player.is_support_below_at
		player.is_support_below_at = function()
			return false
		end
		player:clear_input_state()
		player.right_held = true
		player:zero_motion()
		player.jump_inertia = 1
		player.jump_substate = constants.physics.jump_ceiling_cut_substate + 1
		player.fall_substate = 0
		player:get_timeline('p.seq.f'):force_seek(0)
		player.support_collision = false
		player.left_wall_collision_primary = false
		player.left_wall_collision_secondary = false
		player.left_wall_collision = false
		player.right_wall_collision = false
		player.sc:transition_to('player:/stopped_jumping')
		player:update_stopped_jump_motion()
		local ceiling_cut_controlled_fall = player.sc:matches_state_path('player:/controlled_fall')
		local ceiling_cut_fall_substate = player.fall_substate
		local ceiling_cut_last_dx = player.last_dx
		local ceiling_cut_last_dy = player.last_dy
		player.is_support_below_at = saved_support_checker

		return {
			source_room_number = source_room_number,
			target_room_number = castle.current_room_number,
			switched = switched,
			up_input_sources = room_switch_up_input_sources,
			up_held = room_switch_up_held,
			jump_substate = room_switch_jump_substate,
			expected_jump_substate = constants.physics.jump_release_cut_substate + 1,
			jumping_from_elevator = room_switch_jumping_from_elevator,
			ceiling_cut_controlled_fall = ceiling_cut_controlled_fall,
			ceiling_cut_fall_substate = ceiling_cut_fall_substate,
			ceiling_cut_last_dx = ceiling_cut_last_dx,
			ceiling_cut_last_dy = ceiling_cut_last_dy,
		}
	`);
	logger(`[assert] room-switch jump-hold state source=${state.source_room_number} target=${state.target_room_number} switched=${state.switched} upHeld=${state.up_held} upSources=${state.up_input_sources} jumpSubstate=${state.jump_substate} expected=${state.expected_jump_substate} fromElevator=${state.jumping_from_elevator} ceilingCutCF=${state.ceiling_cut_controlled_fall} ceilingCutFallSub=${state.ceiling_cut_fall_substate} ceilingCutDx=${state.ceiling_cut_last_dx} ceilingCutDy=${state.ceiling_cut_last_dy}`);
	assert(state.switched === true, `room switch failed from room=${state.source_room_number}`);
	assert(state.source_room_number !== state.target_room_number, `room switch stayed in same room=${state.source_room_number}`);
	assert(state.up_input_sources === 0, `stale up_input_sources remained=${state.up_input_sources}`);
	assert(state.up_held === false, 'stale up_held remained true');
	assert(
		state.jump_substate === state.expected_jump_substate,
		`jump cut failed after room switch: jump_substate=${state.jump_substate} expected=${state.expected_jump_substate}`
	);
	assert(state.ceiling_cut_controlled_fall === true, 'ceiling cut did not enter controlled_fall on the next frame');
	assert(state.ceiling_cut_fall_substate === 1, `ceiling cut advanced wrong fall_substate=${state.ceiling_cut_fall_substate}`);
	assert(state.ceiling_cut_last_dx === 2, `ceiling cut used wrong horizontal carry dx=${state.ceiling_cut_last_dx}`);
	assert(state.ceiling_cut_last_dy === 0, `ceiling cut used wrong vertical carry dy=${state.ceiling_cut_last_dy}`);
	logger('[assert] room-switch jump-hold ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for room-switch jump-hold assert');
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
