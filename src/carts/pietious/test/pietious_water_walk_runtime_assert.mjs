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

function setupScenario(engine) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local probe = nil

		castle.current_room_number = 8
		room:load_room(8)

		for tx = 1, room.tile_columns do
			local player_x = room.tile_origin_x + ((tx - 1) * room.tile_size) - constants.room.tile_half
			for ty = 13, room.tile_rows do
				local player_y = room.tile_origin_y + ((ty - 1) * room.tile_size) - player.height
				if room:player_water_kind_at_world(player_x + constants.room.tile_half, player_y + player.height) == constants.water.body
					and not room:has_collision_flags_in_rect(player_x, player_y, player.width + 24, player.height, constants.collision_flags.solid_mask, false)
					and player:is_support_below_at(player_x, player_y, true) then
					probe = {
						x = player_x,
						y = player_y,
					}
					break
				end
			end
			if probe ~= nil then
				break
			end
		end

		assert(probe ~= nil, 'no underwater walking probe found in room 8')

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.sword_cooldown = 0
		player.inventory_items['schoentjes'] = false
		player.x = probe.x
		player.y = probe.y
		player.facing = 1
		player.walk_state = 0
		player.sc:transition_to('player:/walking_right')
		player:update_collision_state()
		player:update_water_state()

		return {
			x = player.x,
			y = player.y,
			water_state = player.water_state,
			walking_right = player.sc:matches_state_path('player:/walking_right'),
		}
	`);
	return state;
}

function getRuntimeState(engine) {
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		return {
			x = player.x,
			last_dx = player.last_dx,
			y = player.y,
			water_state = player.water_state,
			right_held = player.right_held,
			walking_right = player.sc:matches_state_path('player:/walking_right'),
			quiet = player.sc:matches_state_path('player:/quiet'),
			walking_left = player.sc:matches_state_path('player:/walking_left'),
			controlled_fall = player.sc:matches_state_path('player:/controlled_fall'),
			uncontrolled_fall = player.sc:matches_state_path('player:/uncontrolled_fall'),
		}
	`);
	return state;
}

export default function schedule({ logger, schedule: scheduleInput }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let scenarioStarted = false;
	let released = false;
	let completed = false;
	let sampleCountdown = -1;
	const dxSamples = [];

	const timeout = setTimeout(() => {
		fail('timeout while waiting for water walk runtime assert');
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
			const setup = setupScenario(engine);
			assert(setup.water_state === 2, `setup water_state expected 2, got ${setup.water_state}`);
			assert(setup.walking_right === true, 'setup did not enter walking_right');
			const nowMs = Math.round(engine.platform.clock.now());
			scheduleInput([
				{ description: 'water_walk_press_right', delayMs: 10, event: buttonEvent('ArrowRight', true, 1, nowMs + 10) },
				{ description: 'water_walk_release_right', delayMs: 220, event: buttonEvent('ArrowRight', false, 1, nowMs + 220) },
			]);
			scenarioStarted = true;
			sampleCountdown = 1;
			logger('[assert] water walk runtime scenario armed');
			return;
		}

		const state = getRuntimeState(engine);
		assert(state.water_state === 2, `runtime left body water: water_state=${state.water_state}`);
		assert(
			state.walking_right === true || state.quiet === true,
			`unexpected runtime state while sampling: x=${state.x} y=${state.y} walkingR=${state.walking_right} quiet=${state.quiet} walkingL=${state.walking_left} cfall=${state.controlled_fall} ufall=${state.uncontrolled_fall}`
		);

		if (sampleCountdown > 0) {
			sampleCountdown -= 1;
			return;
		}

		if (dxSamples.length < 4) {
			dxSamples.push(state.last_dx);
			logger(`[assert] runtime walk sample ${dxSamples.length}=dx${state.last_dx} x=${state.x} heldR=${state.right_held} walking=${state.walking_right}`);
			return;
		}

		if (!released) {
			released = true;
			const total = dxSamples[0] + dxSamples[1] + dxSamples[2] + dxSamples[3];
			logger(`[assert] runtime walk dx samples=${dxSamples.join(',')} total=${total}`);
			assert((dxSamples[0] === 0 || dxSamples[0] === 1), `expected runtime walk dx frame1 to be 0 or 1, got ${dxSamples[0]}`);
			assert((dxSamples[1] === 0 || dxSamples[1] === 1), `expected runtime walk dx frame2 to be 0 or 1, got ${dxSamples[1]}`);
			assert((dxSamples[2] === 0 || dxSamples[2] === 1), `expected runtime walk dx frame3 to be 0 or 1, got ${dxSamples[2]}`);
			assert((dxSamples[3] === 0 || dxSamples[3] === 1), `expected runtime walk dx frame4 to be 0 or 1, got ${dxSamples[3]}`);
			assert(total === 2, `expected runtime walk dx total=2, got ${total}`);
			logger('[assert] water walk runtime ok');
			completed = true;
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
		}
	}, POLL_MS);
}
