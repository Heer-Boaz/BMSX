const POLL_MS = 20;
const TIMEOUT_MS = 30000;
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
	return state.has_castle && state.has_room && state.has_player;
}

function runAssert(engine, logger) {
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
			player.inventory_items['schoentjes'] = false
			player.x = x
			player.y = y
			player.events:emit('landed_to_quiet')
			player:update_collision_state()
			player:update_water_state()
		end

		castle.current_room_number = 8
		room:load_room(8)

		local dry_probe = nil
		local surface_probe = nil
		local body_probe = nil
		local walk_candidate = nil

		for tx = 1, room.tile_columns do
			local world_x = room.tile_origin_x + ((tx - 1) * room.tile_size)
			local player_x = world_x - constants.room.tile_half

			if dry_probe == nil and room:water_kind_at_world(player_x + constants.room.tile_half, room.tile_origin_y + ((11 - 1) * room.tile_size)) == constants.water.none then
				dry_probe = {
					x = player_x,
					y = room.tile_origin_y + ((11 - 1) * room.tile_size) - player.height,
				}
			end
			if surface_probe == nil and room:water_kind_at_world(player_x + constants.room.tile_half, room.tile_origin_y + ((12 - 1) * room.tile_size)) == constants.water.surface then
				surface_probe = {
					x = player_x,
					y = room.tile_origin_y + ((12 - 1) * room.tile_size) - player.height,
				}
			end
			if body_probe == nil and room:water_kind_at_world(player_x + constants.room.tile_half, room.tile_origin_y + ((13 - 1) * room.tile_size)) == constants.water.body then
				body_probe = {
					x = player_x,
					y = room.tile_origin_y + ((13 - 1) * room.tile_size) - player.height,
				}
			end
		end

		for test_y = room.tile_origin_y, constants.room.height - player.height do
			for test_x = constants.room.tile_size, constants.room.width - player.width - 8 do
				reset_player(test_x, test_y)
				if player.water_state ~= constants.water.none
					and room:water_kind_at_world(player.x + constants.room.tile_half, player.y + player.height) == player.water_state
					and player:is_support_below_at(player.x, player.y, true)
					and not player:collides_at(player.x, player.y, false)
				then
					local clear = true
					for step = 1, 4 do
						player.right_held = true
						player.left_held = false
						player:update_collision_state()
						player:update_water_state()
						player:update_walking_right()
						if player.previous_x_collision then
							clear = false
							break
						end
					end
					if clear then
						walk_candidate = {
							x = test_x,
							y = test_y,
							after_x = player.x,
							water_state = player.water_state,
						}
						break
					end
				end
			end
			if walk_candidate ~= nil then
				break
			end
		end

		assert(dry_probe ~= nil, 'no dry probe found in room 8')
		assert(surface_probe ~= nil, 'no water surface probe found in room 8')
		assert(body_probe ~= nil, 'no water body probe found in room 8')
		assert(walk_candidate ~= nil, 'no underwater walk candidate found in room 8')

		reset_player(dry_probe.x, dry_probe.y)
		local dry_state = player.water_state

		reset_player(surface_probe.x, surface_probe.y)
		local surface_state = player.water_state
		local surface_damage_threshold = constants.water.damage_threshold_body
		if player.water_persona == constants.water.persona_aphrodite then
			surface_damage_threshold = constants.water.damage_threshold_surface_aphrodite
		end

		reset_player(body_probe.x, body_probe.y)
		local body_state = player.water_state
		local body_damage_threshold = constants.water.damage_threshold_body

		reset_player(walk_candidate.x, walk_candidate.y)
		local before_x = player.x
		for step = 1, 4 do
			player.right_held = true
			player.left_held = false
			player:update_collision_state()
			player:update_water_state()
			player:update_walking_right()
		end

		return {
			dry_state = dry_state,
			surface_state = surface_state,
			body_state = body_state,
			water_persona = player.water_persona,
			surface_damage_threshold = surface_damage_threshold,
			body_damage_threshold = body_damage_threshold,
			walk_before_x = before_x,
			walk_after_x = player.x,
			walk_water_state = walk_candidate.water_state,
		}
	`);

	logger(
		`[assert] room8 water persona=${state.water_persona} states dry=${state.dry_state} surface=${state.surface_state} body=${state.body_state} thresholds=${state.surface_damage_threshold}/${state.body_damage_threshold} walk=${state.walk_before_x}->${state.walk_after_x}`,
	);
	assert(state.dry_state === 0, `expected dry_state=0, got ${state.dry_state}`);
	assert(state.surface_state === 1, `expected surface_state=1, got ${state.surface_state}`);
	assert(state.body_state === 2, `expected body_state=2, got ${state.body_state}`);
	assert(state.water_persona === 0, `expected Aphrodite water persona=0, got ${state.water_persona}`);
	assert(state.surface_damage_threshold === 254, `expected Aphrodite surface damage threshold=254, got ${state.surface_damage_threshold}`);
	assert(state.body_damage_threshold === 3, `expected water body damage threshold=3, got ${state.body_damage_threshold}`);
	assert(state.walk_water_state !== 0, `expected underwater walk state, got ${state.walk_water_state}`);
	assert(state.walk_after_x - state.walk_before_x === 2, `expected underwater walk delta=2 over 4 frames, got ${state.walk_after_x - state.walk_before_x}`);
	logger('[assert] room8 water ok');
}

export default function schedule({ logger }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let gameplayReadyAt = 0;
	let completed = false;

	const timeout = setTimeout(() => {
		fail('timeout while waiting for room8 water assert');
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

		runAssert(engine, logger);
		completed = true;
		clearInterval(poll);
		clearTimeout(timeout);
		logger('[assert] all targeted assertions passed');
	}, POLL_MS);
}
