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
		local director = object('d')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_director = director ~= nil,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	return state && state.has_castle && state.has_room && state.has_player && state.has_director;
}

function getScenarioState(engine) {
	const [state] = evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local director = object('d')
		local director_state = 'other'
		if director.sc:matches_state_path('director:/room_switch_wait') then
			director_state = 'room_switch_wait'
		elseif director.sc:matches_state_path('director:/room') then
			director_state = 'room'
		end
		return {
			active_space = get_space(),
			room_number = castle.current_room_number,
			room_world_number = room.world_number,
			player_quiet = player:has_tag('v.q'),
			director_state = director_state,
			room_enter_count = castle._test_room_enter_count or 0,
		}
	`);
	return {
		...state,
		current_music: engine.sndmaster.currentTrackByType('music'),
		active_music: engine.sndmaster.getActiveVoiceInfosByType('music').map(voice => voice.id),
	};
}

function setupScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')

		room:load_room(109)
		castle.current_room_number = 109
		room.map_id = room.world_number
		room.map_x = 5
		room.map_y = 12
		room.last_room_switch = nil
		castle.room_enter_pending = false
		castle:reset_room_encounter_tags()
		castle:sync_world_entrance_states_for_room(room)
		castle:refresh_current_room_customizations()

		local original_emit_room_enter = castle.emit_room_enter
		castle._test_room_enter_count = 0
		castle.emit_room_enter = function(self)
			self._test_room_enter_count = self._test_room_enter_count + 1
			return original_emit_room_enter(self)
		end

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
			player.x = 120
			player.y = 160
			player.events:emit('landed_to_quiet')
			local target_room_number = room.room_links.down

			return {
				switched = player:try_switch_room('down', false),
				target_room_number = target_room_number,
			}
		`);
	logger(`[assert] seal-room switch setup target=${state.target_room_number}`);
	assert(state.switched === true, 'seal-room switch failed to start');
	assert(state.target_room_number === 100, `seal-room switch targeted room=${state.target_room_number}`);
	return {
		name: 'seal_room_switch',
		frames: 0,
	};
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);
	assert(state.room_enter_count <= 1, `seal-room room.enter duplicated count=${state.room_enter_count} director=${state.director_state} music=${state.current_music} activeMusic=${state.active_music.join(',')}`);
	if (state.room_number === 100 && state.player_quiet && state.active_space === 'main') {
		assert(state.room_world_number === 1, `seal-room wrong world_number=${state.room_world_number}`);
		assert(state.room_enter_count === 1, `seal-room room.enter count=${state.room_enter_count}`);
		logger('[assert] seal-room room.enter count ok');
		return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 250,
		`seal-room timed out room=${state.room_number} world=${state.room_world_number} space=${state.active_space} quiet=${state.player_quiet} director=${state.director_state} roomEnter=${state.room_enter_count} music=${state.current_music} activeMusic=${state.active_music.join(',')}`
	);
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

		if (scenario.name === 'boot') {
			scenario = setupScenario(engine, logger);
			return;
		}

		if (scenario.name === 'seal_room_switch') {
			scenario = updateScenario(engine, scenario, logger);
			return;
		}

		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
		}
	}, POLL_MS);
}
