const ELEVATOR_ROOM_NUMBER = 13;
const ELEVATOR_LOWER_ROOM_NUMBER = 6;
const POLL_MS = 20;
const TIMEOUT_MS = 15000;
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

function getLuaState(engine) {
	const [state] = evalLua(engine, `
		local collision2d = require('collision2d')
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		local expected_floor_y = -1
		if room ~= nil and player ~= nil then
			for test_y = player.y, constants.room.height - player.height do
				if room:has_collision_flags_in_rect(player.x, test_y, player.width, player.height, constants.collision_flags.solid_mask, false) then
					expected_floor_y = test_y - 1
					break
				end
			end
		end
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_elevator = elevator ~= nil,
			room_number = castle and castle.current_room_number or -1,
			player_x = player and player.x or -1,
			player_y = player and player.y or -1,
			player_bottom = player and (player.y + player.height) or -1,
			elevator_x = elevator and elevator.x or -1,
			elevator_y = elevator and elevator.y or -1,
			elevator_bottom = elevator and (elevator.y + 16) or -1,
			elevator_room = elevator and elevator.current_room_number or -1,
			player_quiet = player and player:has_tag('v.q') or false,
			player_uncontrolled_fall = player and player:has_tag('v.uf') or false,
			player_controlled_fall = player and player:has_tag('v.cf') or false,
			player_jumping = player and player:has_tag('v.j') or false,
			player_stopped_jump = player and player:has_tag('v.sj') or false,
			player_walking_right = player and player:has_tag('v.wr') or false,
			player_grounded = player and player.grounded or false,
			player_overlap_elevator = player and elevator and collision2d.collides(player.collider, elevator.collider) or false,
			expected_floor_y = expected_floor_y,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	if (!state) {
		return false;
	}
	return state.has_castle && state.has_room && state.has_player && state.has_elevator;
}

function prepareElevatorRoom(engine) {
	evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		castle.current_room_number = ${ELEVATOR_ROOM_NUMBER}
		room:load_room(${ELEVATOR_ROOM_NUMBER})
		local start = elevator.path[1]
		elevator.x = start.x
		elevator.y = start.y
		elevator.current_room_number = start.room_number
		elevator.going_to = 2
		elevator.visible = true
		elevator.collider.enabled = true
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player.events:emit('landed_to_quiet')
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
	`);
}

function prepareLowerElevatorRoom(engine) {
	evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		castle.current_room_number = ${ELEVATOR_LOWER_ROOM_NUMBER}
		room:load_room(${ELEVATOR_LOWER_ROOM_NUMBER})
		local start = elevator.path[2]
		elevator.x = start.x
		elevator.y = start.y
		elevator.current_room_number = start.room_number
		elevator.going_to = 1
		elevator.visible = true
		elevator.collider.enabled = true
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player.events:emit('landed_to_quiet')
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
	`);
}

function setupCarryScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = elevator.y - player.height
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] carry setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'carry',
		lastElevatorY: state.elevator_y,
		observedMoves: 0,
	};
}

function setupLandingScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = (elevator.y - player.height) - 8
		player.events:emit('falling')
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] landing setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'landing',
		lastElevatorY: state.elevator_y,
		landedMoves: 0,
		frames: 0,
	};
}

function setupCeilingScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = elevator.y + 16
		player:start_jump(0)
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] ceiling setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'ceiling',
		frames: 0,
		lastElevatorY: state.elevator_y,
		observedMoves: 0,
	};
}

function setupStepOffScenario(engine, logger) {
	prepareLowerElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x + 12
		player.y = elevator.y - player.height
		player.facing = 1
		player.right_held = true
		player.events:emit('right_down')
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] stepoff setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'stepoff',
		frames: 0,
		saw_walking: false,
		saw_fall: false,
		released_right: false,
	};
}

function updateCarryScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	const expectedPlayerY = state.elevator_y - 16;
	assert(
		state.player_y === expectedPlayerY,
		`carry drifted: player.y=${state.player_y} expected=${expectedPlayerY} elevator.y=${state.elevator_y} overlap=${state.player_overlap_elevator}`
	);
	assert(!state.player_overlap_elevator, `carry overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.elevator_y !== scenario.lastElevatorY) {
		scenario.lastElevatorY = state.elevator_y;
		scenario.observedMoves += 1;
	}
	if (scenario.observedMoves < 8) {
		return scenario;
	}
	logger(`[assert] carry ok after ${scenario.observedMoves} elevator steps`);
	return setupLandingScenario(engine, logger);
}

function updateLandingScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	const expectedPlayerY = state.elevator_y - 16;
	assert(state.player_y <= expectedPlayerY, `player clipped into elevator: player.y=${state.player_y} topY=${expectedPlayerY}`);
	assert(!state.player_overlap_elevator, `landing overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.player_y === expectedPlayerY) {
		if (state.elevator_y !== scenario.lastElevatorY) {
			scenario.lastElevatorY = state.elevator_y;
			scenario.landedMoves += 1;
		}
		if (scenario.landedMoves >= 4) {
			logger('[assert] landing ok');
			return setupCeilingScenario(engine, logger);
		}
	} else {
		scenario.lastElevatorY = state.elevator_y;
	}
	scenario.frames += 1;
	assert(scenario.frames < 80, `player failed to land on elevator within ${scenario.frames} frames`);
	return scenario;
}

function updateCeilingScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	assert(!state.player_overlap_elevator, `player overlapped elevator from below: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.elevator_y !== scenario.lastElevatorY) {
		scenario.lastElevatorY = state.elevator_y;
		scenario.observedMoves += 1;
		if (scenario.observedMoves === 1) {
			assert(
				state.player_y === state.elevator_bottom,
				`ceiling push failed: player.y=${state.player_y} expected=${state.elevator_bottom} elevator.y=${state.elevator_y}`
			);
		}
	}
	scenario.frames += 1;
	if (scenario.observedMoves >= 8) {
		logger('[assert] ceiling ok');
		return setupStepOffScenario(engine, logger);
	}
	assert(scenario.frames < 80, `ceiling scenario did not observe enough elevator movement within ${scenario.frames} frames`);
	return scenario;
}

function updateStepOffScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	if (state.player_walking_right) {
		scenario.saw_walking = true;
	}
	if (state.player_uncontrolled_fall || state.player_controlled_fall) {
		scenario.saw_fall = true;
	}
	if (scenario.saw_fall && !scenario.released_right) {
		evalLua(engine, `
			local player = object('pietolon')
			player.events:emit('right[jr]')
		`);
		scenario.released_right = true;
	}
	assert(!state.player_overlap_elevator, `stepoff overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	scenario.frames += 1;
	if (state.player_quiet && scenario.saw_walking && scenario.saw_fall) {
		assert(state.player_grounded, `stepoff landed quiet without grounded support: player.y=${state.player_y}`);
		assert(state.player_y === state.expected_floor_y, `stepoff landed at wrong floor y: player.y=${state.player_y} expected=${state.expected_floor_y}`);
		assert(state.player_y > state.elevator_y - 16, `stepoff never fell below elevator top: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
		logger('[assert] stepoff floor landing ok');
		return { name: 'done' };
	}
	assert(
		scenario.frames < 120,
		`stepoff failed within ${scenario.frames} frames: walking=${scenario.saw_walking} fall=${scenario.saw_fall} released=${scenario.released_right} player=(${state.player_x},${state.player_y}) quiet=${state.player_quiet} grounded=${state.player_grounded} expectedFloorY=${state.expected_floor_y} elevator=(${state.elevator_x},${state.elevator_y})`
	);
	return scenario;
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let lastWaitingLogAt = 0;
	let gameplayReadyAt = 0;
	let scenario = { name: 'boot' };

	const timeout = setTimeout(() => {
		fail(`timeout while waiting for scenario=${scenario.name}`);
	}, TIMEOUT_MS);

	const poll = setInterval(() => {
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

		const state = getLuaState(engine);
		if (!hasGameplayObjects(state)) {
			gameplayReadyAt = 0;
			const now = Date.now();
			if (now - lastWaitingLogAt >= 1000) {
				lastWaitingLogAt = now;
				if (state) {
					logger(`[assert] waiting objects castle=${state.has_castle} room=${state.has_room} player=${state.has_player} elevator=${state.has_elevator}`);
				} else {
					logger('[assert] waiting objects state=nil');
				}
			}
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

		if (scenario.name === 'boot') {
			scenario = setupCarryScenario(engine, logger);
			return;
		}
		if (scenario.name === 'carry') {
			scenario = updateCarryScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'landing') {
			scenario = updateLandingScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'ceiling') {
			scenario = updateCeilingScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'stepoff') {
			scenario = updateStepOffScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all elevator assertions passed');
		}
	}, POLL_MS);
}
