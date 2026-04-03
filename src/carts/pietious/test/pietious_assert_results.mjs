const ELEVATOR_ROOM_NUMBER = 13;
const ELEVATOR_LOWER_ROOM_NUMBER = 6;
const POLL_MS = 20;
const TIMEOUT_MS = 45000;
const CART_SETTLE_MS = 500;
const STEPOFF_MAX_FRAMES = 90;
const STEPOFF_VARIANTS = [
	{ delayFrames: 0, xOffset: 10 },
	{ delayFrames: 0, xOffset: 12 },
	{ delayFrames: 0, xOffset: 13 },
	{ delayFrames: 1, xOffset: 13 },
	{ delayFrames: 2, xOffset: 13 },
];

function buttonEvent(code, down, pressId, timeMs) {
	return {
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down,
		value: down ? 1 : 0,
		timestamp: timeMs,
		pressId,
		modifiers: { ctrl: false, shift: false, alt: false, meta: false },
	};
}

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

function getLuaState(engine) {
	const [state] = evalLua(engine, `
		local collision2d = require('collision2d')
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		local expected_floor_y = -1
		local standing_on_top = false
		if player ~= nil then
			for test_y = player.y, constants.room.height - player.height do
				if player:collides_at_support_profile(player.x, test_y, false) then
					expected_floor_y = test_y
					break
				end
			end
		end
		if player ~= nil and elevator ~= nil and elevator.current_room_number == (castle and castle.current_room_number or -1)
			and player.y >= (elevator.y - constants.room.tile_size2)
			and player.y < (elevator.y + constants.room.tile_size2)
		then
			local left_foot_x = player.x + constants.room.tile_half
			local mid_foot_x = player.x + (player.width / 2)
			local right_foot_x = (player.x + player.width) - constants.room.tile_half
			local feet_over_platform_top =
				(left_foot_x >= elevator.x and left_foot_x < (elevator.x + constants.room.tile_size4))
				or (mid_foot_x >= elevator.x and mid_foot_x < (elevator.x + constants.room.tile_size4))
				or (right_foot_x >= elevator.x and right_foot_x < (elevator.x + constants.room.tile_size4))
			standing_on_top = player.y == (elevator.y - player.height) and feet_over_platform_top
		end
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_elevator = elevator ~= nil,
			room_number = castle and castle.current_room_number or -1,
			player_x = player and player.x or -1,
			player_y = player and player.y or -1,
			player_bottom = player and (player.y + player.height) or -1,
			elevator_x = elevator and elevator.x or -1,
			elevator_y = elevator and elevator.y or -1,
			elevator_bottom = elevator and (elevator.y + 16) or -1,
			elevator_room = elevator and elevator.current_room_number or -1,
			player_quiet = player and player:has_tag('v.q') or false,
			player_uncontrolled_fall = player and player:has_tag('v.uf') or false,
			player_controlled_fall = player and player:has_tag('v.cf') or false,
			player_jumping = player and player:has_tag('v.j') or false,
			player_stopped_jump = player and player:has_tag('v.sj') or false,
			player_walking_right = player and player:has_tag('v.wr') or false,
			player_walking_left = player and player:has_tag('v.wl') or false,
			player_grounded = player and player.grounded or false,
			player_right_held = player and player.right_held or false,
			player_left_held = player and player.left_held or false,
			player_last_dx = player and player.last_dx or 0,
			player_last_dy = player and player.last_dy or 0,
			player_facing = player and player.facing or 0,
			player_on_vertical_elevator = player and player.on_vertical_elevator or false,
			player_jumping_from_elevator = player and player.jumping_from_elevator or false,
			player_overlap_elevator = player and elevator and collision2d.collides(player.collider, elevator.collider) or false,
			elevator_character_over = standing_on_top,
			elevator_standing_on_top = standing_on_top,
			expected_floor_y = expected_floor_y,
		}
	`);
	return state;
}

function hasGameplayObjects(state) {
	if (!state) {
		return false;
	}
	return state.has_castle && state.has_room && state.has_player && state.has_elevator;
}

