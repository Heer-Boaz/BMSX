-- cartlib/input/input.lua
-- Cart-owned player input: action mappings and action-expression state built from
-- raw ICU snapshot reads (keyboard bitmap, pad button/axis words, pointer words).
-- Edge detection (just_pressed/just_released) is derived here from latched levels.
-- Physical edges receive one monotone id. Frame and gameplay clock states retain
-- independent previous-id boundaries, so each clock observes an edge once even
-- when gameplay admission skips physical frames. Bound evaluators capture their
-- clock state and add no clock-selection branch to the update path.

local action_parser<const> = require('cartlib/input/action_parser')
local action_state_program<const> = require('cartlib/input/action_state_program')
local action_syntax<const> = require('cartlib/input/action_syntax')
local clock<const> = require('cartlib/clock')
local icu<const> = require('cartlib/input/icu')
local key<const> = require('cartlib/input/keys')

local input<const> = {}

local source_keyboard<const> = 1
local source_gamepad<const> = 2
local source_pointer<const> = 3
local keys<const> = key.usage_by_code
local pointer_buttons<const>: *word = icu.pointer_buttons_address
local pointer_position_x_q16<const>: *word = icu.pointer_x_q16_address
local pointer_position_y_q16<const>: *word = icu.pointer_y_q16_address
local pointer_wheel_q16<const>: *word = icu.pointer_wheel_q16_address
local word_sign_mask<const> = 0x80000000
local word_range<const> = 0x100000000
local gamepad_bits<const> = {
	['a'] = 0x00000000, ['b'] = 0x00000001, ['x'] = 0x00000002, ['y'] = 0x00000003,
	['lb'] = 0x00000004, ['rb'] = 0x00000005, ['lt'] = 0x00000006, ['rt'] = 0x00000007,
	['select'] = 0x00000008, ['start'] = 0x00000009, ['ls'] = 0x0000000a, ['rs'] = 0x0000000b,
	['up'] = 0x0000000c, ['down'] = 0x0000000d, ['left'] = 0x0000000e, ['right'] = 0x0000000f,
	['home'] = 0x00000010, ['touch'] = 0x00000011,
}
local gamepad_stick_axes<const> = {
	ls = {
		x = icu.gamepad_left_x_q16_offset,
		y = icu.gamepad_left_y_q16_offset,
	},
	rs = {
		x = icu.gamepad_right_x_q16_offset,
		y = icu.gamepad_right_y_q16_offset,
	},
}

local pointer_bits<const> = {
	['pointer_primary'] = 0x00000000,
	['pointer_aux'] = 0x00000001,
	['pointer_secondary'] = 0x00000002,
	['pointer_back'] = 0x00000003,
	['pointer_forward'] = 0x00000004,
}

local buffer_frame_retention<const> = 150
local initial_repeat_delay_frames<const> = 15
local repeat_interval_frames<const> = 4
local guard_window_frames<const> = 2
-- Sentinel for "no press/release seen": larger than any reachable frame delta.
local no_edge_delta<const> = action_syntax.no_edge_delta
local evaluation_requirement<const> = action_syntax.evaluation_requirement
local requirement_pressed<const> = evaluation_requirement.pressed | evaluation_requirement.consumed
local requirement_just_pressed<const> = evaluation_requirement.just_pressed | evaluation_requirement.consumed
local requirement_just_released<const> = evaluation_requirement.just_released | evaluation_requirement.consumed
local requirement_value_q16<const> = evaluation_requirement.value_q16
local requirement_vector_q16<const> = evaluation_requirement.vector_q16

local default_keyboard<const> = {
	a = { 'KeyX' },
	b = { 'KeyC' },
	x = { 'KeyZ' },
	y = { 'KeyS' },
	lb = { 'ShiftLeft' },
	rb = { 'ShiftRight' },
	lt = { 'ControlLeft' },
	rt = { 'AltLeft' },
	select = { 'ControlRight' },
	start = { 'AltRight' },
	ls = { 'KeyQ' },
	rs = { 'KeyE' },
	up = { 'ArrowUp' },
	down = { 'ArrowDown' },
	left = { 'ArrowLeft' },
	right = { 'ArrowRight' },
	home = { 'Escape' },
	touch = { 'Space' },
}

