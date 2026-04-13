const POLL_MS = 20;
const TIMEOUT_MS = 12000;
const CART_SETTLE_MS = 500;
const STABLE_FRAMES = 20;

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

function getScenarioState(engine) {
	const [state] = evalLua(engine, `
		local player = oget('pietolon')
		return {
			healing_count = player._test_event_counts and player._test_event_counts.healing or 0,
			pickupitem_count = player._test_event_counts and player._test_event_counts.pickupitem or 0,
			healing_pickup_exists = oget('test.heal') ~= nil,
			world_item_exists = oget('test.worlditem') ~= nil,
			health = player.health,
			weapon_level = player.weapon_level,
		}
	`);
	return {
		...state,
		active_sfx: engine.sndmaster.getActiveVoiceInfosByType('sfx').map(voice => voice.id),
	};
}

function setupScenario(engine, logger) {
	evalLua(engine, `
		local constants = require('constants')
		local player = oget('pietolon')
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player:cancel_sword()
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
		player.health = player.max_health - constants.pickup_item.life_regen
		player:emit_health_changed()
		player.weapon_level = 0
		player:emit_weapon_changed()
		local original_emit = player.events.emit
		player._test_event_counts = { healing = 0, pickupitem = 0 }
		player.events.emit = function(port, event_name, payload)
			if event_name == 'healing' or event_name == 'pickupitem' then
				player._test_event_counts[event_name] = player._test_event_counts[event_name] + 1
			end
			return original_emit(port, event_name, payload)
		end
		inst('loot_drop', {
			id = 'test.heal',
			loot_type = 'life',
			loot_value = constants.pickup_item.life_regen,
			space_id = 'main',
			pos = { x = player.x, y = player.y, z = 130 },
		})
	`);
	logger('[assert] pickup-audio setup ready');
	return {
		name: 'healing',
		stableFrames: 0,
		maxHealingVoices: 0,
		maxPickupitemVoices: 0,
	};
}

function spawnWorldItem(engine, logger) {
	evalLua(engine, `
		local player = oget('pietolon')
		inst('world_item', {
			id = 'test.worlditem',
			item_id = 'test.worlditem',
			item_type = 'ammo',
			space_id = 'main',
			pos = { x = player.x, y = player.y, z = 130 },
		})
	`);
	logger('[assert] spawned ammo world-item');
}

function updateHealing(engine, scenario, logger) {
	const state = getScenarioState(engine);
	const healingVoices = state.active_sfx.filter(id => id === 'healing').length;
	if (healingVoices > scenario.maxHealingVoices) {
		scenario.maxHealingVoices = healingVoices;
	}
	assert(state.healing_count <= 1, `healing emitted ${state.healing_count} times`);
	assert(scenario.maxHealingVoices <= 1, `healing audio voices overlapped max=${scenario.maxHealingVoices}`);
	if (state.healing_count === 1 && !state.healing_pickup_exists) {
		scenario.stableFrames += 1;
		if (scenario.stableFrames >= STABLE_FRAMES) {
			spawnWorldItem(engine, logger);
			return {
				name: 'pickupitem',
				stableFrames: 0,
				maxHealingVoices: scenario.maxHealingVoices,
				maxPickupitemVoices: 0,
			};
		}
	} else {
		scenario.stableFrames = 0;
	}
	return scenario;
}

function updatePickupItem(scenario, logger, state) {
	const pickupVoices = state.active_sfx.filter(id => id === 'pickupitem').length;
	if (pickupVoices > scenario.maxPickupitemVoices) {
		scenario.maxPickupitemVoices = pickupVoices;
	}
	assert(state.pickupitem_count <= 1, `pickupitem emitted ${state.pickupitem_count} times`);
	assert(scenario.maxPickupitemVoices <= 1, `pickupitem audio voices overlapped max=${scenario.maxPickupitemVoices}`);
	if (state.pickupitem_count === 1 && !state.world_item_exists) {
		scenario.stableFrames += 1;
		if (scenario.stableFrames >= STABLE_FRAMES) {
			logger('[assert] pickup-audio counts ok');
			return { name: 'done' };
		}
	} else {
		scenario.stableFrames = 0;
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

		if (scenario.name === 'healing') {
			scenario = updateHealing(engine, scenario, logger);
			return;
		}

		if (scenario.name === 'pickupitem') {
			scenario = updatePickupItem(scenario, logger, getScenarioState(engine));
			return;
		}

		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all targeted assertions passed');
		}
	}, POLL_MS);
}
