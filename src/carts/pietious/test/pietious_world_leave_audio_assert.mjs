const POLL_MS = 20;
const TIMEOUT_MS = 20000;
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
		local transition = object('transition')
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
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local director = object('d')
		local transition = object('transition')
		local castle_banner_timeline = director:get_timeline('director.banner.castle')
		local director_state = 'other'
		local castle_banner_head = nil
		if castle_banner_timeline ~= nil then
			castle_banner_head = castle_banner_timeline.head
		end
		if director.sc:matches_state_path('director:/world_transition_leave') then
			director_state = 'world_transition_leave'
		elseif director.sc:matches_state_path('director:/banner_transition/castle_emerge_showing') then
			director_state = 'castle_emerge_showing'
		elseif director.sc:matches_state_path('director:/world_transition_emerge') then
			director_state = 'world_transition_emerge'
		elseif director.sc:matches_state_path('director:/room_switch_wait_visible') then
			director_state = 'room_switch_wait_visible'
		elseif director.sc:matches_state_path('director:/room') then
			director_state = 'room'
		end
		return {
			active_space = get_space(),
			room_number = castle.current_room_number,
			room_world_number = room.world_number,
			player_waiting_world_banner = player:has_tag('v.wwb'),
			player_waiting_world_emerge = player:has_tag('v.wwe'),
			player_emerging_world = player:has_tag('v.ewd'),
			player_quiet = player:has_tag('v.q'),
			player_transition_step = player.transition_step,
			player_to_enter_cut = player.to_enter_cut,
			director_state = director_state,
			director_banner_active = director:has_tag('d.bt'),
			transition_banner_line = transition.banner_lines[1],
			castle_banner_head = castle_banner_head,
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
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local spec = castle_map.world_transitions.world_1
		local template = castle_map.room_templates[spec.castle_room_number]
		local entrance = nil

		for i = 1, #template.world_entrances do
			local candidate = template.world_entrances[i]
			if candidate.target == spec.target then
				entrance = candidate
				break
			end
		end

		if entrance == nil then
			error('world_1 entrance not found for world-leave assert')
		end

		room:load_room(spec.castle_room_number)
		castle.current_room_number = spec.castle_room_number
		room.map_id = 0
		room.map_x = spec.castle_map_x
		room.map_y = spec.castle_map_y
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
		player.x = entrance.stair_x
		player.y = entrance.stair_y
		player.facing = 1
		player.events:emit('landed_to_quiet')
		player:begin_entering_world(entrance)

		return {
			castle_room_number = spec.castle_room_number,
			world_room_number = spec.world_room_number,
		}
	`);
	logger(`[assert] world-leave setup castleRoom=${state.castle_room_number} worldRoom=${state.world_room_number}`);
	return {
		name: 'enter_world',
		saw_banner: false,
		saw_emerge: false,
		saw_enterleave: false,
		frames: 0,
	};
}

function startWorldLeave(engine, logger) {
	evalLua(engine, `
		local player = object('pietolon')
		player:try_switch_room('right')
	`);
	logger('[assert] world-leave started');
	return {
		name: 'world_leave_audio',
		saw_banner: false,
		saw_emerge: false,
		saw_enterleave: false,
		frames: 0,
	};
}

function updateWorldLeave(engine, scenario, logger) {
	const state = getScenarioState(engine);
	if (state.active_sfx.includes('enterleave')) {
		scenario.saw_enterleave = true;
	}
	if (!scenario.saw_banner && state.director_banner_active) {
		scenario.saw_banner = true;
		assert(state.transition_banner_line === 'CASTLE !', `world-leave banner line="${state.transition_banner_line}"`);
		logger('[assert] world-leave banner ok');
	}
	if (!scenario.saw_emerge && state.player_emerging_world) {
		scenario.saw_emerge = true;
		assert(state.current_music === null, `world-leave emerge music started too early current=${state.current_music}`);
		logger('[assert] world-leave emerge silence ok');
	}
	if (scenario.saw_emerge && state.player_emerging_world) {
		assert(state.current_music === null, `world-leave emerge music leaked current=${state.current_music}`);
	}
	if (scenario.saw_emerge && state.player_quiet && state.active_space === 'main' && state.room_world_number === 0) {
		assert(scenario.saw_enterleave, 'world-leave never played enterleave');
		assert(state.current_music === 'music_castle', `world-leave final music=${state.current_music}`);
		logger('[assert] world-leave audio timing ok');
		return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 400,
		`world-leave timed out banner=${scenario.saw_banner} emerge=${scenario.saw_emerge} enterleave=${scenario.saw_enterleave} room=${state.room_number} world=${state.room_world_number} space=${state.active_space} director=${state.director_state} quiet=${state.player_quiet} wwb=${state.player_waiting_world_banner} wwe=${state.player_waiting_world_emerge} ewd=${state.player_emerging_world} bannerActive=${state.director_banner_active} banner="${state.transition_banner_line}" bannerHead=${state.castle_banner_head} music=${state.current_music} sfx=${state.active_sfx.join(',')} step=${state.player_transition_step} cut=${state.player_to_enter_cut}`
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

		if (scenario.name === 'enter_world') {
			const worldState = getScenarioState(engine);
			if (worldState.player_quiet && worldState.room_world_number === 1 && worldState.current_music === 'music_world') {
				logger('[assert] enter-world prep ok');
				scenario = startWorldLeave(engine, logger);
				return;
			}
			scenario.frames += 1;
			assert(
				scenario.frames < 500,
				`enter-world prep timed out room=${worldState.room_number} world=${worldState.room_world_number} space=${worldState.active_space} quiet=${worldState.player_quiet} waiting=${worldState.player_waiting_world_banner} music=${worldState.current_music} director=${worldState.director_state}`
			);
			return;
		}

		if (scenario.name === 'world_leave_audio') {
			scenario = updateWorldLeave(engine, scenario, logger);
			lastStateSummary = JSON.stringify(getScenarioState(engine));
			return;
		}

		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
		}
	}, POLL_MS);
}
