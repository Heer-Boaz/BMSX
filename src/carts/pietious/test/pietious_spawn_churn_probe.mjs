const POLL_MS = 50;
const TIMEOUT_MS = 22000;
const CART_SETTLE_MS = 500;

function fail(message) {
	throw new Error(`[probe] ${message}`);
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

function setupProbe(engine, logger) {
	globalThis.__bmsx_debug_tickrate = true;
	const [state] = evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local constants = require('constants')
		local room_spawner = require('room_spawner')
		local template = require('castle_map').room_templates[6]

		castle.current_room_number = 6
		room:load_room(6)
		room_spawner.despawn_previous()
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
		player.x = room.tile_origin_x + (14 * room.tile_size)
		player.y = room.tile_origin_y + (4 * room.tile_size)
		player.events:emit('landed_to_quiet')

		constants.enemy.vlokspawner_spawn_steps = 1
		return {
			room_number = castle.current_room_number,
			enemy_count = #template.enemies,
			spawned_room_number = room.room_number,
		}
	`);
	logger(`[probe] setup room=${state.room_number} spawnedRoom=${state.spawned_room_number} enemies=${state.enemy_count}`);
	return {
		startedAt: Date.now(),
		lastLogAt: 0,
		samples: 0,
	};
}

function sampleProbe(engine, logger, probe) {
	const [state] = evalLua(engine, `
		local world = require('world').instance
		local registry = require('registry').instance:get_registered_entities()
		local stats = world.systems:get_stats()
		local total_objects = 0
		local total_registry = 0
		local enemy_counts = {}
		local max_stat_name = ''
		local max_stat_ms = -1
		local update_vlok_ms = 0
		local update_enemy_ms = 0
		local update_room_ms = 0
		local update_player_ms = 0
		local vlok_min_y = 999999
		local vlok_max_y = -999999
		local vlok_below_bottom = 0
		local room = object('room')

		for _obj in world:objects({ scope = 'all' }) do
			total_objects = total_objects + 1
		end
		for _id in pairs(registry) do
			total_registry = total_registry + 1
		end
		for obj in world:objects({ scope = 'all' }) do
			if obj.enemy_kind ~= nil and not obj.dispose_flag then
				local key = obj.enemy_kind
				enemy_counts[key] = (enemy_counts[key] or 0) + 1
				if key == 'vlokfoe' then
					if obj.y < vlok_min_y then
						vlok_min_y = obj.y
					end
					if obj.y > vlok_max_y then
						vlok_max_y = obj.y
					end
					if obj.y >= room.world_height then
						vlok_below_bottom = vlok_below_bottom + 1
					end
				end
			end
		end
		for i = 1, #stats do
			local stat = stats[i]
			if stat.ms > max_stat_ms then
				max_stat_ms = stat.ms
				max_stat_name = stat.name
			end
			if string.find(stat.name, 'subsystem_update:room', 1, true) ~= nil then
				update_room_ms = update_room_ms + stat.ms
			end
			if string.find(stat.name, 'subsystem_update:pietolon', 1, true) ~= nil then
				update_player_ms = update_player_ms + stat.ms
			end
			if string.find(stat.name, 'subsystem_update:enemy.vlokfoe_', 1, true) ~= nil then
				update_vlok_ms = update_vlok_ms + stat.ms
			end
			if string.find(stat.name, 'subsystem_update:enemy.', 1, true) ~= nil then
				update_enemy_ms = update_enemy_ms + stat.ms
			end
		end
		local enemy_parts = {}
		for key, value in pairs(enemy_counts) do
			enemy_parts[#enemy_parts + 1] = key .. '=' .. tostring(value)
		end
		table.sort(enemy_parts)

		return {
			idcounter = world.idcounter,
			total_objects = total_objects,
			total_registry = total_registry,
			enemy_counts = table.concat(enemy_parts, ','),
			max_stat_name = max_stat_name,
			max_stat_ms = max_stat_ms,
			update_vlok_ms = update_vlok_ms,
			update_enemy_ms = update_enemy_ms,
			update_room_ms = update_room_ms,
			update_player_ms = update_player_ms,
			vlok_min_y = vlok_min_y == 999999 and -1 or vlok_min_y,
			vlok_max_y = vlok_max_y == -999999 and -1 or vlok_max_y,
			vlok_below_bottom = vlok_below_bottom,
		}
	`);

	probe.samples += 1;
	const now = Date.now();
	if (probe.lastLogAt === 0 || now - probe.lastLogAt >= 1000) {
		probe.lastLogAt = now;
		logger(
			`[probe] t=${now - probe.startedAt}ms samples=${probe.samples} idcounter=${state.idcounter} objects=${state.total_objects} registry=${state.total_registry} enemies=${state.enemy_counts} vlokY=${state.vlok_min_y}..${state.vlok_max_y} belowBottom=${state.vlok_below_bottom} top=${state.max_stat_name}:${state.max_stat_ms.toFixed(3)}ms enemyUpdate=${state.update_enemy_ms.toFixed(3)} vlokUpdate=${state.update_vlok_ms.toFixed(3)} roomUpdate=${state.update_room_ms.toFixed(3)} playerUpdate=${state.update_player_ms.toFixed(3)}`
		);
	}
	return state;
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let probe = null;

	const timeout = setTimeout(() => {
		fail('timeout while running spawn churn probe');
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
				logger('[probe] cart active, waiting for settle');
				return;
			}
			if (Date.now() - cartActiveAt < CART_SETTLE_MS) {
				return;
			}
			requestedNewGame = true;
			logger('[probe] cart active, requesting new_game');
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
			logger('[probe] gameplay objects ready, waiting for settle');
			return;
		}
		if (Date.now() - gameplayReadyAt < 1000) {
			return;
		}

		if (probe == null) {
			probe = setupProbe(engine, logger);
			return;
		}

		const sample = sampleProbe(engine, logger, probe);
		if (Date.now() - probe.startedAt >= 10000) {
			clearInterval(poll);
			clearTimeout(timeout);
			logger(
				`[probe] done idcounter=${sample.idcounter} objects=${sample.total_objects} registry=${sample.total_registry} enemies=${sample.enemy_counts} top=${sample.max_stat_name}:${sample.max_stat_ms.toFixed(3)}ms`
			);
		}
	}, POLL_MS);
}
