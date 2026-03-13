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
		local prewait_timeline = director:get_timeline('director.banner.prewait')
		local world_banner_timeline = director:get_timeline('director.banner.world')
		local prewait_head = nil
		local world_banner_head = nil
		if prewait_timeline ~= nil then
			prewait_head = prewait_timeline.head
		end
		if world_banner_timeline ~= nil then
			world_banner_head = world_banner_timeline.head
		end
		return {
			room_number = castle.current_room_number,
			room_world_number = room.world_number,
			player_entering_world = player:has_tag('v.ew'),
			player_waiting_world_banner = player:has_tag('v.wwb'),
			player_quiet = player:has_tag('v.q'),
			player_transition_step = player.transition_step,
			player_to_enter_cut = player.to_enter_cut,
			director_banner_active = director:has_tag('d.bt'),
			transition_banner_has_line = transition.banner_lines[1] ~= nil,
			transition_banner_line = transition.banner_lines[1],
			prewait_head = prewait_head,
			world_banner_head = world_banner_head,
			appearance_count = director._test_appearance_count,
			gamestart_count = director._test_gamestart_count,
			room_enter_count = castle._test_room_enter_count,
		}
	`);
	return state;
}

function setupScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local castle_map = require('castle_map')
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local director = object('d')
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
			error('world_1 entrance not found for enter-world assert')
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

		local original_emit_room_enter = castle.emit_room_enter
		local original_emit = director.events.emit
		castle._test_room_enter_count = 0
		director._test_appearance_count = 0
		director._test_gamestart_count = 0
		castle.emit_room_enter = function(self)
			self._test_room_enter_count = self._test_room_enter_count + 1
			return original_emit_room_enter(self)
		end
		director.events.emit = function(events, event_name, payload)
			if event_name == 'appearance' then
				director._test_appearance_count = director._test_appearance_count + 1
			end
			if event_name == 'gamestart' then
				director._test_gamestart_count = director._test_gamestart_count + 1
			end
			return original_emit(events, event_name, payload)
		end

		player:begin_entering_world(entrance)

		return {
			castle_room_number = spec.castle_room_number,
			world_room_number = spec.world_room_number,
			expected_prewait_last_head = constants.flow.room_transition_frames - 1,
			expected_banner_last_head = constants.flow.world_banner_frames - 1,
		}
	`);
	logger(`[assert] enter-world setup castleRoom=${state.castle_room_number} worldRoom=${state.world_room_number}`);
	return {
		name: 'enter_world',
		saw_pause: false,
		saw_waiting_banner: false,
		max_prewait_head: -1,
		max_banner_head: -1,
		expected_prewait_last_head: state.expected_prewait_last_head,
		expected_banner_last_head: state.expected_banner_last_head,
		frames: 0,
	};
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);
	if (state.player_waiting_world_banner && !state.director_banner_active && state.prewait_head !== null && state.prewait_head > scenario.max_prewait_head) {
		scenario.max_prewait_head = state.prewait_head;
	}
	if (state.director_banner_active && state.world_banner_head !== null && state.world_banner_head > scenario.max_banner_head) {
		scenario.max_banner_head = state.world_banner_head;
	}
	if (!scenario.saw_pause && state.player_waiting_world_banner && !state.director_banner_active) {
		scenario.saw_pause = true;
		assert(state.room_world_number === 1, `enter-world pre-banner switched to wrong world_number=${state.room_world_number}`);
		assert(state.transition_banner_has_line === false, `enter-world pre-banner line was "${state.transition_banner_line}"`);
		assert(state.room_enter_count === 0, `room.enter fired during pre-banner count=${state.room_enter_count}`);
		assert(state.appearance_count === 1, `appearance cue count during pre-banner=${state.appearance_count}`);
		assert(state.gamestart_count === 0, `gamestart cue count during pre-banner=${state.gamestart_count}`);
		logger('[assert] enter-world pre-banner pause ok');
	}
	if (!scenario.saw_waiting_banner && state.player_waiting_world_banner && state.director_banner_active) {
		scenario.saw_waiting_banner = true;
		assert(state.room_world_number === 1, `enter-world switched to wrong world_number=${state.room_world_number}`);
		assert(state.transition_banner_line === 'WORLD 1 !', `enter-world banner line was "${state.transition_banner_line}"`);
		assert(state.room_enter_count === 0, `room.enter fired too early count=${state.room_enter_count}`);
		assert(state.appearance_count === 1, `appearance cue count at banner=${state.appearance_count}`);
		assert(state.gamestart_count === 1, `gamestart cue count at banner=${state.gamestart_count}`);
		logger('[assert] enter-world banner ok');
	}

	if (scenario.saw_waiting_banner && state.player_quiet) {
		assert(state.room_world_number === 1, `enter-world ended in wrong world_number=${state.room_world_number}`);
		assert(state.room_enter_count === 1, `room.enter count after banner=${state.room_enter_count}`);
		assert(scenario.max_prewait_head === scenario.expected_prewait_last_head, `enter-world prewait head max=${scenario.max_prewait_head} expected=${scenario.expected_prewait_last_head}`);
		assert(scenario.max_banner_head === scenario.expected_banner_last_head, `enter-world banner head max=${scenario.max_banner_head} expected=${scenario.expected_banner_last_head}`);
		logger('[assert] enter-world timing ok');
		return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 400,
		`enter-world timed out pause=${scenario.saw_pause} waiting=${scenario.saw_waiting_banner} room=${state.room_number} world=${state.room_world_number} entering=${state.player_entering_world} waiting=${state.player_waiting_world_banner} quiet=${state.player_quiet} bannerActive=${state.director_banner_active} banner="${state.transition_banner_line}" appearance=${state.appearance_count} gamestart=${state.gamestart_count} roomEnterCount=${state.room_enter_count} prewaitHead=${state.prewait_head} bannerHead=${state.world_banner_head} maxPrewaitHead=${scenario.max_prewait_head} maxBannerHead=${scenario.max_banner_head} step=${state.player_transition_step} cut=${state.player_to_enter_cut}`
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
		if (scenario.name === 'enter_world') {
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