function prepareElevatorRoom(engine) {
	evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		castle.current_room_number = ${ELEVATOR_ROOM_NUMBER}
		room:load_room(${ELEVATOR_ROOM_NUMBER})
		local start = elevator.path[1]
		elevator.x = start.x
		elevator.y = start.y
		elevator.current_room_number = start.room_number
		elevator.going_to = 2
		elevator.visible = true
		elevator.collider.enabled = true
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player.events:emit('landed_to_quiet')
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.vertical_elevator_id = nil
		player.next_vertical_elevator = false
		player.next_vertical_elevator_id = nil
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
	`);
}

function prepareLowerElevatorRoom(engine) {
	evalLua(engine, `
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local elevator = object('e.p1')
		castle.current_room_number = ${ELEVATOR_LOWER_ROOM_NUMBER}
		room:load_room(${ELEVATOR_LOWER_ROOM_NUMBER})
		local start = elevator.path[2]
		elevator.x = start.x
		elevator.y = start.y
		elevator.current_room_number = start.room_number
		elevator.going_to = 1
		elevator.visible = true
		elevator.collider.enabled = true
		player:clear_input_state()
		player:zero_motion()
		player:reset_fall_substate_sequence()
		player.events:emit('landed_to_quiet')
		player.jump_substate = 0
		player.jump_inertia = 0
		player.on_vertical_elevator = false
		player.vertical_elevator_id = nil
		player.next_vertical_elevator = false
		player.next_vertical_elevator_id = nil
		player.jumping_from_elevator = false
		player.stairs_landing_sound_pending = false
	`);
}

function setupCarryScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = elevator.y - player.height
		player.on_vertical_elevator = true
		player.vertical_elevator_id = elevator.id
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] carry setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'carry',
		lastElevatorY: state.elevator_y,
		observedMoves: 0,
	};
}

function setupLandingScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = (elevator.y - player.height) - 8
		player.events:emit('falling')
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] landing setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'landing',
		lastElevatorY: state.elevator_y,
		landedMoves: 0,
		frames: 0,
	};
}

function setupCeilingScenario(engine, logger) {
	prepareElevatorRoom(engine);
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x
		player.y = elevator.y + 16
		player:start_jump(0)
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] ceiling setup player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'ceiling',
		frames: 0,
		lastElevatorY: state.elevator_y,
		observedMoves: 0,
	};
}

function setupStepOffScenario(engine, logger, variantIndex = 0) {
	prepareLowerElevatorRoom(engine);
	const variant = STEPOFF_VARIANTS[variantIndex];
	const [state] = evalLua(engine, `
		local player = object('pietolon')
		local elevator = object('e.p1')
		player.x = elevator.x + ${variant.xOffset}
		player.y = elevator.y - player.height
		player.on_vertical_elevator = true
		player.vertical_elevator_id = elevator.id
		player.facing = 1
		player.right_held = false
		return {
			player_x = player.x,
			player_y = player.y,
			elevator_x = elevator.x,
			elevator_y = elevator.y,
		}
	`);
	logger(`[assert] stepoff setup variant=${variantIndex} delay=${variant.delayFrames} xOffset=${variant.xOffset} player=(${state.player_x},${state.player_y}) elevator=(${state.elevator_x},${state.elevator_y})`);
	return {
		name: 'stepoff',
		variantIndex,
		variant,
		frames: 0,
		walk_started: false,
		saw_walking: false,
		saw_fall: false,
		released_right: false,
		probe_controls: false,
		probe_frames: 0,
	};
}

function setupLadderSwordScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local abilities = require('player_abilities')
		local castle_map = require('castle_map')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local stair = nil
		local room_number = -1

		local room_numbers = {}
		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local candidate_room_number = room_numbers[i]
			castle.current_room_number = candidate_room_number
			room:load_room(candidate_room_number)
			if #room.stairs > 0 then
				stair = room.stairs[1]
				room_number = candidate_room_number
				break
			end
		end

		if stair == nil then
			error('no stairs room found for ladder sword assert')
		end

		local middle_y = math.floor((stair.top_y + stair.bottom_y) / 2)

		local function reset_player()
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
			player.x = stair.x
			player.y = middle_y
			player.facing = 1
			player.events:emit('landed_to_quiet')
		end

		reset_player()
		player:start_stairs(-1, stair, 'stairs_up')
		local up_activated = abilities.activate_sword(player)

		reset_player()
		player:start_stairs(1, stair, 'stairs_down')
		local down_activated = abilities.activate_sword(player)

		reset_player()
		player:start_stairs(-1, stair, 'stairs_up')
		player.events:emit('stairs_quiet_left')
		local quiet_left_allowed = abilities.activate_sword(player)
		local quiet_left_state = player:has_tag('v.qst')
		player:cancel_sword()
		player.sword_cooldown = 0

		reset_player()
		player:start_stairs(-1, stair, 'stairs_up')
		player.events:emit('stairs_quiet_right')
		local quiet_right_allowed = abilities.activate_sword(player)
		local quiet_right_state = player:has_tag('v.qst')

		return {
			room_number = room_number,
			up_activated = up_activated,
			down_activated = down_activated,
			quiet_left_allowed = quiet_left_allowed,
			quiet_left_state = quiet_left_state,
			quiet_right_allowed = quiet_right_allowed,
			quiet_right_state = quiet_right_state,
		}
	`);
	logger(`[assert] ladder sword setup room=${state.room_number}`);
	return {
		name: 'ladder_sword',
		state,
	};
}

function setupRoomSwitchInputSyncScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local castle_map = require('castle_map')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local room_numbers = {}
		local source_room_number = -1

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local candidate_room_number = room_numbers[i]
			local template = castle_map.room_templates[candidate_room_number]
			if template.room_links.up > 0 then
				source_room_number = candidate_room_number
				break
			end
		end

		if source_room_number < 0 then
			error('no upward room switch found for input sync assert')
		end

		castle.current_room_number = source_room_number
		room:load_room(source_room_number)
		player:clear_input_state()
		player.up_input_sources = 1
		player.up_held = true
		local switched = player:try_switch_room('up', false)

		return {
			source_room_number = source_room_number,
			switched = switched,
			target_room_number = castle.current_room_number,
			up_input_sources = player.up_input_sources,
			up_held = player.up_held,
		}
	`);
	logger(`[assert] room switch input sync setup room=${state.source_room_number}`);
	return {
		name: 'room_switch_input_sync',
		state,
	};
}

function setupWallSnapScenario(engine, logger) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle_map = require('castle_map')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local room_numbers = {}
		local candidate = nil

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

		for key in pairs(castle_map.room_templates) do
			room_numbers[#room_numbers + 1] = key
		end
		table.sort(room_numbers)

		for i = 1, #room_numbers do
			local room_number = room_numbers[i]
			castle.current_room_number = room_number
			room:load_room(room_number)
			for test_y = constants.room.tile_origin_y, constants.room.height - player.height do
				for test_x = constants.room.tile_size + 1, constants.room.width - player.width do
					player.x = test_x
					player.y = test_y
					player:update_collision_state()
					if player:collides_at_support_profile(test_x, test_y, false)
						and player.right_wall_collision
						and not player:collides_at_jump_ceiling_profile(test_x, test_y, false)
					then
						local quiet_expected_x = (math.modf((test_x + constants.room.tile_size) / constants.room.tile_size) * constants.room.tile_size) - constants.room.tile_size
						player:snap_x_to_current_wall_grid()
						player:update_collision_state()
						if player.x == quiet_expected_x and not player.right_wall_collision then
							candidate = {
								room_number = room_number,
								x = test_x,
								y = test_y,
								expected_x = quiet_expected_x,
							}
							break
						end
					end
				end
				if candidate ~= nil then
					break
				end
			end
			if candidate ~= nil then
				break
			end
		end

		if candidate == nil then
			error('no wall-overlap candidate found for wall snap assert')
		end

		local function reset_player(x, y)
			player:clear_input_state()
			player:zero_motion()
			player:reset_fall_substate_sequence()
			player:cancel_sword()
			player.jump_substate = 0
			player.jump_inertia = 0
			player.on_vertical_elevator = false
			player.jumping_from_elevator = false
			player.stairs_landing_sound_pending = false
			player.x = x
			player.y = y
			player.events:emit('landed_to_quiet')
			player:update_collision_state()
		end

			reset_player(candidate.x, candidate.y)
			local quiet_before_x = player.x
			local quiet_before_right_wall = player.right_wall_collision
			player:update_quiet()
			player:update_collision_state()
			local quiet_after_x = player.x
			local quiet_after_right_wall = player.right_wall_collision

			reset_player(candidate.x, candidate.y)
			player.right_held = true
			player.sc:transition_to('player:/walking_right')
			player:update_collision_state()
			local walking_before_x = player.x
			local walking_before_right_wall = player.right_wall_collision
			player:update_walking_right()
			player:update_collision_state()
			local walking_after_x = player.x
			local walking_after_right_wall = player.right_wall_collision

			return {
				room_number = candidate.room_number,
				quiet_before_x = quiet_before_x,
				quiet_before_right_wall = quiet_before_right_wall,
				quiet_after_x = quiet_after_x,
				quiet_after_right_wall = quiet_after_right_wall,
				quiet_expected_x = candidate.expected_x,
				walking_before_x = walking_before_x,
				walking_before_right_wall = walking_before_right_wall,
				walking_after_x = walking_after_x,
				walking_after_right_wall = walking_after_right_wall,
				walking_expected_x = candidate.expected_x,
			}
		`);
	logger(`[assert] wall snap setup room=${state.room_number} quiet=(${state.quiet_before_x}->${state.quiet_after_x}) walk=(${state.walking_before_x}->${state.walking_after_x})`);
	return {
		name: 'wall_snap',
		state,
	};
}

function updateCarryScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	const expectedPlayerY = state.elevator_y - 16;
	assert(
		state.player_y === expectedPlayerY,
		`carry drifted: player.y=${state.player_y} expected=${expectedPlayerY} elevator.y=${state.elevator_y} overlap=${state.player_overlap_elevator}`
	);
	assert(!state.player_overlap_elevator, `carry overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.elevator_y !== scenario.lastElevatorY) {
		scenario.lastElevatorY = state.elevator_y;
		scenario.observedMoves += 1;
	}
	if (scenario.observedMoves < 8) {
		return scenario;
	}
	logger(`[assert] carry ok after ${scenario.observedMoves} elevator steps`);
	return setupLandingScenario(engine, logger);
}

function updateLandingScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	const expectedPlayerY = state.elevator_y - 16;
	assert(state.player_y <= expectedPlayerY, `player clipped into elevator: player.y=${state.player_y} topY=${expectedPlayerY}`);
	assert(!state.player_overlap_elevator, `landing overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.player_y === expectedPlayerY) {
		if (state.elevator_y !== scenario.lastElevatorY) {
			scenario.lastElevatorY = state.elevator_y;
			scenario.landedMoves += 1;
		}
		if (scenario.landedMoves >= 4) {
			logger('[assert] landing ok');
			return setupCeilingScenario(engine, logger);
		}
	} else {
		scenario.lastElevatorY = state.elevator_y;
	}
	scenario.frames += 1;
	assert(scenario.frames < 80, `player failed to land on elevator within ${scenario.frames} frames`);
	return scenario;
}

