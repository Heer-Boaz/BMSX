-- cartlib/input/input.lua
-- Cart-owned player input: action mappings and action-expression state built from
-- raw ICU snapshot reads (keyboard bitmap, pad button/axis words, pointer words).
-- Edge detection (just_pressed/just_released) is derived here from latched levels.

local action_parser<const> = require('cartlib/input/action_parser')
local action_syntax<const> = require('cartlib/input/action_syntax')
local keys<const> = require('cartlib/input/keys')

local input<const> = {}

local source_keyboard<const> = 1
local source_gamepad<const> = 2
local source_pointer<const> = 3
local pointer_buttons<const>: *word = 0x0800008c
local pointer_position_x_q16<const>: *word = 0x08000090
local pointer_position_y_q16<const>: *word = 0x08000094
local pointer_wheel_q16<const>: *word = 0x08000098
local gamepad_bits<const> = {
	['a'] = 0x00000000, ['b'] = 0x00000001, ['x'] = 0x00000002, ['y'] = 0x00000003,
	['lb'] = 0x00000004, ['rb'] = 0x00000005, ['lt'] = 0x00000006, ['rt'] = 0x00000007,
	['select'] = 0x00000008, ['start'] = 0x00000009, ['ls'] = 0x0000000a, ['rs'] = 0x0000000b,
	['up'] = 0x0000000c, ['down'] = 0x0000000d, ['left'] = 0x0000000e, ['right'] = 0x0000000f,
	['home'] = 0x00000010, ['touch'] = 0x00000011,
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
local huge_delta<const> = 0x7fffffff
local evaluation_requirement<const> = action_syntax.evaluation_requirement
local requirement_guard<const> = evaluation_requirement.guard
local requirement_repeat_state<const> = evaluation_requirement.repeat_state

local default_keyboard<const> = {
	a = { 'KeyX' },
	b = { 'KeyC' },
	x = { 'KeyZ' },
	y = { 'KeyS' },
	lb = { 'ShiftLeft' },
	rb = { 'ShiftRight' },
	lt = { 'ControlLeft' },
	rt = { 'ControlRight' },
	select = { 'Backspace' },
	start = { 'Enter' },
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

local new_button_state<const> = function()
	return {
		-- raw read plan, resolved per binding by resolve_binding
		level_addr = 0,
		level_mask = 0,
		value_addr = 0,
		value_x_addr = 0,
		value_y_addr = 0,
		pressed_from_value = false,
		is_pointer_delta = false,
		prev_x_q16 = 0,
		prev_y_q16 = 0,
		pressed = false,
		just_pressed = false,
		just_released = false,
		consumed = false,
		press_id = 0,
		press_start_frame = 0,
		last_press_frame = -buffer_frame_retention,
		last_release_frame = -buffer_frame_retention,
		value_q16 = 0,
		value_x_q16 = 0,
		value_y_q16 = 0,
	}
end

local resolve_binding<const> = function(player, source_index, button, state)
	if source_index == source_keyboard then
		local usage<const> = keys[button]
		if usage then
			state.level_addr = 0x0800006c + ((usage >> 5) << 2)
			state.level_mask = 1 << (usage & 31)
		end
		return
	end
	if source_index == source_gamepad then
		local bit<const> = gamepad_bits[button]
		if bit then
			local pad_base<const> = 0x0800009c + (player.index - 1) * 0x0000001c
			state.level_addr = pad_base + 0x00000000
			state.level_mask = 1 << bit
			if button == 'ls' then
				state.value_x_addr = pad_base + 0x00000004
				state.value_y_addr = pad_base + 0x00000008
			elseif button == 'rs' then
				state.value_x_addr = pad_base + 0x0000000c
				state.value_y_addr = pad_base + 0x00000010
			elseif button == 'lt' then
				state.value_addr = pad_base + 0x00000014
			elseif button == 'rt' then
				state.value_addr = pad_base + 0x00000018
			end
		end
		return
	end
	local bit<const> = pointer_bits[button]
	if bit then
		state.level_addr = pointer_buttons
		state.level_mask = 1 << bit
	elseif button == 'pointer_position' then
		state.value_x_addr = pointer_position_x_q16
		state.value_y_addr = pointer_position_y_q16
	elseif button == 'pointer_delta' then
		state.is_pointer_delta = true
	elseif button == 'pointer_wheel' then
		state.value_addr = pointer_wheel_q16
		state.pressed_from_value = true
	end
end

local new_action_state<const> = function(player, action)
	return {
		player = player,
		action = action,
		resolved = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
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
		min_press_delta = huge_delta,
		min_release_delta = huge_delta,
		evaluation_requirement_mask = 0,
		eval_frame = -1,
		eval_gen = -1,
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

local binding_id<const> = function(binding)
	if type(binding) == 'table' then
		return binding.id
	end
	return binding
end

local context_less<const> = function(a, b)
	if a.priority ~= b.priority then
		return a.priority < b.priority
	end
	return a.order < b.order
end

-- Record a digital edge on `state` and remember it so the flag is cleared next
-- frame. Called only when a tracked bit actually flipped.
local apply_digital_edge<const> = function(player, state, pressed_now, frame)
	if pressed_now then
		state.just_pressed = true
		state.just_released = false
		state.press_id = player.next_press_id
		player.next_press_id = player.next_press_id + 1
		state.press_start_frame = frame
		state.last_press_frame = frame
	else
		state.just_pressed = false
		state.just_released = true
		state.last_release_frame = frame
	end
	state.consumed = false
	state.pressed = pressed_now
	local n<const> = player.edge_count + 1
	player.edge_count = n
	player.edge_buttons[n] = state
end

-- Analog/pointer inputs: read their value(s) every frame. Hybrid buttons
-- (trigger/stick) already had pressed/edges set by the digital pass and only
-- need the value here; pure value inputs derive pressed from the value/delta.
local sample_value_button<const> = function(player, state, frame)
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
	local just_pressed<const> = pressed and not state.pressed
	local just_released<const> = (not pressed) and state.pressed
	state.just_pressed = just_pressed
	state.just_released = just_released
	if just_pressed then
		state.press_id = player.next_press_id
		player.next_press_id = player.next_press_id + 1
		state.press_start_frame = frame
		state.last_press_frame = frame
		state.consumed = false
	elseif not pressed then
		state.consumed = false
	end
	if just_released then
		state.last_release_frame = frame
	end
	state.pressed = pressed
end

local sample_new_button_state<const> = function(player, state, frame)
	if state.level_addr ~= 0 then
		local level<const>: *word = state.level_addr
		local pressed<const> = (*level & state.level_mask) ~= 0
		if pressed ~= state.pressed then
			apply_digital_edge(player, state, pressed, frame)
		end
	end
	sample_value_button(player, state, frame)
end

-- Slot a freshly-resolved button into the per-source sampling structures: a
-- digital bit joins (or creates) the group for its level word; any value-bearing
-- aspect (trigger/stick/pointer) joins the value list. `dirty` forces the group's
-- next sample to (re)initialise this button, matching the old first-sample edge.
local register_button_sampling<const> = function(player, source_index, state)
	if state.level_addr ~= 0 then
		local by_addr<const> = player.word_by_addr[source_index]
		local group = by_addr[state.level_addr]
		if not group then
			group = { addr = state.level_addr, prev = 0, dirty = true, states = {} }
			by_addr[state.level_addr] = group
			local list<const> = player.word_list[source_index]
			list[#list + 1] = group
		end
		group.dirty = true
		local states<const> = group.states
		states[#states + 1] = state
	end
	if state.value_addr ~= 0 or state.value_x_addr ~= 0 or state.is_pointer_delta then
		local vlist<const> = player.value_list[source_index]
		vlist[#vlist + 1] = state
	end
	local frame<const> = *frame_serial
	if player.sample_frame == frame then
		sample_new_button_state(player, state, frame)
	end
end

local track_button<const> = function(player, source_index, button)
	local source_buttons<const> = player.buttons[source_index]
	local state = source_buttons[button]
	if state then
		return state
	end
	state = new_button_state()
	resolve_binding(player, source_index, button, state)
	source_buttons[button] = state
	register_button_sampling(player, source_index, state)
	return state
end

local source_mapping<const> = function(ctx, source_index)
	if source_index == source_keyboard then return ctx.keyboard end
	if source_index == source_gamepad then return ctx.gamepad end
	return ctx.pointer
end

local seen_binding<const> = function(player, button)
	if player.binding_seen[button] == player.binding_generation then
		return true
	end
	player.binding_seen[button] = player.binding_generation
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
					local button<const> = binding_id(bindings[j])
					if not seen_binding(player, button) then
						list[#list + 1] = track_button(player, source_index, button)
					end
				end
				return
			end
		end
	end
end

local rebuild_action_bindings<const> = function(player, state)
	local resolved<const> = state.resolved
	for source_index = source_keyboard, source_pointer do
		build_resolved_source(player, state.action, source_index, resolved[source_index])
	end
end

local create_action_state<const> = function(player, action)
	local state<const> = new_action_state(player, action)
	player.actions[action] = state
	local index<const> = player.action_state_count + 1
	player.action_state_count = index
	player.action_state_list[index] = state
	return state
end

local declare_mapping_actions<const> = function(player, mapping)
	for action in pairs(mapping) do
		if not player.actions[action] then
			create_action_state(player, action)
		end
	end
end

local clear_action_evaluation_state<const> = function(player)
	player.eval_generation = player.eval_generation + 1
	local frame<const> = *frame_serial
	local action_states<const> = player.action_state_list
	for i = 1, player.action_state_count do
		local state<const> = action_states[i]
		state.guard_last_press_id = -1
		state.guard_last_accepted_frame = frame - guard_window_frames - 1
		state.guard_last_result = false
		state.repeat_active = false
		state.repeat_count = 0
		state.repeat_press_start_frame = -1
		state.repeat_last_frame = -1
		state.repeat_last_result = false
		state.repeat_last_repeat_frame = -1
		rebuild_action_bindings(player, state)
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
	declare_mapping_actions(player, record.keyboard)
	declare_mapping_actions(player, record.gamepad)
	declare_mapping_actions(player, record.pointer)
	clear_action_evaluation_state(player)
end

local new_player<const> = function(index)
	local player<const> = {
		index = index,
		buttons = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		-- Digital buttons grouped by the level word they share, so sampling diffs
		-- one MMIO word per group instead of iterating every button each frame.
		word_list = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		word_by_addr = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		-- Analog/pointer inputs (a handful) that need a value read every frame.
		value_list = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		-- Buttons whose just_pressed/just_released was set this frame; cleared next
		-- frame so unchanged buttons cost nothing.
		edge_buttons = {},
		edge_count = 0,
		contexts = {},
		context_order = 0,
		actions = {},
		action_state_list = {},
		action_state_count = 0,
		binding_seen = {},
		binding_generation = 0,
		next_press_id = 1,
		sample_frame = -1,
		eval_generation = 0,
		expression_bindings = {},
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
	-- 1. Clear last frame's digital edges (only the buttons that changed).
	local edges<const> = player.edge_buttons
	local edge_count<const> = player.edge_count
	for i = 1, edge_count do
		local state<const> = edges[i]
		state.just_pressed = false
		state.just_released = false
	end
	player.edge_count = 0
	-- 2. Digital pass: diff one MMIO word per group; touch only changed buttons.
	for source_index = source_keyboard, source_pointer do
		local word_list<const> = player.word_list[source_index]
		for w = 1, #word_list do
			local group<const> = word_list[w]
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
	end
	-- 3. Value pass: the few analog/pointer inputs.
	for source_index = source_keyboard, source_pointer do
		local vlist<const> = player.value_list[source_index]
		for v = 1, #vlist do
			sample_value_button(player, vlist[v], frame)
		end
	end
	player.sample_frame = frame
end

local compile_action_state<const> = function(player, action)
	local state = player.actions[action]
	if state then
		return state
	end
	state = create_action_state(player, action)
	rebuild_action_bindings(player, state)
	return state
end

local evaluate_guard<const> = function(state, frame)
	if not state.just_pressed then
		return false
	end
	if state.guard_last_press_id == state.press_id then
		return state.guard_last_result
	end
	local accepted<const> = (frame - state.guard_last_accepted_frame) > guard_window_frames
	if accepted then
		state.guard_last_accepted_frame = frame
	end
	state.guard_last_press_id = state.press_id
	state.guard_last_result = accepted
	return accepted
end

local evaluate_repeat<const> = function(state, frame)
	if state.repeat_last_frame == frame then
		return state.repeat_last_result, state.repeat_count
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
	return result, state.repeat_count
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

-- Full evaluation runs once per action per frame (per eval generation); later
-- reads this frame reuse the retained result and numeric edge deltas.
local refresh_action_state<const> = function(player, state)
	local frame<const> = player.sample_frame
	local pressed = false
	local just_pressed = false
	local just_released = false
	local all_just_pressed = false
	local all_just_released = false
	local consumed = false
	local has_press_time = false
	local press_time = 0
	local press_id = 0
	local value_q16 = 0
	local value_x_q16 = 0
	local value_y_q16 = 0
	local min_press_delta = huge_delta
	local min_release_delta = huge_delta
	local resolved<const> = state.resolved
	for source_index = source_keyboard, source_pointer do
		local list<const> = resolved[source_index]
		local count<const> = #list
		if count > 0 then
			local source_all_just_pressed = true
			local source_all_just_released = true
			local source_value_q16 = 0
			local source_value_x_q16 = 0
			local source_value_y_q16 = 0
			for i = 1, count do
				local button<const> = list[i]
				local button_pressed<const> = button.pressed
				local button_just_pressed<const> = button.just_pressed
				local button_just_released<const> = button.just_released
				pressed = pressed or button_pressed
				just_pressed = just_pressed or button_just_pressed
				just_released = just_released or button_just_released
				source_all_just_pressed = source_all_just_pressed and button_just_pressed
				source_all_just_released = source_all_just_released and button_just_released
				consumed = consumed or button.consumed
				local press_delta = frame - button.last_press_frame
				if button_pressed then
					press_delta = -1
				end
				if press_delta < min_press_delta then
					min_press_delta = press_delta
				end
				local release_delta = frame - button.last_release_frame
				if button_just_released then
					release_delta = -1
				end
				if release_delta < min_release_delta then
					min_release_delta = release_delta
				end
				if button_pressed then
					local button_press_time<const> = frame - button.press_start_frame
					if not has_press_time or button_press_time < press_time then
						has_press_time = true
						press_time = button_press_time
					end
					if button.press_id > press_id then
						press_id = button.press_id
					end
				end
				local button_value_q16<const> = button.value_q16
				if button_value_q16 ~= 0 then
					source_value_q16 = button_value_q16
				end
				local button_value_x_q16<const> = button.value_x_q16
				local button_value_y_q16<const> = button.value_y_q16
				if button_value_x_q16 ~= 0 or button_value_y_q16 ~= 0 then
					source_value_x_q16 = button_value_x_q16
					source_value_y_q16 = button_value_y_q16
				end
			end
			all_just_pressed = all_just_pressed or source_all_just_pressed
			all_just_released = all_just_released or source_all_just_released
			if value_q16 == 0 then
				value_q16 = source_value_q16
			end
			if value_x_q16 == 0 and value_y_q16 == 0 then
				value_x_q16 = source_value_x_q16
				value_y_q16 = source_value_y_q16
			end
		end
	end
	state.pressed = pressed
	state.just_pressed = just_pressed
	state.just_released = just_released
	state.all_just_pressed = all_just_pressed
	state.all_just_released = all_just_released
	state.consumed = consumed
	state.press_time = press_time
	state.press_id = press_id
	state.value_q16 = value_q16
	state.value_x_q16 = value_x_q16
	state.value_y_q16 = value_y_q16
	state.min_press_delta = min_press_delta
	state.min_release_delta = min_release_delta
	local requirement_mask<const> = state.evaluation_requirement_mask
	if requirement_mask & requirement_guard ~= 0 then
		state.guarded_just_pressed = evaluate_guard(state, frame)
	end
	if requirement_mask & requirement_repeat_state ~= 0 then
		local repeat_pressed<const>, repeat_count<const> = evaluate_repeat(state, frame)
		state.repeat_pressed = repeat_pressed
		state.repeat_count = repeat_count
	end
	state.eval_frame = frame
	state.eval_gen = player.eval_generation
end

local evaluate_action_state<const> = function(states, action_key)
	local state<const> = states[action_key]
	local player<const> = state.player
	if state.eval_frame ~= player.sample_frame or state.eval_gen ~= player.eval_generation then
		refresh_action_state(player, state)
	end
	return state
end

function input.bind(player_index, pattern)
	local player<const> = players[player_index]
	local evaluate = player.expression_bindings[pattern]
	if not evaluate then
		local program<const> = action_parser.compile(pattern)
		local action_names<const> = program.action_names
		local action_requirement_masks<const> = program.action_requirement_masks
		local states<const> = {}
		for i = 1, #action_names do
			local state<const> = compile_action_state(player, action_names[i])
			local requirement_mask<const> = state.evaluation_requirement_mask | action_requirement_masks[i]
			if requirement_mask ~= state.evaluation_requirement_mask then
				state.evaluation_requirement_mask = requirement_mask
				state.eval_frame = -1
			end
			states[i] = state
		end
		evaluate = program.evaluation_factory(
			evaluate_action_state,
			states,
			buffer_frame_retention
		)
		player.expression_bindings[pattern] = evaluate
	end
	return evaluate
end

function input.is_action_pressed(player_index, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_action_state(player.actions, action)
	return state.pressed and not state.consumed
end

function input.is_action_just_pressed(player_index, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_action_state(player.actions, action)
	return state.just_pressed and not state.consumed
end

function input.is_action_just_released(player_index, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_action_state(player.actions, action)
	return state.just_released and not state.consumed
end

function input.get_action_value(player_index, action)
	local player<const> = players[player_index]
	return evaluate_action_state(player.actions, action).value_q16
end

function input.get_vector(player_index, action)
	local player<const> = players[player_index]
	local state<const> = evaluate_action_state(player.actions, action)
	return state.value_x_q16, state.value_y_q16
end

local consume_action<const> = function(state)
	local resolved<const> = state.resolved
	for source_index = source_keyboard, source_pointer do
		local states<const> = resolved[source_index]
		for i = 1, #states do
			local button<const> = states[i]
			if button.pressed then
				button.consumed = true
			end
		end
	end
end

function input.consume(player_index, actions)
	local player<const> = players[player_index]
	player.eval_generation = player.eval_generation + 1
	if type(actions) == 'table' then
		for i = 1, #actions do
			consume_action(player.actions[actions[i]])
		end
		return
	end
	consume_action(player.actions[actions])
end

return input