local default_gamepad<const> = {
	a = { 'a' },
	b = { 'b' },
	x = { 'x' },
	y = { 'y' },
	lb = { 'lb' },
	rb = { 'rb' },
	lt = { 'lt' },
	rt = { 'rt' },
	select = { 'select' },
	start = { 'start' },
	ls = { 'ls' },
	rs = { 'rs' },
	up = { 'up' },
	down = { 'down' },
	left = { 'left' },
	right = { 'right' },
	home = { 'home' },
	touch = { 'touch' },
}

local default_pointer<const> = {
	pointer_primary = { 'pointer_primary' },
	pointer_secondary = { 'pointer_secondary' },
	pointer_aux = { 'pointer_aux' },
	pointer_back = { 'pointer_back' },
	pointer_forward = { 'pointer_forward' },
	pointer_delta = { 'pointer_delta' },
	pointer_position = { 'pointer_position' },
	pointer_wheel = { 'pointer_wheel' },
}

local players<const> = {}
local player_list<const> = {}
local player_count = 0
bss frame_serial: word

local new_binding_state<const> = function()
	return {
		-- raw read plan, resolved per binding at admission
		level_addr = 0,
		level_mask = 0,
		value_addr = 0,
		value_x_addr = 0,
		value_y_addr = 0,
		axis_addr = 0,
		axis_positive = false,
		axis_actuation_q16 = 0,
		pressed_from_value = false,
		is_pointer_delta = false,
		prev_x_q16 = 0,
		prev_y_q16 = 0,
		pressed = false,
		press_edge_id = 0,
		release_edge_id = 0,
		consumed_press_id = -1,
		press_start_frame = 0,
		last_press_frame = -buffer_frame_retention,
		last_release_frame = -buffer_frame_retention,
		value_q16 = 0,
		value_x_q16 = 0,
		value_y_q16 = 0,
	}
end

local resolve_non_keyboard_binding<const> = function(player, source_index, binding, state)
	if source_index == source_gamepad then
		local pad_base<const> = icu.gamepad_base_address + (player.index - 1) * icu.gamepad_stride
		if type(binding) == 'table' then
			state.axis_addr = pad_base + binding.axis_offset
			state.axis_positive = binding.positive
			state.axis_actuation_q16 = binding.actuation_q16
			return
		end
		local bit<const> = gamepad_bits[binding]
		if bit then
			state.level_addr = pad_base + icu.gamepad_buttons_offset
			state.level_mask = 1 << bit
			if binding == 'ls' then
				state.value_x_addr = pad_base + icu.gamepad_left_x_q16_offset
				state.value_y_addr = pad_base + icu.gamepad_left_y_q16_offset
			elseif binding == 'rs' then
				state.value_x_addr = pad_base + icu.gamepad_right_x_q16_offset
				state.value_y_addr = pad_base + icu.gamepad_right_y_q16_offset
			elseif binding == 'lt' then
				state.value_addr = pad_base + icu.gamepad_left_trigger_q16_offset
			elseif binding == 'rt' then
				state.value_addr = pad_base + icu.gamepad_right_trigger_q16_offset
			end
		end
		return
	end
	local bit<const> = pointer_bits[binding]
	if bit then
		state.level_addr = pointer_buttons
		state.level_mask = 1 << bit
	elseif binding == 'pointer_position' then
		state.value_x_addr = pointer_position_x_q16
		state.value_y_addr = pointer_position_y_q16
	elseif binding == 'pointer_delta' then
		state.is_pointer_delta = true
	elseif binding == 'pointer_wheel' then
		state.value_addr = pointer_wheel_q16
		state.pressed_from_value = true
	end
end

local new_action_state<const> = function(action, clock_state)
	return {
		action = action,
		clock_state = clock_state,
		source_lists = {
			{ source_index = source_keyboard },
			{ source_index = source_gamepad },
			{ source_index = source_pointer },
		},
		resolved_sources = {},
		resolved_source_count = 0,
		pressed = false,
		just_pressed = false,
		just_released = false,
		all_just_pressed = false,
		all_just_released = false,
		consumed = false,
		guarded_just_pressed = false,
		repeat_pressed = false,
		repeat_count = 0,
		press_time = 0,
		value_q16 = 0,
		value_x_q16 = 0,
		value_y_q16 = 0,
		press_id = 0,
		-- Cached frame deltas; was* derives from these per window.
		min_press_delta = no_edge_delta,
		min_release_delta = no_edge_delta,
		evaluation_requirement_mask = 0,
		-- Frame sampling, context changes and consumption all advance the
		-- player's single retained cache serial.
		evaluation_serial = -1,
		guard_last_press_id = -1,
		guard_last_accepted_frame = -guard_window_frames - 1,
		guard_last_result = false,
		repeat_active = false,
		repeat_press_start_frame = -1,
		repeat_last_frame = -1,
		repeat_last_result = false,
		repeat_last_repeat_frame = -1,
	}
