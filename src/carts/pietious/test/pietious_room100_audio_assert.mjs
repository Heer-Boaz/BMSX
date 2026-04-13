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
		local director = oget('d')
		local transition = oget('transition')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_director = director ~= nil,
			has_transition = transition ~= nil,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	return state
		&& state.has_castle
		&& state.has_room
		&& state.has_player
		&& state.has_director
		&& state.has_transition;
}

function getScenarioState(engine) {
	const [state] = evalLua(engine, `
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local director = oget('d')
		local director_state = 'other'
		if director.sc:matches_state_path('director:/room_switch_wait') then
			director_state = 'room_switch_wait'
		elseif director.sc:matches_state_path('director:/room') then
			director_state = 'room'
		end
		return {
			room_number = castle.current_room_number,
			room_world_number = room.world_number,
			room_enter_count = castle._test_room_enter_count,
			player_quiet = player:has_tag('v.q'),
			director_state = director_state,
		}
	`);
	return {
		...state,
		current_music: engine.sndmaster.currentTrackByType('music'),
		active_music: engine.sndmaster.getActiveVoiceInfosByType('music').map(voice => voice.id),
		audio_trace: globalThis.__pietiousRoom100AudioTrace ?? [],
	};
}

function installAudioTrace(engine) {
	const snd = engine.sndmaster;
	const trace = [];
	globalThis.__pietiousRoom100AudioTrace = trace;

	const originalRequestMusicTransition = snd.requestMusicTransition.bind(snd);
	snd.requestMusicTransition = function requestMusicTransitionProxy(options) {
		const sync = options.sync;
		let syncLabel = 'immediate';
		if (typeof sync === 'string') {
			syncLabel = sync;
		} else if (sync && typeof sync === 'object') {
			if (sync.stinger !== undefined) {
				syncLabel = `stinger:${sync.stinger}`;
			} else if (sync.delay_ms !== undefined) {
				syncLabel = `delay:${sync.delay_ms}`;
			}
		}
		trace.push({
			type: 'transition',
			frame: engine.view?.renderFrameIndex ?? -1,
			to: options.to,
			sync: syncLabel,
			current_music: snd.currentTrackByType('music'),
		});
		return originalRequestMusicTransition(options);
	};

	const originalPlay = snd.play.bind(snd);
	snd.play = async function playProxy(id, options) {
		trace.push({
			type: 'play',
			frame: engine.view?.renderFrameIndex ?? -1,
			id,
			current_music: snd.currentTrackByType('music'),
		});
		return await originalPlay(id, options);
	};
}

function setupScenario(engine, logger) {
	installAudioTrace(engine);
	evalLua(engine, `
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local room_spawner = require('room_spawner')

		room:load_room(109)
		castle.current_room_number = 109
		room.map_id = 1
		room.map_x = 2
		room.map_y = 4
		room.last_room_switch = nil

		castle:reset_room_encounter_tags()
		castle:sync_world_entrance_states_for_room(room)
		castle:refresh_current_room_customizations()
		room_spawner.spawn_all_for_room(room)

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.x = room.spawn.x
		player.y = room.spawn.y
		player.facing = room.spawn.facing
		player.events:emit('landed_to_quiet')

		castle:emit_room_enter()

		local original_emit_room_enter = castle.emit_room_enter
		castle._test_room_enter_count = 0
		castle.emit_room_enter = function(self)
			self._test_room_enter_count = self._test_room_enter_count + 1
			return original_emit_room_enter(self)
		end
	`);
	logger('[assert] room100 setup complete');
	return {
		name: 'prepare',
		frames: 0,
	};
}

function startRoomSwitch(engine, logger) {
	evalLua(engine, `
		local player = oget('pietolon')
		player:try_switch_room('down')
	`);
	logger('[assert] room100 switch started');
	return {
		name: 'switching',
		frames: 0,
	};
}

function summarizeTrace(trace) {
	return trace.map(entry => {
		if (entry.type === 'transition') {
			return `${entry.frame}:${entry.type}:${entry.to}:${entry.sync}:${entry.current_music}`;
		}
		return `${entry.frame}:${entry.type}:${entry.id}:${entry.current_music}`;
	}).join('|');
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);
	if (scenario.name === 'prepare') {
		if (state.room_number === 109 && state.player_quiet && state.current_music === 'music_world') {
			logger('[assert] room100 prep ok');
			return startRoomSwitch(engine, logger);
		}
		scenario.frames += 1;
		assert(
			scenario.frames < 200,
			`room100 prep timed out room=${state.room_number} world=${state.room_world_number} quiet=${state.player_quiet} music=${state.current_music} trace=${summarizeTrace(state.audio_trace)}`
		);
		return scenario;
	}

	if (state.room_number === 100 && state.player_quiet && state.director_state === 'room') {
		const trace = state.audio_trace;
		const sealTransitions = trace.filter(entry => entry.type === 'transition' && entry.to === 'music_seal_2');
		const sealStingers = trace.filter(entry => entry.type === 'play' && entry.id === 'music_seal_1');
		assert(state.room_enter_count === 1, `room100 room.enter count=${state.room_enter_count} trace=${summarizeTrace(trace)}`);
		assert(sealTransitions.length === 1, `room100 music_seal_2 transition count=${sealTransitions.length} trace=${summarizeTrace(trace)}`);
		assert(sealStingers.length === 1, `room100 music_seal_1 play count=${sealStingers.length} trace=${summarizeTrace(trace)}`);
		logger('[assert] room100 audio timing ok');
		return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 240,
		`room100 switch timed out room=${state.room_number} world=${state.room_world_number} quiet=${state.player_quiet} director=${state.director_state} roomEnter=${state.room_enter_count} music=${state.current_music} activeMusic=${state.active_music.join(',')} trace=${summarizeTrace(state.audio_trace)}`
	);
	return scenario;
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let scenario = { name: 'boot' };
	let lastStateSummary = 'not-started';

	const timeout = setTimeout(() => {
		fail(`timeout while waiting for scenario=${scenario.name} state=${lastStateSummary}`);
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

		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
			setTimeout(() => process.exit(0), 50);
			return;
		}

		const state = getScenarioState(engine);
		lastStateSummary = `room=${state.room_number} world=${state.room_world_number} quiet=${state.player_quiet} director=${state.director_state} roomEnter=${state.room_enter_count} music=${state.current_music} trace=${summarizeTrace(state.audio_trace)}`;
		scenario = updateScenario(engine, scenario, logger);
	}, POLL_MS);
}
