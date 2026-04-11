const POLL_MS = 20;
const TIMEOUT_MS = 20000;
const CART_SETTLE_MS = 500;

function buttonEvent(code, down, pressId, timeMs) {
	return {
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down,
		value: down ? 1 : 0,
		timestamp: timeMs,
		pressId,
		modifiers: { ctrl: false, shift: false, alt: false, meta: false },
	};
}

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
		local elevator = object('e.p1')
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

function setupScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		local start = elevator.path[1]
		local probe_x = nil
		local probe_y = start.y - player.height

		castle.current_room_number = 13
		room:load_room(13)
		elevator.x = start.x
		elevator.y = start.y
		elevator.current_room_number = start.room_number
		elevator.going_to = 2
		elevator.visible = true
		elevator.collider.enabled = true

		for offset = -constants.room.tile_size2, constants.room.tile_size2 do
			local candidate_x = elevator.x + offset
			if not room:has_collision_flags_in_rect(candidate_x, probe_y, player.width, player.height, constants.collision_flags.solid_mask, false)
				and player:is_support_below_at(candidate_x, probe_y, true)
				and not player:is_support_below_at(candidate_x - constants.physics.walk_dx, probe_y, true)
			then
				probe_x = candidate_x
				break
			end
		end

		assert(probe_x ~= nil, 'no downward-left elevator stepoff probe found')

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.sword_cooldown = 0
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = true
		player.vertical_elevator_id = elevator.id
		player.next_vertical_elevator = false
		player.next_vertical_elevator_id = nil
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.x = probe_x
		player.y = probe_y
		player.facing = -1
		player.events:emit('landed_to_quiet')

		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] elevator down-left stepoff setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return state;
}

function getRuntimeState(engine) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local collision2d = require('collision2d')
		local player = object('pietolon')
		local elevator = object('e.p1')
		local left_foot_x = player.x + constants.room.tile_half
		local mid_foot_x = player.x + (player.width / 2)
		local right_foot_x = (player.x + player.width) - constants.room.tile_half
		local feet_over_top =
			(left_foot_x >= elevator.x and left_foot_x < (elevator.x + constants.room.tile_size4))
			or (mid_foot_x >= elevator.x and mid_foot_x < (elevator.x + constants.room.tile_size4))
			or (right_foot_x >= elevator.x and right_foot_x < (elevator.x + constants.room.tile_size4))
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
			on_top = player.y == (elevator.y - player.height) and feet_over_top,
			grounded = player.grounded,
			quiet = player.sc:matches_state_path('player:/quiet'),
			walking_left = player.sc:matches_state_path('player:/walking_left'),
			uncontrolled_fall = player.sc:matches_state_path('player:/uncontrolled_fall'),
			controlled_fall = player.sc:matches_state_path('player:/controlled_fall'),
			overlap = collision2d.collides(player.collider, elevator.collider) ~= nil,
			on_vertical_elevator = player.on_vertical_elevator,
		}
	`);
	return state;
}

export default function schedule({ logger, schedule: scheduleInput }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let scenarioStarted = false;
	let previousUncontrolledFall = false;
	let uncontrolledFallEntries = 0;
	let sawFall = false;
	let releasedLeft = false;
	let stableLandingFrames = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for elevator down-left stepoff assert');
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

		const gameplayState = getGameplayState(engine);
		if (!hasGameplayObjects(gameplayState)) {
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

		if (!scenarioStarted) {
			setupScenario(engine, logger);
			const nowMs = Math.round(engine.platform.clock.now());
			scheduleInput([
				{ description: 'elevator_down_left_stepoff_press_left', delayMs: 10, event: buttonEvent('ArrowLeft', true, 1, nowMs + 10) },
			]);
			scenarioStarted = true;
			logger('[assert] elevator down-left stepoff scenario armed');
			return;
		}

		const state = getRuntimeState(engine);
		assert(!state.overlap, `overlapped elevator: player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);

		if (state.uncontrolled_fall && !previousUncontrolledFall) {
			uncontrolledFallEntries += 1;
			sawFall = true;
			logger(`[assert] uncontrolled fall entry ${uncontrolledFallEntries} player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y}) onTop=${state.on_top} onElev=${state.on_vertical_elevator}`);
			assert(uncontrolledFallEntries <= 1, `re-entered uncontrolled_fall while stepping off downward elevator: player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
		}
		previousUncontrolledFall = state.uncontrolled_fall;

		if (sawFall && state.on_top) {
			fail(`player got recaptured onto downward elevator after falling: player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
		}

		if (sawFall && !releasedLeft) {
			releasedLeft = true;
			const nowMs = Math.round(engine.platform.clock.now());
			scheduleInput([
				{ description: 'elevator_down_left_stepoff_release_left', delayMs: 10, event: buttonEvent('ArrowLeft', false, 1, nowMs + 10) },
			]);
		}

		if (sawFall && state.grounded && !state.on_top && state.player_y > (state.elevator_y - 16)) {
			stableLandingFrames += 1;
			if (stableLandingFrames >= 3) {
				logger('[assert] elevator down-left stepoff ok');
				logger('[assert] all targeted assertions passed');
				completed = true;
				clearInterval(poll);
				clearTimeout(timeout);
			}
			return;
		}
		stableLandingFrames = 0;
	}, POLL_MS);
}