end

local context_less<const> = function(a, b)
	if a.priority ~= b.priority then
		return a.priority < b.priority
	end
	return a.order < b.order
end

-- Record one physical transition. Clock-specific action evaluators derive their
-- transient edge flags from this retained id instead of clearing every button.
local apply_digital_edge<const> = function(player, state, pressed_now, frame)
	local edge_id<const> = player.next_edge_id
	player.next_edge_id = edge_id + 1
	if pressed_now then
		state.press_edge_id = edge_id
		state.press_start_frame = frame
		state.last_press_frame = frame
	else
		state.release_edge_id = edge_id
		state.last_release_frame = frame
	end
	state.pressed = pressed_now
end

local sample_axis_group<const> = function(player, group, frame)
	local axis<const>: *word = group.addr
	local raw_value<const> = *axis
	local positive_q16 = 0
	local negative_q16 = 0
	if raw_value & word_sign_mask == 0 then
		positive_q16 = raw_value
	else
		negative_q16 = word_range - raw_value
	end
	local positive_states<const> = group.positive_states
	for i = 1, #positive_states do
		local state<const> = positive_states[i]
		state.value_q16 = positive_q16
		local pressed<const> = positive_q16 >= state.axis_actuation_q16
		if pressed ~= state.pressed then
			apply_digital_edge(player, state, pressed, frame)
		end
	end
	local negative_states<const> = group.negative_states
	for i = 1, #negative_states do
		local state<const> = negative_states[i]
		state.value_q16 = negative_q16
		local pressed<const> = negative_q16 >= state.axis_actuation_q16
		if pressed ~= state.pressed then
			apply_digital_edge(player, state, pressed, frame)
		end
	end
end

-- Analog/pointer inputs: read their value(s) every frame. Hybrid buttons
-- (trigger/stick) already had pressed/edges set by the digital pass and only
-- need the value here; pure value inputs derive pressed from the value/delta.
local sample_value_binding<const> = function(player, state, frame)
	if state.value_addr ~= 0 then
		local value<const>: *word = state.value_addr
		state.value_q16 = *value
	end
	if state.value_x_addr ~= 0 then
		local value_x<const>: *word = state.value_x_addr
		local value_y<const>: *word = state.value_y_addr
		state.value_x_q16 = *value_x
		state.value_y_q16 = *value_y
	end
	if state.is_pointer_delta then
		local x<const> = *pointer_position_x_q16
		local y<const> = *pointer_position_y_q16
		state.value_x_q16 = x - state.prev_x_q16
		state.value_y_q16 = y - state.prev_y_q16
		state.prev_x_q16 = x
		state.prev_y_q16 = y
	end
	if state.level_mask ~= 0 then
		return
	end
	local pressed = false
	if state.pressed_from_value then
		pressed = state.value_q16 ~= 0
	elseif state.is_pointer_delta then
		pressed = state.value_x_q16 ~= 0 or state.value_y_q16 ~= 0
	end
	if pressed ~= state.pressed then
		apply_digital_edge(player, state, pressed, frame)
	end
end

local sample_new_binding_state<const> = function(player, state, frame)
	if state.level_addr ~= 0 then
		local level<const>: *word = state.level_addr
		local pressed<const> = (*level & state.level_mask) ~= 0
		if pressed ~= state.pressed then
			apply_digital_edge(player, state, pressed, frame)
		end
	end
	if state.axis_addr ~= 0 then
		local axis<const>: *word = state.axis_addr
		local raw_value<const> = *axis
		local magnitude_q16 = 0
		if state.axis_positive then
			if raw_value & word_sign_mask == 0 then
				magnitude_q16 = raw_value
			end
		elseif raw_value & word_sign_mask ~= 0 then
			magnitude_q16 = word_range - raw_value
		end
		state.value_q16 = magnitude_q16
		local pressed<const> = magnitude_q16 >= state.axis_actuation_q16
		if pressed ~= state.pressed then
			apply_digital_edge(player, state, pressed, frame)
		end
	end
	sample_value_binding(player, state, frame)
end

