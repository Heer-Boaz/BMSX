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
		local transition_trace = {}

		player.events:on({
			event = 'water_transition',
			subscriber = player,
			handler = function(event)
				transition_trace[#transition_trace + 1] = {
					previous_state = event.previous_state,
					water_state = event.water_state,
				}
			end,
		})

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
		local jump_probe = nil
		local fall_probe = nil

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
			if jump_probe == nil then
				for ty = room.tile_rows, 1, -1 do
					local player_y = room.tile_origin_y + ((ty - 1) * room.tile_size) - player.height
					if room:water_kind_at_world(player_x + constants.room.tile_half, player_y + player.height) == constants.water.body
						and not room:has_collision_flags_in_rect(player_x, player_y, player.width, player.height, constants.collision_flags.solid_mask, false)
						and not room:has_collision_flags_in_rect(player_x, player_y - 48, player.width, 48, constants.collision_flags.solid_mask, false) then
						jump_probe = {
							x = player_x,
							y = player_y,
						}
						break
					end
				end
			end
			if fall_probe == nil then
				for ty = 13, room.tile_rows do
					local player_y = room.tile_origin_y + ((ty - 1) * room.tile_size) - player.height
					if room:water_kind_at_world(player_x + constants.room.tile_half, player_y + player.height) == constants.water.body
						and not room:has_collision_flags_in_rect(player_x, player_y, player.width, player.height, constants.collision_flags.solid_mask, false)
						and not room:has_collision_flags_in_rect(player_x, player_y - 32, player.width, 32, constants.collision_flags.solid_mask, false)
						and not room:has_collision_flags_in_rect(player_x, player_y + player.height, player.width, 48, constants.collision_flags.solid_mask, false) then
						fall_probe = {
							x = player_x,
							y = player_y,
						}
						break
					end
				end
			end
		end

		assert(dry_probe ~= nil, 'no dry probe found in room 8')
		assert(surface_probe ~= nil, 'no water surface probe found in room 8')
		assert(body_probe ~= nil, 'no water body probe found in room 8')
		assert(jump_probe ~= nil, 'no submerged jump probe found in room 8')
		assert(fall_probe ~= nil, 'no submerged controlled fall probe found in room 8')

		reset_player(dry_probe.x, dry_probe.y)
		local dry_state = player.water_state

		reset_player(surface_probe.x, surface_probe.y)
		local surface_state = player.water_state

		reset_player(body_probe.x, body_probe.y)
		local body_state = player.water_state

		reset_player(dry_probe.x, dry_probe.y)
		player:update_water_state()
		transition_trace = {}
		player.x = surface_probe.x
		player.y = surface_probe.y
		local dry_to_surface_changed = player:update_water_state()
		local surface_previous_state = player.previous_water_state

		player.x = body_probe.x
		player.y = body_probe.y
		local surface_to_body_changed = player:update_water_state()
		local body_previous_state = player.previous_water_state
		player.walk_speed_accum = 0
		local water_walk_dx_1 = player:get_walk_dx()
		local water_walk_dx_2 = player:get_walk_dx()
		local water_walk_dx_3 = player:get_walk_dx()
		local water_walk_dx_4 = player:get_walk_dx()
		local water_walk_dx_total = water_walk_dx_1 + water_walk_dx_2 + water_walk_dx_3 + water_walk_dx_4

		reset_player(jump_probe.x, jump_probe.y)
		player.up_held = true
		player:start_jump(0)
		local water_jump_dy_1
		local water_jump_dy_2
		local water_jump_dy_3
		local water_jump_dy_4
		local water_jump_dy_5
		local water_jump_dy_6
		local water_jump_dy_7
		local water_jump_dy_8
		local water_jump_dy_9
		local water_jump_dy_10
		local water_jump_dy_11
		local water_jump_dy_12
		local water_jump_substate
		local water_vertical_motion_substate
		for frame = 1, 12 do
			player:update_collision_state()
			player:update_water_state()
			player:update_jump_motion()
			if frame == 1 then water_jump_dy_1 = player.last_dy end
			if frame == 2 then water_jump_dy_2 = player.last_dy end
			if frame == 3 then water_jump_dy_3 = player.last_dy end
			if frame == 4 then water_jump_dy_4 = player.last_dy end
			if frame == 5 then water_jump_dy_5 = player.last_dy end
			if frame == 6 then water_jump_dy_6 = player.last_dy end
			if frame == 7 then water_jump_dy_7 = player.last_dy end
			if frame == 8 then water_jump_dy_8 = player.last_dy end
			if frame == 9 then water_jump_dy_9 = player.last_dy end
			if frame == 10 then water_jump_dy_10 = player.last_dy end
			if frame == 11 then water_jump_dy_11 = player.last_dy end
			if frame == 12 then water_jump_dy_12 = player.last_dy end
		end
		water_jump_substate = player.jump_substate
		water_vertical_motion_substate = player.vertical_motion_substate

		reset_player(fall_probe.x, fall_probe.y)
		player.right_held = true
		player.left_held = false
		player.jump_inertia = 1
		player:reset_fall_substate_sequence()
		player:reset_vertical_motion_for_fall()
		local water_controlled_fall_dx_1
		local water_controlled_fall_dx_2
		local water_controlled_fall_dx_3
		local water_controlled_fall_dx_4
		for frame = 1, 4 do
			player:update_collision_state()
			player:update_water_state()
			player:update_controlled_fall_motion()
			if frame == 1 then water_controlled_fall_dx_1 = player.last_dx end
			if frame == 2 then water_controlled_fall_dx_2 = player.last_dx end
			if frame == 3 then water_controlled_fall_dx_3 = player.last_dx end
			if frame == 4 then water_controlled_fall_dx_4 = player.last_dx end
		end
		local water_controlled_fall_dx_total = water_controlled_fall_dx_1 + water_controlled_fall_dx_2 + water_controlled_fall_dx_3 + water_controlled_fall_dx_4

		return {
			dry_state = dry_state,
			surface_state = surface_state,
			body_state = body_state,
			dry_to_surface_changed = dry_to_surface_changed,
			surface_previous_state = surface_previous_state,
			surface_to_body_changed = surface_to_body_changed,
			body_previous_state = body_previous_state,
			transition_count = #transition_trace,
			first_transition_previous_state = transition_trace[1].previous_state,
			first_transition_water_state = transition_trace[1].water_state,
			second_transition_previous_state = transition_trace[2].previous_state,
			second_transition_water_state = transition_trace[2].water_state,
			water_walk_dx_total = water_walk_dx_total,
			water_jump_dy_1 = water_jump_dy_1,
			water_jump_dy_2 = water_jump_dy_2,
			water_jump_dy_3 = water_jump_dy_3,
			water_jump_dy_4 = water_jump_dy_4,
			water_jump_dy_5 = water_jump_dy_5,
			water_jump_dy_6 = water_jump_dy_6,
			water_jump_dy_7 = water_jump_dy_7,
			water_jump_dy_8 = water_jump_dy_8,
			water_jump_dy_9 = water_jump_dy_9,
			water_jump_dy_10 = water_jump_dy_10,
			water_jump_dy_11 = water_jump_dy_11,
			water_jump_dy_12 = water_jump_dy_12,
			water_jump_substate = water_jump_substate,
			water_vertical_motion_substate = water_vertical_motion_substate,
			water_controlled_fall_dx_1 = water_controlled_fall_dx_1,
			water_controlled_fall_dx_2 = water_controlled_fall_dx_2,
			water_controlled_fall_dx_3 = water_controlled_fall_dx_3,
			water_controlled_fall_dx_4 = water_controlled_fall_dx_4,
			water_controlled_fall_dx_total = water_controlled_fall_dx_total,
		}
	`);

	logger(
		`[assert] room8 water states dry=${state.dry_state} surface=${state.surface_state} body=${state.body_state} transitions=${state.first_transition_previous_state}->${state.first_transition_water_state},${state.second_transition_previous_state}->${state.second_transition_water_state} walk4=${state.water_walk_dx_total} jump12=${state.water_jump_dy_1},${state.water_jump_dy_2},${state.water_jump_dy_3},${state.water_jump_dy_4},${state.water_jump_dy_5},${state.water_jump_dy_6},${state.water_jump_dy_7},${state.water_jump_dy_8},${state.water_jump_dy_9},${state.water_jump_dy_10},${state.water_jump_dy_11},${state.water_jump_dy_12} cfall4=${state.water_controlled_fall_dx_1},${state.water_controlled_fall_dx_2},${state.water_controlled_fall_dx_3},${state.water_controlled_fall_dx_4}`,
	);
	assert(state.dry_state === 0, `expected dry_state=0, got ${state.dry_state}`);
	assert(state.surface_state === 1, `expected surface_state=1, got ${state.surface_state}`);
	assert(state.body_state === 2, `expected body_state=2, got ${state.body_state}`);
	assert(state.dry_to_surface_changed === true, 'expected dry->surface transition to report changed=true');
	assert(state.surface_previous_state === 0, `expected surface previous_water_state=0, got ${state.surface_previous_state}`);
	assert(state.surface_to_body_changed === true, 'expected surface->body transition to report changed=true');
	assert(state.body_previous_state === 1, `expected body previous_water_state=1, got ${state.body_previous_state}`);
	assert(state.transition_count === 2, `expected 2 water_transition events, got ${state.transition_count}`);
	assert(state.first_transition_previous_state === 0, `expected first water_transition previous_state=0, got ${state.first_transition_previous_state}`);
	assert(state.first_transition_water_state === 1, `expected first water_transition water_state=1, got ${state.first_transition_water_state}`);
	assert(state.second_transition_previous_state === 1, `expected second water_transition previous_state=1, got ${state.second_transition_previous_state}`);
	assert(state.second_transition_water_state === 2, `expected second water_transition water_state=2, got ${state.second_transition_water_state}`);
	assert(state.water_walk_dx_total === 2, `expected underwater walk total 2 over 4 frames, got ${state.water_walk_dx_total}`);
	assert(state.water_jump_dy_1 === 0, `expected underwater jump dy frame1=0, got ${state.water_jump_dy_1}`);
	assert(state.water_jump_dy_2 === 0, `expected underwater jump dy frame2=0, got ${state.water_jump_dy_2}`);
	assert(state.water_jump_dy_3 === 0, `expected underwater jump dy frame3=0, got ${state.water_jump_dy_3}`);
	assert(state.water_jump_dy_4 === -1, `expected underwater jump dy frame4=-1, got ${state.water_jump_dy_4}`);
	assert(state.water_jump_dy_5 === -2, `expected underwater jump dy frame5=-2, got ${state.water_jump_dy_5}`);
	assert(state.water_jump_dy_6 === -1, `expected underwater jump dy frame6=-1, got ${state.water_jump_dy_6}`);
	assert(state.water_jump_dy_7 === -2, `expected underwater jump dy frame7=-2, got ${state.water_jump_dy_7}`);
	assert(state.water_jump_dy_8 === -1, `expected underwater jump dy frame8=-1, got ${state.water_jump_dy_8}`);
	assert(state.water_jump_dy_9 === -2, `expected underwater jump dy frame9=-2, got ${state.water_jump_dy_9}`);
	assert(state.water_jump_dy_10 === -1, `expected underwater jump dy frame10=-1, got ${state.water_jump_dy_10}`);
	assert(state.water_jump_dy_11 === -2, `expected underwater jump dy frame11=-2, got ${state.water_jump_dy_11}`);
	assert(state.water_jump_dy_12 === -1, `expected underwater jump dy frame12=-1, got ${state.water_jump_dy_12}`);
	assert(state.water_jump_substate === 3, `expected underwater jump_substate=3 after 12 frames, got ${state.water_jump_substate}`);
	assert(state.water_vertical_motion_substate === 3, `expected underwater vertical_motion_substate=3 after 12 frames, got ${state.water_vertical_motion_substate}`);
	assert(state.water_controlled_fall_dx_1 === 0, `expected underwater controlled fall dx frame1=0, got ${state.water_controlled_fall_dx_1}`);
	assert(state.water_controlled_fall_dx_2 === 1, `expected underwater controlled fall dx frame2=1, got ${state.water_controlled_fall_dx_2}`);
	assert(state.water_controlled_fall_dx_3 === 1, `expected underwater controlled fall dx frame3=1, got ${state.water_controlled_fall_dx_3}`);
	assert(state.water_controlled_fall_dx_4 === 1, `expected underwater controlled fall dx frame4=1, got ${state.water_controlled_fall_dx_4}`);
	assert(state.water_controlled_fall_dx_total === 3, `expected underwater controlled fall total 3 over 4 frames, got ${state.water_controlled_fall_dx_total}`);
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