function updateCeilingScenario(engine, scenario, logger) {
	const state = getLuaState(engine);
	assert(!state.player_overlap_elevator, `player overlapped elevator from below: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	if (state.elevator_y !== scenario.lastElevatorY) {
		scenario.lastElevatorY = state.elevator_y;
		scenario.observedMoves += 1;
		if (scenario.observedMoves === 1) {
			assert(
				state.player_y === state.elevator_bottom,
				`ceiling push failed: player.y=${state.player_y} expected=${state.elevator_bottom} elevator.y=${state.elevator_y}`
			);
		}
	}
	scenario.frames += 1;
	if (scenario.observedMoves >= 8) {
		logger('[assert] ceiling ok');
		return setupStepOffScenario(engine, logger);
	}
	assert(scenario.frames < 80, `ceiling scenario did not observe enough elevator movement within ${scenario.frames} frames`);
	return scenario;
}

function updateStepOffScenario(engine, scenario, logger, scheduleInput) {
	if (!scenario.walk_started && scenario.frames >= scenario.variant.delayFrames) {
		const scheduledAtMs = Math.round(engine.platform.clock.now());
		scheduleInput([
			{
				description: `stepoff_variant_${scenario.variantIndex}_press_right`,
				delayMs: 10,
				event: buttonEvent('ArrowRight', true, (scenario.variantIndex * 4) + 1, scheduledAtMs + 10),
			},
		]);
		scenario.walk_started = true;
	}
	const state = getLuaState(engine);
	if (state.player_walking_right) {
		scenario.saw_walking = true;
	}
	if (state.player_uncontrolled_fall || state.player_controlled_fall) {
		scenario.saw_fall = true;
	}
	if (scenario.saw_fall && !scenario.released_right) {
		const scheduledAtMs = Math.round(engine.platform.clock.now());
		scheduleInput([
			{
				description: `stepoff_variant_${scenario.variantIndex}_release_right`,
				delayMs: 10,
				event: buttonEvent('ArrowRight', false, (scenario.variantIndex * 4) + 1, scheduledAtMs + 10),
			},
		]);
		scenario.released_right = true;
	}
	assert(!state.player_overlap_elevator, `stepoff overlapped elevator: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
	scenario.frames += 1;
	const landed_on_floor = state.player_grounded
		&& state.player_y === state.expected_floor_y
		&& state.player_y > state.elevator_y - 16;
	if (landed_on_floor && scenario.saw_walking && scenario.saw_fall) {
		if (scenario.probe_controls) {
			if (state.player_walking_right) {
				logger(`[assert] stepoff variant=${scenario.variantIndex} ok`);
				if (scenario.variantIndex + 1 >= STEPOFF_VARIANTS.length) {
					logger('[assert] stepoff floor landing ok');
					return setupLadderSwordScenario(engine, logger);
				}
				return setupStepOffScenario(engine, logger, scenario.variantIndex + 1);
			}
			scenario.probe_frames += 1;
			assert(
				scenario.probe_frames < 8,
				`stepoff controls stayed dead after landing: player=(${state.player_x},${state.player_y}) quiet=${state.player_quiet} wr=${state.player_walking_right} wl=${state.player_walking_left} uf=${state.player_uncontrolled_fall} cf=${state.player_controlled_fall} grounded=${state.player_grounded} heldR=${state.player_right_held} heldL=${state.player_left_held} facing=${state.player_facing} last=(${state.player_last_dx},${state.player_last_dy}) probeFrames=${scenario.probe_frames}`
			);
			return scenario;
		}
		assert(state.player_grounded, `stepoff landed quiet without grounded support: player.y=${state.player_y}`);
		assert(state.player_y === state.expected_floor_y, `stepoff landed at wrong floor y: player.y=${state.player_y} expected=${state.expected_floor_y}`);
		assert(state.player_y > state.elevator_y - 16, `stepoff never fell below elevator top: player.y=${state.player_y} elevator.y=${state.elevator_y}`);
		if (!scenario.probe_controls) {
			engine.input.getPlayerInput(1).reset();
			evalLua(engine, `object('pietolon'):clear_input_state()`);
			const scheduledAtMs = Math.round(engine.platform.clock.now());
			scheduleInput([
				{
					description: `stepoff_variant_${scenario.variantIndex}_probe_press_right`,
					delayMs: 10,
					event: buttonEvent('ArrowRight', true, (scenario.variantIndex * 4) + 2, scheduledAtMs + 10),
				},
			]);
			scenario.probe_controls = true;
			scenario.probe_frames = 0;
			return scenario;
		}
	}
	assert(
		scenario.frames < STEPOFF_MAX_FRAMES,
		`stepoff variant=${scenario.variantIndex} delay=${scenario.variant.delayFrames} xOffset=${scenario.variant.xOffset} failed within ${scenario.frames} frames: walkStarted=${scenario.walk_started} walking=${scenario.saw_walking} fall=${scenario.saw_fall} released=${scenario.released_right} player=(${state.player_x},${state.player_y}) quiet=${state.player_quiet} wr=${state.player_walking_right} wl=${state.player_walking_left} uf=${state.player_uncontrolled_fall} cf=${state.player_controlled_fall} grounded=${state.player_grounded} heldR=${state.player_right_held} heldL=${state.player_left_held} facing=${state.player_facing} last=(${state.player_last_dx},${state.player_last_dy}) expectedFloorY=${state.expected_floor_y} elevator=(${state.elevator_x},${state.elevator_y})`
	);
	return scenario;
}

function updateLadderSwordScenario(_engine, scenario, logger) {
	const state = scenario.state;
	assert(state.up_activated === false, `ladder sword activated while moving up: room=${state.room_number}`);
	assert(state.down_activated === false, `ladder sword activated while moving down: room=${state.room_number}`);
	assert(state.quiet_left_state === true, `ladder quiet-left state missing: room=${state.room_number}`);
	assert(state.quiet_right_state === true, `ladder quiet-right state missing: room=${state.room_number}`);
	assert(state.quiet_left_allowed === true, `ladder sword failed while facing left: room=${state.room_number}`);
	assert(state.quiet_right_allowed === true, `ladder sword failed while facing right: room=${state.room_number}`);
	logger('[assert] ladder sword ok');
	return setupRoomSwitchInputSyncScenario(_engine, logger);
}

function updateRoomSwitchInputSyncScenario(_engine, scenario, logger) {
	const state = scenario.state;
	assert(state.switched === true, `room switch input sync did not switch: room=${state.source_room_number}`);
	assert(state.source_room_number !== state.target_room_number, `room switch input sync stayed in same room: room=${state.source_room_number}`);
	assert(state.up_input_sources === 0, `room switch left stale up_input_sources=${state.up_input_sources}`);
	assert(state.up_held === false, `room switch left stale up_held=true`);
	logger('[assert] room switch input sync ok');
	return setupWallSnapScenario(_engine, logger);
}

function updateWallSnapScenario(_engine, scenario, logger) {
	const state = scenario.state;
	assert(state.quiet_before_right_wall === true, `wall snap quiet setup missed right wall: room=${state.room_number}`);
	assert(state.quiet_after_x < state.quiet_before_x, `wall snap quiet did not move left: before=${state.quiet_before_x} after=${state.quiet_after_x}`);
	assert(state.quiet_after_x === state.quiet_expected_x, `wall snap quiet wrong grid snap: expected=${state.quiet_expected_x} actual=${state.quiet_after_x}`);
	assert(state.quiet_after_right_wall === false, `wall snap quiet remained in wall: room=${state.room_number} x=${state.quiet_after_x}`);
	assert(state.walking_before_right_wall === true, `wall snap walking setup missed right wall: room=${state.room_number}`);
	assert(state.walking_after_x < state.walking_before_x, `wall snap walking did not move left: before=${state.walking_before_x} after=${state.walking_after_x}`);
	assert(state.walking_after_x === state.walking_expected_x, `wall snap walking wrong grid snap: expected=${state.walking_expected_x} actual=${state.walking_after_x}`);
	assert(state.walking_after_right_wall === false, `wall snap walking remained in wall: room=${state.room_number} x=${state.walking_after_x}`);
	logger('[assert] wall snap ok');
	return { name: 'done' };
}

export default function schedule({ logger, schedule: scheduleInput }) {
	let requestedNewGame = false;
	let cartActiveAt = 0;
	let lastWaitingLogAt = 0;
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

		let state;
		try {
			state = getLuaState(engine);
		}
		catch (error) {
			if (!(error instanceof Error) || !error.message.startsWith('Attempted to call a nil value.')) {
				throw error;
			}
			return;
		}
		if (!hasGameplayObjects(state)) {
			gameplayReadyAt = 0;
			const now = Date.now();
			if (now - lastWaitingLogAt >= 1000) {
				lastWaitingLogAt = now;
				if (state) {
					logger(`[assert] waiting objects castle=${state.has_castle} room=${state.has_room} player=${state.has_player} elevator=${state.has_elevator}`);
				} else {
					logger('[assert] waiting objects state=nil');
				}
			}
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
			scenario = setupCarryScenario(engine, logger);
			return;
		}
		if (scenario.name === 'carry') {
			scenario = updateCarryScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'landing') {
			scenario = updateLandingScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'ceiling') {
			scenario = updateCeilingScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'stepoff') {
			scenario = updateStepOffScenario(engine, scenario, logger, scheduleInput);
			return;
		}
		if (scenario.name === 'ladder_sword') {
			scenario = updateLadderSwordScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'room_switch_input_sync') {
			scenario = updateRoomSwitchInputSyncScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'wall_snap') {
			scenario = updateWallSnapScenario(engine, scenario, logger);
			return;
		}
		if (scenario.name === 'done') {
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] all elevator assertions passed');
		}
	}, POLL_MS);
}
