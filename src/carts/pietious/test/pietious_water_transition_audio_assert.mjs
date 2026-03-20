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

function setupScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')

		local function reset_player(x, y)
			player:clear_input_state()
			player:zero_motion()
			player:reset_fall_substate_sequence()
			player:cancel_sword()
			player.sword_cooldown = 0
			player.jump_substate = 0
			player.jump_inertia = 0
			player.on_vertical_elevator = false
			player.jumping_from_elevator = false
			player.stairs_landing_sound_pending = false
			player.x = x
			player.y = y
			player.events:emit('landed_to_quiet')
			player:update_collision_state()
			player:update_water_state()
		end

		castle.current_room_number = 8
		room:load_room(8)

		local dry_probe = nil
		local wet_probe = nil
		local runtime_probe = nil

		for ty = 1, room.tile_rows do
			for tx = 1, room.tile_columns do
				local x = room.tile_origin_x + ((tx - 1) * room.tile_size) - constants.room.tile_half
				local y = room.tile_origin_y + ((ty - 1) * room.tile_size) - player.height
				if not room:has_collision_flags_in_rect(x, y, player.width, player.height, constants.collision_flags.solid_mask, false) then
					local water_kind = room:player_water_kind_at_world(x + constants.room.tile_half, y + player.height)
					if dry_probe == nil and water_kind == constants.water.none then
						dry_probe = { x = x, y = y }
					end
					if wet_probe == nil and water_kind ~= constants.water.none then
						wet_probe = { x = x, y = y }
					end
					if runtime_probe == nil and water_kind == constants.water.none then
						for dy = 1, 48 do
							local next_y = y + dy
							if room:player_water_kind_at_world(x + constants.room.tile_half, next_y + player.height) ~= constants.water.none
								and not room:has_collision_flags_in_rect(x, y, player.width, player.height + dy, constants.collision_flags.solid_mask, false) then
								runtime_probe = {
									x = x,
									y = y,
								}
								break
							end
						end
					end
				end
			end
		end

		assert(dry_probe ~= nil, 'no dry probe found in room 8')
		assert(wet_probe ~= nil, 'no wet probe found in room 8')
		assert(runtime_probe ~= nil, 'no dry-to-wet runtime probe found in room 8')

		local original_emit = player.events.emit
		player._test_water_transition_count = 0
		player._test_water_transition_trace = {}
		player.events.emit = function(port, event_name, payload)
			if event_name == 'water_transition' then
				player._test_water_transition_count = player._test_water_transition_count + 1
				player._test_water_transition_trace[player._test_water_transition_count] = {
					previous_state = payload.previous_state,
					water_state = payload.water_state,
				}
			end
			return original_emit(port, event_name, payload)
		end

		reset_player(runtime_probe.x, runtime_probe.y)
		player.facing = 1
		player.walk_state = 0
		player.sc:transition_to('player:/uncontrolled_fall')
		player._test_water_transition_count = 0
		player._test_water_transition_trace = {}

		return {
			dry_x = dry_probe.x,
			dry_y = dry_probe.y,
			wet_x = wet_probe.x,
			wet_y = wet_probe.y,
			runtime_x = runtime_probe.x,
			runtime_y = runtime_probe.y,
			initial_water_state = player.water_state,
			initial_transition_count = player._test_water_transition_count,
		}
	`);

	logger(`[assert] water-transition setup dry=(${state.dry_x},${state.dry_y}) wet=(${state.wet_x},${state.wet_y}) runtime=(${state.runtime_x},${state.runtime_y})`);
	assert(state.initial_water_state === 0, `expected dry initial water_state=0 got ${state.initial_water_state}`);
	assert(state.initial_transition_count === 0, `expected initial transition count 0 got ${state.initial_transition_count}`);

	return {
		name: 'runtime_enter',
		dryX: state.dry_x,
		dryY: state.dry_y,
	};
}

function teleportPlayer(engine, x, y) {
	evalLua(engine, `
		local player = object('pietolon')
		player.x = ${x}
		player.y = ${y}
		player:update_collision_state()
		player:update_water_state()
	`);
}

function getScenarioState(engine) {
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		return {
			water_state = player.water_state,
			transition_count = player._test_water_transition_count,
			first_previous_state = player._test_water_transition_trace[1] and player._test_water_transition_trace[1].previous_state or nil,
			first_water_state = player._test_water_transition_trace[1] and player._test_water_transition_trace[1].water_state or nil,
			second_previous_state = player._test_water_transition_trace[2] and player._test_water_transition_trace[2].previous_state or nil,
			second_water_state = player._test_water_transition_trace[2] and player._test_water_transition_trace[2].water_state or nil,
		}
	`);
	return {
		...state,
		active_sfx: engine.sndmaster.getActiveVoiceInfosByType('sfx').map(voice => voice.id),
	};
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);

	if (scenario.name === 'runtime_enter') {
		if (state.water_state === 0) {
			return scenario;
		}
		logger('[assert] runtime water enter observed');
		return { ...scenario, name: 'check_enter', enterCount: state.transition_count };
	}

	if (scenario.name === 'check_enter') {
		assert(state.transition_count === 1, `expected enter water_transition count 1 got ${state.transition_count}`);
		assert(state.first_previous_state === 0, `expected enter previous_state=0 got ${state.first_previous_state}`);
		assert(state.first_water_state !== 0, `expected enter water_state != 0 got ${state.first_water_state}`);
		assert(state.second_previous_state == null, `unexpected second previous_state=${state.second_previous_state}`);
		assert(state.second_water_state == null, `unexpected second water_state=${state.second_water_state}`);
		assert(state.active_sfx.includes('watersplash'), `expected watersplash active on enter got ${state.active_sfx.join(',')}`);
		logger('[assert] water-transition enter ok');
		return { ...scenario, name: 'leave', enterCount: state.transition_count };
	}

	if (scenario.name === 'leave') {
		teleportPlayer(engine, scenario.dryX, scenario.dryY);
		return { ...scenario, name: 'check_leave' };
	}

	if (scenario.name === 'check_leave') {
		assert(state.transition_count === scenario.enterCount + 1, `expected leave transition count ${scenario.enterCount + 1} got ${state.transition_count}`);
		assert(state.water_state === 0, `expected dry water_state=0 after leave got ${state.water_state}`);
		assert(state.second_previous_state !== 0, `expected leave previous_state != 0 got ${state.second_previous_state}`);
		assert(state.second_water_state === 0, `expected leave water_state=0 got ${state.second_water_state}`);
		assert(state.active_sfx.includes('watersplash'), `expected watersplash active on leave got ${state.active_sfx.join(',')}`);
		logger('[assert] water-transition leave ok');
		return { ...scenario, name: 'done' };
	}

	return scenario;
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
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

		if (scenario.name === 'boot') {
			scenario = setupScenario(engine, logger);
			return;
		}

		scenario = updateScenario(engine, scenario, logger);
		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
		}
	}, POLL_MS);
}
