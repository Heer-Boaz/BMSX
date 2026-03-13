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
		local castle_banner_timeline = director:get_timeline('director.banner.castle')
		local castle_banner_head = nil
		if castle_banner_timeline ~= nil then
			castle_banner_head = castle_banner_timeline.head
		end
		local active_enemy_count = 0
		for obj in objects_by_tag('rs') do
			if obj.enemy_kind ~= nil and obj.space_id == get_space() and not obj.dispose_flag then
				active_enemy_count = active_enemy_count + 1
			end
		end
		return {
			active_space = get_space(),
			room_number = castle.current_room_number,
			room_world_number = room.world_number,
			player_quiet = player:has_tag('v.q'),
			director_banner_active = director:has_tag('d.bt'),
			transition_banner_line = transition.banner_lines[1],
			castle_banner_head = castle_banner_head,
			room_enter_count = castle._test_room_enter_count,
			halo_teleport_count = castle._test_halo_teleport_count,
			active_enemy_count = active_enemy_count,
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
		local transition = castle_map.world_transitions_by_number[1]

		room:load_room(transition.world_room_number)
		castle.current_room_number = transition.world_room_number
		room.map_id = transition.world_number
		room.map_x = transition.world_map_x
		room.map_y = transition.world_map_y
		room.last_room_switch = nil

		player.inventory_items.halo = true
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.x = transition.world_spawn_x
		player.y = transition.world_spawn_y
		player.facing = transition.world_spawn_facing
		player.events:emit('landed_to_quiet')

		local original_emit_room_enter = castle.emit_room_enter
		castle._test_room_enter_count = 0
		castle.emit_room_enter = function(self)
			self._test_room_enter_count = self._test_room_enter_count + 1
			return original_emit_room_enter(self)
		end
		local original_halo_teleport_to_room_1 = castle.halo_teleport_to_room_1
		castle._test_halo_teleport_count = 0
		castle.halo_teleport_to_room_1 = function(self, emit_room_enter_now)
			self._test_halo_teleport_count = self._test_halo_teleport_count + 1
			return original_halo_teleport_to_room_1(self, emit_room_enter_now)
		end
		local director = object('d')
		local ok, err = pcall(function()
			director.sc:switch_state('director', '/item_screen/halo')
		end)
		if not ok then
			error('halo director switch failed: ' .. tostring(err))
		end

		return {
			world_room_number = transition.world_room_number,
			expected_banner_last_head = constants.flow.castle_banner_frames - 1,
		}
	`);
	logger(`[assert] halo setup worldRoom=${state.world_room_number}`);
	return {
		name: 'halo_world_to_castle',
		saw_banner: false,
		max_banner_head: -1,
		expected_banner_last_head: state.expected_banner_last_head,
		frames: 0,
	};
}

function updateScenario(engine, scenario, logger) {
	const state = getScenarioState(engine);
	if (!scenario.saw_banner && state.director_banner_active && state.castle_banner_head !== null && state.castle_banner_head > scenario.max_banner_head) {
		scenario.max_banner_head = state.castle_banner_head;
	}
	if (state.director_banner_active && state.castle_banner_head !== null && state.castle_banner_head > scenario.max_banner_head) {
		scenario.max_banner_head = state.castle_banner_head;
	}
	if (!scenario.saw_banner && state.director_banner_active) {
		scenario.saw_banner = true;
		assert(state.active_space === 'transition', `halo banner active_space=${state.active_space}`);
		assert(state.room_world_number === 0, `halo banner room world_number=${state.room_world_number}`);
		assert(state.transition_banner_line === 'CASTLE !', `halo banner line was "${state.transition_banner_line}"`);
		assert(state.room_enter_count === 0, `halo room.enter fired before banner count=${state.room_enter_count}`);
		assert(state.active_enemy_count === 0, `halo active enemies during banner=${state.active_enemy_count}`);
		logger('[assert] halo castle banner ok');
	}

	if (scenario.saw_banner && !state.director_banner_active && state.active_space === 'main') {
		assert(state.room_world_number === 0, `halo ended in wrong world_number=${state.room_world_number}`);
		assert(state.room_enter_count === 1, `halo room.enter count after banner=${state.room_enter_count}`);
		assert(scenario.max_banner_head === scenario.expected_banner_last_head, `halo banner head max=${scenario.max_banner_head} expected=${scenario.expected_banner_last_head}`);
		logger('[assert] halo timing ok');
		return { name: 'done' };
	}

	scenario.frames += 1;
	assert(
		scenario.frames < 300,
		`halo timed out sawBanner=${scenario.saw_banner} activeSpace=${state.active_space} world=${state.room_world_number} bannerActive=${state.director_banner_active} banner="${state.transition_banner_line}" roomEnterCount=${state.room_enter_count} bannerHead=${state.castle_banner_head} maxBannerHead=${scenario.max_banner_head} haloTeleportCount=${state.halo_teleport_count}`
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

		if (gameplayReadyAt === 0) {
			const state = getGameplayState(engine);
			if (!hasGameplayObjects(state)) {
				return;
			}
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

		if (scenario.name === 'halo_world_to_castle') {
			const state = getScenarioState(engine);
			lastStateSummary = `space=${state.active_space} world=${state.room_world_number} bannerActive=${state.director_banner_active} banner=${state.transition_banner_line} roomEnter=${state.room_enter_count} bannerHead=${state.castle_banner_head} haloTeleportCount=${state.halo_teleport_count}`;
		}

		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
			return;
		}

		scenario = updateScenario(engine, scenario, logger);
	}, POLL_MS);
}
