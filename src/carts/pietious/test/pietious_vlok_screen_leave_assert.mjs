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

function setupProbe(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local room_spawner = require('room_spawner')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')

		__probe_screen_leave_count = 0

		castle.current_room_number = 6
		room:load_room(6)
		room_spawner.despawn_previous()

		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.events:emit('landed_to_quiet')

		local enemy = inst('enemy.vlokfoe', {
			id = 'probe.vlok',
			space_id = 'main',
			pos = { x = 96, y = constants.room.height - 1, z = 140 },
			speed_x_num = 0,
			speed_y_num = 2,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
		})
		enemy.events:on({
			event = 'screen.leave',
			subscriber = enemy,
			handler = function()
				__probe_screen_leave_count = __probe_screen_leave_count + 1
			end,
		})

		return {
			enemy_id = enemy.id,
			start_y = enemy.y,
			bottom = constants.room.height,
		}
	`);
	logger(`[assert] spawned ${state.enemy_id} at y=${state.start_y} bottom=${state.bottom}`);
}

function sampleProbe(engine) {
	const [state] = evalLua(engine, `
		local world = require('world').instance
		local found = false
		local y = -1
		local old_y = -1
		local dispose_flag = false

		for obj in world:all_objects() do
			if obj.id == 'probe.vlok' then
				local boundary = obj:get_component('screenboundarycomponent')
				found = true
				y = obj.y
				old_y = boundary and boundary.old_pos.y or -1
				dispose_flag = obj.dispose_flag
				break
			end
		end

		return {
			found = found,
			y = y,
			old_y = old_y,
			dispose_flag = dispose_flag,
			screen_leave_count = __probe_screen_leave_count or 0,
		}
	`);
	return state;
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let setupAt = 0;
	let probeReady = false;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for vlok screen leave assert');
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

		if (!probeReady) {
			setupProbe(engine, logger);
			setupAt = Date.now();
			probeReady = true;
			return;
		}

		const sample = sampleProbe(engine);
		logger(`[assert] found=${sample.found} y=${sample.y} oldY=${sample.old_y} dispose=${sample.dispose_flag} leave=${sample.screen_leave_count}`);
		if (!sample.found) {
			assert(sample.screen_leave_count > 0, 'expected screen.leave before vlok disposal');
			completed = true;
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] vlok screen.leave cleanup ok');
			return;
		}

		if (Date.now() - setupAt > 1000) {
			assert(false, `probe.vlok still alive after 1000ms at y=${sample.y} leave=${sample.screen_leave_count}`);
		}
	}, POLL_MS);
}
