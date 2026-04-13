const POLL_MS = 20;
const TIMEOUT_MS = 12000;
const CART_SETTLE_MS = 500;
const SHRINE_ROOM_NUMBER = 4;

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
		local castle = oget('c')
		local player = oget('pietolon')
		local director = oget('d')
		local director_state = 'other'
		if director.sc:matches_state_path('director:/shrine/overlay') then
			director_state = 'overlay'
		elseif director.sc:matches_state_path('director:/shrine/exiting') then
			director_state = 'exiting'
		elseif director.sc:matches_state_path('director:/room') then
			director_state = 'room'
		end
		return {
			active_space = get_space(),
			room_number = castle.current_room_number,
			player_entering_shrine = player:has_tag('v.es'),
			player_waiting_shrine = player:has_tag('v.ws'),
			player_leaving_shrine = player:has_tag('v.ls'),
			player_quiet = player:has_tag('v.q'),
			player_transition_step = player.transition_step,
			player_to_enter_cut = player.to_enter_cut,
			director_state = director_state,
		}
	`);
	return {
		...state,
		current_music: engine.sndmaster.currentTrackByType('music'),
		active_sfx: engine.sndmaster.getActiveVoiceInfosByType('sfx').map(voice => voice.id),
	};
}

function setupScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local castle_map = require('castle_map')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local shrine = castle_map.room_templates[${SHRINE_ROOM_NUMBER}].shrines[1]

		if shrine == nil then
			error('shrine not found for shrine-exit assert')
		end

		room:load_room(${SHRINE_ROOM_NUMBER})
		castle.current_room_number = ${SHRINE_ROOM_NUMBER}
		room.last_room_switch = nil

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.x = shrine.x
		player.y = shrine.y
		player.facing = 1
		player.events:emit('landed_to_quiet')
		player:begin_entering_shrine(shrine)

		return {
			shrine_x = shrine.x,
			shrine_y = shrine.y,
		}
	`);
	logger(`[assert] shrine setup room=${SHRINE_ROOM_NUMBER} x=${state.shrine_x} y=${state.shrine_y}`);
	return {
		name: 'shrine_exit',
		saw_overlay: false,
		exit_scheduled: false,
		saw_exit_animation: false,
		saw_enterleave: false,
		leaving_frames: 0,
		max_abs_cut: 0,
		max_transition_step: 0,
		frames: 0,
	};
}

function requestShrineExit(engine, logger) {
	evalLua(engine, `
		oget('d').sc:transition_to('director:/shrine/exiting')
	`);
	logger('[assert] shrine exit requested');
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);
	if (!scenario.saw_overlay && state.player_waiting_shrine && state.director_state === 'overlay') {
		scenario.saw_overlay = true;
		assert(state.active_space === 'shrine', `shrine overlay active_space=${state.active_space}`);
		logger('[assert] shrine overlay ok');
	}
	if (scenario.saw_overlay && !scenario.exit_scheduled) {
		scenario.exit_scheduled = true;
		requestShrineExit(engine, logger);
	}
	if (state.player_leaving_shrine) {
		if (!scenario.saw_exit_animation) {
			scenario.saw_exit_animation = true;
			assert(state.active_space === 'main', `shrine exit active_space=${state.active_space}`);
			logger('[assert] shrine exit animation started');
		}
		assert(state.current_music === null, `shrine exit music leaked current=${state.current_music}`);
		scenario.leaving_frames = scenario.leaving_frames + 1;
		const absCut = Math.abs(state.player_to_enter_cut);
		if (absCut > scenario.max_abs_cut) {
			scenario.max_abs_cut = absCut;
		}
		if (state.player_transition_step > scenario.max_transition_step) {
			scenario.max_transition_step = state.player_transition_step;
		}
	}
	if (state.active_sfx.includes('enterleave')) {
		scenario.saw_enterleave = true;
	}
	if (scenario.saw_exit_animation && state.player_quiet && state.director_state === 'room') {
		assert(state.active_space === 'main', `shrine exit finished active_space=${state.active_space}`);
			assert(scenario.leaving_frames > 8, `shrine exit leaving_frames=${scenario.leaving_frames}`);
			assert(scenario.max_abs_cut > 0, `shrine exit max_abs_cut=${scenario.max_abs_cut}`);
			assert(scenario.max_transition_step >= 64, `shrine exit max_transition_step=${scenario.max_transition_step}`);
			assert(scenario.saw_enterleave, 'shrine exit never played enterleave');
			assert(state.current_music === 'music_castle', `shrine exit final music=${state.current_music}`);
			assert(state.player_to_enter_cut === 0, `shrine exit final cut=${state.player_to_enter_cut}`);
			logger('[assert] shrine exit animation ok');
			return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 400,
			`shrine exit timed out overlay=${scenario.saw_overlay} exitScheduled=${scenario.exit_scheduled} exitAnim=${scenario.saw_exit_animation} leavingFrames=${scenario.leaving_frames} maxCut=${scenario.max_abs_cut} maxStep=${scenario.max_transition_step} enterleave=${scenario.saw_enterleave} room=${state.room_number} space=${state.active_space} director=${state.director_state} entering=${state.player_entering_shrine} waiting=${state.player_waiting_shrine} leaving=${state.player_leaving_shrine} quiet=${state.player_quiet} step=${state.player_transition_step} cut=${state.player_to_enter_cut} music=${state.current_music} sfx=${state.active_sfx.join(',')}`
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
		if (Date.now() - gameplayReadyAt < CART_SETTLE_MS) {
			return;
		}

		if (scenario.name === 'boot') {
			scenario = setupScenario(engine, logger);
			return;
		}

		if (scenario.name === 'shrine_exit') {
			scenario = updateScenario(engine, scenario, logger);
			lastStateSummary = JSON.stringify({
				overlay: scenario.saw_overlay,
				exitScheduled: scenario.exit_scheduled,
				exitAnim: scenario.saw_exit_animation,
				leavingFrames: scenario.leaving_frames,
				maxCut: scenario.max_abs_cut,
				maxStep: scenario.max_transition_step,
				enterleave: scenario.saw_enterleave,
			});
			if (scenario.name === 'done') {
				logger('[assert] all targeted assertions passed');
				clearTimeout(timeout);
				clearInterval(poll);
			}
			return;
		}
	}, POLL_MS);
}