-- Address lookup remains source-local while new word groups and value-bearing
-- states join dense sampling lists. `dirty` makes the next sample initialise a
-- button added to an existing group.
local register_binding_sampling<const> = function(player, source_index, state)
	if state.level_addr ~= 0 then
		local by_addr<const> = player.word_by_addr[source_index]
		local group = by_addr[state.level_addr]
		if not group then
			group = { addr = state.level_addr, prev = 0, dirty = true, states = {} }
			by_addr[state.level_addr] = group
			local list<const> = player.word_groups
			list[#list + 1] = group
		end
		group.dirty = true
		local states<const> = group.states
		states[#states + 1] = state
	end
	if state.axis_addr ~= 0 then
		local by_addr<const> = player.axis_by_addr
		local group = by_addr[state.axis_addr]
		if not group then
			group = {
				addr = state.axis_addr,
				positive_states = {},
				negative_states = {},
			}
			by_addr[state.axis_addr] = group
			local groups<const> = player.axis_groups
			groups[#groups + 1] = group
		end
		local states<const> = state.axis_positive and group.positive_states or group.negative_states
		states[#states + 1] = state
	end
	if state.value_addr ~= 0 or state.value_x_addr ~= 0 or state.is_pointer_delta then
		local vlist<const> = player.value_states
		vlist[#vlist + 1] = state
	end
	local frame<const> = *frame_serial
	if player.sample_frame == frame then
		sample_new_binding_state(player, state, frame)
		local edge_id<const> = player.next_edge_id - 1
		local frame_clock_state<const> = player.clock_states[clock.frame]
		frame_clock_state.edge_id = edge_id
		local gameplay_clock_state<const> = player.clock_states[clock.gameplay]
		if gameplay_clock_state.sample_frame == frame then
			gameplay_clock_state.edge_id = edge_id
		end
	end
end

local track_keyboard_usage<const> = function(player, usage)
	local source_bindings<const> = player.binding_states[source_keyboard]
	local state = source_bindings[usage]
	if state then
		return state
	end
	state = new_binding_state()
	state.level_addr = icu.keyboard_bitmap_address + ((usage >> 5) << 2)
	state.level_mask = 1 << (usage & 31)
	source_bindings[usage] = state
	register_binding_sampling(player, source_keyboard, state)
	return state
end

local track_binding<const> = function(player, source_index, binding)
	if source_index == source_keyboard then
		return track_keyboard_usage(player, keys[binding])
	end
	local source_bindings<const> = player.binding_states[source_index]
	local state = source_bindings[binding]
	if state then
		return state
	end
	state = new_binding_state()
	resolve_non_keyboard_binding(player, source_index, binding, state)
	source_bindings[binding] = state
	register_binding_sampling(player, source_index, state)
	return state
end

local source_mapping<const> = function(ctx, source_index)
	if source_index == source_keyboard then return ctx.keyboard end
	if source_index == source_gamepad then return ctx.gamepad end
	return ctx.pointer
end

local seen_binding<const> = function(player, binding)
	if player.binding_seen[binding] == player.binding_generation then
		return true
	end
	player.binding_seen[binding] = player.binding_generation
	return false
end

-- Resolve the deduped button-state list an action aggregates from, for one
-- source. The highest-priority, latest context defining the action wins; its
-- bindings aggregate together. Context changes rebuild the retained list.
local build_resolved_source<const> = function(player, action, source_index, list)
	for i = #list, 1, -1 do
		list[i] = nil
	end
	player.binding_generation = player.binding_generation + 1
	local contexts<const> = player.contexts
	for i = #contexts, 1, -1 do
		local ctx<const> = contexts[i]
		if ctx.enabled then
			local bindings<const> = source_mapping(ctx, source_index)[action]
			if bindings then
				for j = 1, #bindings do
					local binding<const> = bindings[j]
					if not seen_binding(player, binding) then
						list[#list + 1] = track_binding(player, source_index, binding)
					end
				end
				return
			end
		end
	end
end

local rebuild_action_bindings<const> = function(player, state)
	local source_lists<const> = state.source_lists
	for index = source_keyboard, source_pointer do
		local list<const> = source_lists[index]
		build_resolved_source(player, state.action, list.source_index, list)
	end
	-- Publish non-empty source-list references densely so action evaluation and
	-- consumption never visit absent device sources.
	local sources<const> = state.resolved_sources
	local active_count = 0
	for index = source_keyboard, source_pointer do
		local list<const> = source_lists[index]
		if #list > 0 then
			active_count = active_count + 1
			sources[active_count] = list
		end
	end
	state.resolved_source_count = active_count
end

local create_action_state<const> = function(player, clock_state, action)
	local state<const> = new_action_state(action, clock_state)
	clock_state.actions[action] = state
	local index<const> = clock_state.action_state_count + 1
	clock_state.action_state_count = index
	clock_state.action_state_list[index] = state
	return state
end

local reset_action_evaluation<const> = function(state, frame)
	state.guard_last_press_id = -1
	state.guard_last_accepted_frame = frame - guard_window_frames - 1
	state.guard_last_result = false
	state.repeat_active = false
	state.repeat_count = 0
	state.repeat_press_start_frame = -1
	state.repeat_last_frame = -1
	state.repeat_last_result = false
	state.repeat_last_repeat_frame = -1
end

local clear_action_evaluation_state<const> = function(player)
	local frame<const> = *frame_serial
	local clock_state_list<const> = player.clock_state_list
	for clock_index = 1, #clock_state_list do
		local clock_state<const> = clock_state_list[clock_index]
		clock_state.evaluation_serial = clock_state.evaluation_serial + 1
		local action_states<const> = clock_state.action_state_list
		for i = 1, clock_state.action_state_count do
			local state<const> = action_states[i]
			reset_action_evaluation(state, frame)
			rebuild_action_bindings(player, state)
		end
	end
end

local push_context_record<const> = function(player, record)
	for i = #player.contexts, 1, -1 do
		if player.contexts[i].id == record.id then
			table.remove(player.contexts, i)
		end
	end
	player.context_order = player.context_order + 1
	record.order = player.context_order
	player.contexts[#player.contexts + 1] = record
	table.sort(player.contexts, context_less)
	clear_action_evaluation_state(player)
end

local new_player<const> = function(index)
	local gameplay_clock_state<const> = {
		actions = {},
		action_state_list = {},
		action_state_count = 0,
		expression_bindings = {},
		edge_id = 0,
		previous_edge_id = 0,
		sample_frame = -1,
		evaluation_serial = 0,
	}
	local frame_clock_state<const> = {
		actions = {},
		action_state_list = {},
		action_state_count = 0,
		expression_bindings = {},
		edge_id = 0,
		previous_edge_id = 0,
		sample_frame = -1,
		evaluation_serial = 0,
	}
	local player<const> = {
		index = index,
		binding_states = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		-- Digital buttons grouped by the level word they share, so sampling diffs
		-- one MMIO word per group instead of iterating every button each frame.
		word_groups = {},
		word_by_addr = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		-- Directional axis bindings share one raw word read per admitted axis.
		axis_groups = {},
		axis_by_addr = {},
		-- Analog/pointer inputs (a handful) that need a value read every frame.
		value_states = {},
		contexts = {},
		context_order = 0,
		binding_seen = {},
		binding_generation = 0,
		next_edge_id = 1,
		sample_frame = -1,
		clock_states = {
			[clock.gameplay] = gameplay_clock_state,
			[clock.frame] = frame_clock_state,
		},
		clock_state_list = { gameplay_clock_state, frame_clock_state },
	}
	push_context_record(player, {
		id = '__default',
		priority = 0,
		enabled = true,
		keyboard = default_keyboard,
		gamepad = default_gamepad,
		pointer = default_pointer,
	})
	return player
end

local sample_player<const> = function(player, frame)
	local clock_state<const> = player.clock_states[clock.frame]
	clock_state.previous_edge_id = clock_state.edge_id
	-- Digital pass: diff one MMIO word per group; touch only changed buttons.
	local word_groups<const> = player.word_groups
	for w = 1, #word_groups do
		local group<const> = word_groups[w]
		local level<const>: *word = group.addr
		local cur<const> = *level
		if cur ~= group.prev or group.dirty then
			local states<const> = group.states
			for s = 1, #states do
				local state<const> = states[s]
				local pressed_now<const> = (cur & state.level_mask) ~= 0
				if pressed_now ~= state.pressed then
					apply_digital_edge(player, state, pressed_now, frame)
				end
			end
			group.prev = cur
			group.dirty = false
		end
	end
	local axis_groups<const> = player.axis_groups
	for a = 1, #axis_groups do
		sample_axis_group(player, axis_groups[a], frame)
	end
	-- Value pass: the few analog/pointer inputs.
	local value_states<const> = player.value_states
	for v = 1, #value_states do
		sample_value_binding(player, value_states[v], frame)
	end
	player.sample_frame = frame
	clock_state.edge_id = player.next_edge_id - 1
	clock_state.sample_frame = frame
	clock_state.evaluation_serial = clock_state.evaluation_serial + 1
end

local evaluate_guard<const> = function(state, frame)
	if not state.just_pressed then
		state.guarded_just_pressed = false
		return
	end
	if state.guard_last_press_id == state.press_id then
		state.guarded_just_pressed = state.guard_last_result
		return
	end
	local accepted<const> = (frame - state.guard_last_accepted_frame) > guard_window_frames
	if accepted then
		state.guard_last_accepted_frame = frame
	end
	state.guard_last_press_id = state.press_id
	state.guard_last_result = accepted
	state.guarded_just_pressed = accepted
end

local evaluate_repeat<const> = function(state, frame)
	if state.repeat_last_frame == frame then
		state.repeat_pressed = state.repeat_last_result
		return
	end
	local result = false
	if state.just_pressed then
		state.repeat_active = true
		state.repeat_count = 0
		state.repeat_press_start_frame = frame
		state.repeat_last_repeat_frame = frame
	elseif not state.pressed then
		state.repeat_active = false
		state.repeat_count = 0
		state.repeat_press_start_frame = -1
		state.repeat_last_repeat_frame = -1
	else
		if not state.repeat_active then
			state.repeat_active = true
			state.repeat_count = 0
			state.repeat_press_start_frame = frame
			state.repeat_last_repeat_frame = frame
		end
		local next_frame<const> = state.repeat_count == 0 and (state.repeat_press_start_frame + initial_repeat_delay_frames) or (state.repeat_last_repeat_frame + repeat_interval_frames)
		if frame >= next_frame then
			state.repeat_count = state.repeat_count + 1
			state.repeat_last_repeat_frame = next_frame
			result = true
		end
	end
	state.repeat_last_frame = frame
	state.repeat_last_result = result
	state.repeat_pressed = result
end

local action_state_environment<const> = {
	evaluate_guard = evaluate_guard,
	evaluate_repeat = evaluate_repeat,
}

local admit_action_state<const> = function(player, clock_state, action, requirement_mask)
	local state = clock_state.actions[action]
	if state == nil then
		state = create_action_state(player, clock_state, action)
		rebuild_action_bindings(player, state)
	end
	local combined_requirement_mask<const> = state.evaluation_requirement_mask | requirement_mask
	if combined_requirement_mask ~= state.evaluation_requirement_mask then
		state.evaluation_requirement_mask = combined_requirement_mask
		state.evaluation_runner = action_state_program.compile(
			combined_requirement_mask,
			action_state_environment
		)
		state.evaluation_serial = -1
	end
	return state
end

-- Builds four gamepad bindings from one retained stick. The cart chooses the
-- actuation threshold and composes these bindings with its authored actions;
-- raw ICU axes therefore remain distinct from the D-pad hardware buttons.
function input.stick_directions(stick, actuation_q16)
	local axes<const> = gamepad_stick_axes[stick]
	return {
		left = {
			axis_offset = axes.x,
			positive = false,
			actuation_q16 = actuation_q16,
		},
		right = {
			axis_offset = axes.x,
			positive = true,
			actuation_q16 = actuation_q16,
		},
		up = {
			axis_offset = axes.y,
			positive = false,
			actuation_q16 = actuation_q16,
		},
		down = {
			axis_offset = axes.y,
			positive = true,
			actuation_q16 = actuation_q16,
		},
	}
end

function input.add_player(index)
	local player<const> = new_player(index)
	players[index] = player
	local dense_index<const> = player_count + 1
	player_count = dense_index
	player_list[dense_index] = player
end

function input.advance_frame()
	local frame<const> = *frame_serial + 1
	*frame_serial = frame
	for index = 1, player_count do
		sample_player(player_list[index], frame)
	end
end

function input.advance_gameplay()
	local frame<const> = *frame_serial
	for index = 1, player_count do
		local player<const> = player_list[index]
		local clock_state<const> = player.clock_states[clock.gameplay]
		clock_state.previous_edge_id = clock_state.edge_id
		clock_state.edge_id = player.next_edge_id - 1
		clock_state.sample_frame = frame
		clock_state.evaluation_serial = clock_state.evaluation_serial + 1
	end
end

-- A suspended consumer clock does not receive transitions recorded by the raw
-- frame sampler while it is absent. Resuming advances that clock's edge cursor
-- to the current producer sequence while retaining the sampled button levels.
-- A held direction therefore remains held, but a key used by a modal action is
-- not replayed as a fresh gameplay press or repeat.
function input.synchronize_gameplay_clock()
	local frame<const> = *frame_serial
	for player_index = 1, player_count do
		local player<const> = player_list[player_index]
		local edge_id<const> = player.next_edge_id - 1
		local clock_state<const> = player.clock_states[clock.gameplay]
		clock_state.previous_edge_id = edge_id
		clock_state.edge_id = edge_id
		clock_state.sample_frame = frame
		clock_state.evaluation_serial = clock_state.evaluation_serial + 1
		local action_states<const> = clock_state.action_state_list
		for state_index = 1, clock_state.action_state_count do
			reset_action_evaluation(action_states[state_index], frame)
		end
	end
end

function input.push_context(player_index, id, keyboard, gamepad, pointer, priority, enabled)
	push_context_record(players[player_index], {
		id = id,
		priority = priority or 100,
		enabled = enabled or enabled == nil,
		keyboard = keyboard or {},
		gamepad = gamepad or {},
		pointer = pointer or {},
	})
end

function input.clear_context(player_index, id)
	local player<const> = players[player_index]
	for i = #player.contexts, 1, -1 do
		if player.contexts[i].id == id then
			table.remove(player.contexts, i)
		end
	end
	clear_action_evaluation_state(player)
end

-- Direct action queries admit their retained state on first use. Compiled
-- expressions already admit every state while input.bind builds their context.
local evaluate_player_action_state<const> = function(player, clock_source, action, requirement_mask)
	local clock_state<const> = player.clock_states[clock_source]
	local state = clock_state.actions[action]
	if state == nil or state.evaluation_requirement_mask & requirement_mask ~= requirement_mask then
		state = admit_action_state(player, clock_state, action, requirement_mask)
	end
	local evaluation_serial<const> = clock_state.evaluation_serial
	if state.evaluation_serial ~= evaluation_serial then
		state.evaluation_runner(
			state,
			clock_state.sample_frame,
			clock_state.previous_edge_id,
			evaluation_serial
		)
	end
	return state
end

function input.bind(player_index, clock_source, pattern)
	local player<const> = players[player_index]
	local clock_state<const> = player.clock_states[clock_source]
	local evaluate = clock_state.expression_bindings[pattern]
	if not evaluate then
		local program<const> = action_parser.compile(pattern)
		local action_names<const> = program.action_names
		local action_requirement_masks<const> = program.action_requirement_masks
		local states<const> = {}
		for i = 1, #action_names do
			states[i] = admit_action_state(
				player,
				clock_state,
				action_names[i],
				action_requirement_masks[i]
			)
		end
		evaluate = program.evaluation_factory(
			clock_state,
			states,
			buffer_frame_retention
		)
		clock_state.expression_bindings[pattern] = evaluate
	end
	return evaluate
end

-- Command strings are admitted as physical alphanumeric HID usages rather than
-- manufacturing one semantic action per character. The retained matcher visits
-- the two keyboard bitmap words only through the ordinary grouped sampler and
-- scans its dense key-state view solely when the selected clock observed an
-- input edge. A compiled prefix table preserves overlapping command prefixes.
function input.bind_keyboard_sequence(player_index, clock_source, definition)
	local player<const> = players[player_index]
	local clock_state<const> = player.clock_states[clock_source]
	local sequence<const> = {}
	local text<const> = definition.keyboard
	local usage_by_byte<const> = key.alphanumeric_usage_by_byte
	for index = 1, #text do
		sequence[index] = usage_by_byte[string.byte(text, index)]
	end
	if definition.submit then
		sequence[#sequence + 1] = key.enter_usage
	end
	local sequence_count<const> = #sequence
	local prefix<const> = { 0 }
	local prefix_length = 0
	for index = 2, sequence_count do
		local usage<const> = sequence[index]
		while prefix_length > 0 and sequence[prefix_length + 1] ~= usage do
			prefix_length = prefix[prefix_length]
		end
		if sequence[prefix_length + 1] == usage then
			prefix_length = prefix_length + 1
		end
		prefix[index] = prefix_length
	end
	local first_usage<const> = key.alphanumeric_first_usage
	local states = player.alphanumeric_key_states
	if states == nil then
		states = {}
		for usage = first_usage, key.enter_usage do
			states[usage - first_usage + 1] = track_keyboard_usage(player, usage)
		end
		player.alphanumeric_key_states = states
	end
	local state_count<const> = definition.submit
		and #states
		or key.alphanumeric_last_usage - first_usage + 1
	local matched_prefix = 0
	local reset_sequence<const> = function()
		matched_prefix = 0
	end
	local evaluate_sequence<const> = function()
		local previous_edge_id<const> = clock_state.previous_edge_id
		local edge_id<const> = clock_state.edge_id
		if previous_edge_id == edge_id then
			return false
		end
		local cursor = previous_edge_id
		local completed = false
		while cursor < edge_id do
			local next_edge_id = edge_id + 1
			local next_usage = 0
			for state_index = 1, state_count do
				local state<const> = states[state_index]
				local press_edge_id<const> = state.press_edge_id
				if press_edge_id > cursor
				and press_edge_id < next_edge_id
				and state.consumed_press_id ~= press_edge_id then
					next_edge_id = press_edge_id
					next_usage = state_index + first_usage - 1
				end
			end
			if next_usage == 0 then
				return completed
			end
			cursor = next_edge_id
			while matched_prefix > 0 and sequence[matched_prefix + 1] ~= next_usage do
				matched_prefix = prefix[matched_prefix]
			end
			if sequence[matched_prefix + 1] == next_usage then
				matched_prefix = matched_prefix + 1
			end
			if matched_prefix == sequence_count then
				completed = true
				matched_prefix = prefix[matched_prefix]
			end
		end
		return completed
	end
	return evaluate_sequence, reset_sequence
end

-- Ordered action combos retain only the current step. Each step and optional
-- cancellation action is an ordinary compiled PlayerInput expression, so the
-- combo stays above physical mappings and shares their sampled button states.
-- Completion lasts one evaluation and resets the combo, matching an explicit
-- input trigger rather than publishing a second input event stream.
function input.bind_combo(player_index, clock_source, definition)
	local source_steps<const> = definition.steps
	local steps<const> = {}
	for index = 1, #source_steps do
		steps[index] = input.bind(player_index, clock_source, source_steps[index])
	end
	local step_count<const> = #steps
	local step_index = 1
	local cancel<const> = definition.cancel and input.bind(player_index, clock_source, definition.cancel)
	local reset_combo<const> = function()
		step_index = 1
	end
	if cancel == nil then
		local evaluate_without_cancel<const> = function()
			if not steps[step_index]() then
				return false
			end
			if step_index == step_count then
				step_index = 1
				return true
			end
			step_index = step_index + 1
			return false
		end
		return evaluate_without_cancel, reset_combo
	end
	local evaluate_with_cancel<const> = function()
		if steps[step_index]() then
			if step_index == step_count then
				step_index = 1
				return true
			end
			step_index = step_index + 1
			return false
		end
		if cancel() then
			step_index = 1
		end
		return false
	end
	return evaluate_with_cancel, reset_combo
end

function input.is_action_pressed(player_index, clock_source, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_player_action_state(player, clock_source, action, requirement_pressed)
	return state.pressed and not state.consumed
end

function input.is_action_just_pressed(player_index, clock_source, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_player_action_state(player, clock_source, action, requirement_just_pressed)
	return state.just_pressed and not state.consumed
end

function input.is_action_just_released(player_index, clock_source, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_player_action_state(player, clock_source, action, requirement_just_released)
	return state.just_released and not state.consumed
end

function input.get_action_value(player_index, clock_source, action)
	local player<const> = players[player_index]
	return evaluate_player_action_state(player, clock_source, action, requirement_value_q16).value_q16
end

function input.get_vector(player_index, clock_source, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_player_action_state(player, clock_source, action, requirement_vector_q16)
	return state.value_x_q16, state.value_y_q16
end

local consume_action<const> = function(state)
	local previous_edge_id<const> = state.clock_state.previous_edge_id
	local sources<const> = state.resolved_sources
	for index = 1, state.resolved_source_count do
		local states<const> = sources[index]
		for i = 1, #states do
			local button<const> = states[i]
			if button.pressed or button.press_edge_id > previous_edge_id then
				button.consumed_press_id = button.press_edge_id
			end
		end
	end
end

function input.consume(player_index, clock_source, actions)
	local player<const> = players[player_index]
	local clock_state_list<const> = player.clock_state_list
	for index = 1, #clock_state_list do
		local clock_state<const> = clock_state_list[index]
		clock_state.evaluation_serial = clock_state.evaluation_serial + 1
	end
	local clock_state<const> = player.clock_states[clock_source]
	if type(actions) == 'table' then
		for i = 1, #actions do
			consume_action(admit_action_state(player, clock_state, actions[i], 0))
		end
		return
	end
	consume_action(admit_action_state(player, clock_state, actions, 0))
end

return input
