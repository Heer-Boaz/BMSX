-- cartlib/input/player.lua
-- Cart-owned PlayerInput: action mappings and action-expression state built from
-- raw ICU snapshot reads (keyboard bitmap, pad button/axis words, pointer words).
-- Edge detection (justpressed/justreleased) is derived here from latched levels.

local action_parser<const> = require('cartlib/input/action_parser')
local keys<const> = require('cartlib/input/keys')

local input<const> = {}

local source_keyboard<const> = 1
local source_gamepad<const> = 2
local source_pointer<const> = 3

local gamepad_bits<const> = {
	['a'] = inp_btn_a, ['b'] = inp_btn_b, ['x'] = inp_btn_x, ['y'] = inp_btn_y,
	['lb'] = inp_btn_lb, ['rb'] = inp_btn_rb, ['lt'] = inp_btn_lt, ['rt'] = inp_btn_rt,
	['select'] = inp_btn_select, ['start'] = inp_btn_start, ['ls'] = inp_btn_ls, ['rs'] = inp_btn_rs,
	['up'] = inp_btn_up, ['down'] = inp_btn_down, ['left'] = inp_btn_left, ['right'] = inp_btn_right,
	['home'] = inp_btn_home, ['touch'] = inp_btn_touch,
}

local pointer_bits<const> = {
	['pointer_primary'] = inp_pointer_primary,
	['pointer_aux'] = inp_pointer_aux,
	['pointer_secondary'] = inp_pointer_secondary,
	['pointer_back'] = inp_pointer_back,
	['pointer_forward'] = inp_pointer_forward,
}

local player_count<const> = 4
local buffer_frame_retention<const> = 150
local initial_repeat_delay_frames<const> = 15
local repeat_interval_frames<const> = 4
local guard_window_frames<const> = 2
-- Sentinel for "no press/release seen": larger than any reachable frame delta.
local huge_delta<const> = 0x7fffffff

input.default_keyboard = {
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

input.default_gamepad = {
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

input.default_pointer = {
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
local frame_serial = 0
local active_player

local empty_state<const> = {
	pressed = false,
	justpressed = false,
	justreleased = false,
	waspressed = false,
	wasreleased = false,
	alljustpressed = false,
	alljustreleased = false,
	allwaspressed = false,
	consumed = false,
	guardedjustpressed = false,
	repeatpressed = false,
	repeatcount = 0,
	presstime = 0,
	timestamp = 0,
	value_q16 = 0,
	value_x_q16 = 0,
	value_y_q16 = 0,
}

local new_button_state<const> = function(button)
	return {
		button = button,
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
		justpressed = false,
		justreleased = false,
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
			state.level_addr = sys_inp_keys + ((usage >> 5) << 2)
			state.level_mask = 1 << (usage & 31)
		end
		return
	end
	if source_index == source_gamepad then
		local bit<const> = gamepad_bits[button]
		if bit then
			local pad_base<const> = sys_inp_pads + (player.index - 1) * inp_pad_stride
			state.level_addr = pad_base + inp_pad_buttons
			state.level_mask = 1 << bit
			if button == 'ls' then
				state.value_x_addr = pad_base + inp_pad_lx
				state.value_y_addr = pad_base + inp_pad_ly
			elseif button == 'rs' then
				state.value_x_addr = pad_base + inp_pad_rx
				state.value_y_addr = pad_base + inp_pad_ry
			elseif button == 'lt' then
				state.value_addr = pad_base + inp_pad_lt
			elseif button == 'rt' then
				state.value_addr = pad_base + inp_pad_rt
			end
		end
		return
	end
	local bit<const> = pointer_bits[button]
	if bit then
		state.level_addr = sys_inp_pointer_buttons
		state.level_mask = 1 << bit
	elseif button == 'pointer_position' then
		state.value_x_addr = sys_inp_pointer_x
		state.value_y_addr = sys_inp_pointer_y
	elseif button == 'pointer_delta' then
		state.is_pointer_delta = true
	elseif button == 'pointer_wheel' then
		state.value_addr = sys_inp_pointer_wheel
		state.pressed_from_value = true
	end
end

local new_action_state<const> = function(action)
	return {
		action = action,
		pressed = false,
		justpressed = false,
		justreleased = false,
		waspressed = false,
		wasreleased = false,
		alljustpressed = false,
		alljustreleased = false,
		allwaspressed = false,
		consumed = false,
		guardedjustpressed = false,
		repeatpressed = false,
		repeatcount = 0,
		presstime = 0,
		timestamp = 0,
		value_q16 = 0,
		value_x_q16 = 0,
		value_y_q16 = 0,
		press_id = 0,
		has_presstime = false,
		-- cached frame deltas; was*/allwaspressed derive from these per window
		min_press_delta = huge_delta,
		minmax_press_delta = huge_delta,
		min_release_delta = huge_delta,
		eval_frame = -1,
		eval_gen = -1,
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

local track_button<const> = function(player, source_index, button)
	local source_buttons<const> = player.buttons[source_index]
	local state = source_buttons[button]
	if state then
		return state
	end
	state = new_button_state(button)
	resolve_binding(player, source_index, button, state)
	source_buttons[button] = state
	local list<const> = player.button_lists[source_index]
	list[#list + 1] = state
	return state
end

local track_mapping<const> = function(player, source_index, mapping)
	for _, bindings in pairs(mapping) do
		for i = 1, #bindings do
			track_button(player, source_index, binding_id(bindings[i]))
		end
	end
end

local clear_action_evaluation_state<const> = function(player)
	player.guard_records = {}
	player.repeat_records = {}
	player.eval_generation = player.eval_generation + 1
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
	track_mapping(player, source_keyboard, record.keyboard)
	track_mapping(player, source_gamepad, record.gamepad)
	track_mapping(player, source_pointer, record.pointer)
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
		button_lists = {
			[source_keyboard] = {},
			[source_gamepad] = {},
			[source_pointer] = {},
		},
		contexts = {},
		context_order = 0,
		actions = {},
		guard_records = {},
		repeat_records = {},
		binding_seen = {},
		binding_generation = 0,
		next_press_id = 1,
		sample_frame = -1,
		eval_generation = 0,
		aggregation = {},
	}
	push_context_record(player, {
		id = '__default',
		priority = 0,
		enabled = true,
		keyboard = input.default_keyboard,
		gamepad = input.default_gamepad,
		pointer = input.default_pointer,
	})
	return player
end

local ensure_player<const> = function(index)
	local player = players[index]
	if player then
		return player
	end
	player = new_player(index)
	players[index] = player
	return player
end

local ensure_action_state_record<const> = function(player, action)
	local state = player.actions[action]
	if state then
		return state
	end
	state = new_action_state(action)
	player.actions[action] = state
	return state
end

local sample_button_state<const> = function(player, state)
	local pressed = false
	if state.level_mask ~= 0 then
		pressed = (mem[state.level_addr] & state.level_mask) ~= 0
	end
	if state.value_addr ~= 0 then
		state.value_q16 = mem[state.value_addr]
		if state.pressed_from_value then
			pressed = state.value_q16 ~= 0
		end
	end
	if state.value_x_addr ~= 0 then
		state.value_x_q16 = mem[state.value_x_addr]
		state.value_y_q16 = mem[state.value_y_addr]
	end
	if state.is_pointer_delta then
		local x<const> = mem[sys_inp_pointer_x]
		local y<const> = mem[sys_inp_pointer_y]
		state.value_x_q16 = x - state.prev_x_q16
		state.value_y_q16 = y - state.prev_y_q16
		state.prev_x_q16 = x
		state.prev_y_q16 = y
		pressed = state.value_x_q16 ~= 0 or state.value_y_q16 ~= 0
	end
	local justpressed<const> = pressed and not state.pressed
	local justreleased<const> = (not pressed) and state.pressed
	state.justpressed = justpressed
	state.justreleased = justreleased
	if justpressed then
		state.press_id = player.next_press_id
		player.next_press_id = player.next_press_id + 1
		state.press_start_frame = frame_serial
		state.last_press_frame = frame_serial
		state.consumed = false
	elseif not pressed then
		state.consumed = false
	end
	if justreleased then
		state.last_release_frame = frame_serial
	end
	state.pressed = pressed
end

local sample_player<const> = function(player)
	if player.sample_frame == frame_serial then
		return
	end
	for source_index = source_keyboard, source_pointer do
		local list<const> = player.button_lists[source_index]
		for i = 1, #list do
			sample_button_state(player, list[i])
		end
	end
	player.sample_frame = frame_serial
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

-- Windows resolve at read time: a binding contributes its frames-since-press /
-- frames-since-release delta (-1 while pressed / on the release edge), and
-- was*/allwaspressed become `delta < window` compares on the cached minimums.
local merge_binding<const> = function(agg, state)
	local press_delta = frame_serial - state.last_press_frame
	if state.pressed then
		press_delta = -1
	end
	local release_delta = frame_serial - state.last_release_frame
	if state.justreleased then
		release_delta = -1
	end
	agg.any_binding = true
	agg.any_pressed = agg.any_pressed or state.pressed
	agg.all_pressed = agg.all_pressed and state.pressed
	agg.any_justpressed = agg.any_justpressed or state.justpressed
	agg.all_justpressed = agg.all_justpressed and state.justpressed
	agg.any_justreleased = agg.any_justreleased or state.justreleased
	agg.all_justreleased = agg.all_justreleased and state.justreleased
	agg.any_consumed = agg.any_consumed or state.consumed
	if press_delta < agg.min_press_delta then
		agg.min_press_delta = press_delta
	end
	if press_delta > agg.max_press_delta then
		agg.max_press_delta = press_delta
	end
	if release_delta < agg.min_release_delta then
		agg.min_release_delta = release_delta
	end
	if state.pressed then
		local presstime<const> = frame_serial - state.press_start_frame
		if not agg.has_presstime or presstime < agg.presstime then
			agg.presstime = presstime
			agg.has_presstime = true
		end
		if state.press_id >= agg.press_id then
			agg.press_id = state.press_id
		end
	end
	if state.value_q16 ~= 0 or state.value_x_q16 ~= 0 or state.value_y_q16 ~= 0 then
		agg.value_q16 = state.value_q16
		agg.value_x_q16 = state.value_x_q16
		agg.value_y_q16 = state.value_y_q16
	end
end

local reset_aggregation<const> = function(agg)
	agg.any_binding = false
	agg.any_pressed = false
	agg.all_pressed = true
	agg.any_justpressed = false
	agg.all_justpressed = true
	agg.any_justreleased = false
	agg.all_justreleased = true
	agg.any_consumed = false
	agg.has_presstime = false
	agg.presstime = 0
	agg.press_id = 0
	agg.min_press_delta = huge_delta
	agg.max_press_delta = -1
	agg.min_release_delta = huge_delta
	agg.value_q16 = 0
	agg.value_x_q16 = 0
	agg.value_y_q16 = 0
end

local aggregate_source<const> = function(player, action, source_index, agg)
	reset_aggregation(agg)
	player.binding_generation = player.binding_generation + 1
	local contexts<const> = player.contexts
	for i = 1, #contexts do
		local ctx<const> = contexts[i]
		if ctx.enabled then
			local mapping<const> = source_mapping(ctx, source_index)
			local bindings<const> = mapping[action]
			if bindings then
				for j = 1, #bindings do
					local button<const> = binding_id(bindings[j])
					if not seen_binding(player, button) then
						merge_binding(agg, track_button(player, source_index, button))
					end
				end
			end
		end
	end
	if not agg.any_binding then
		agg.all_pressed = false
		agg.all_justpressed = false
		agg.all_justreleased = false
	end
end

-- All-source merge: any_* bits OR across sources; all* bits hold when at least
-- one source with bindings satisfies them (matching the per-source OR the old
-- per-source aggregation produced). minmax_press_delta is min-over-sources of
-- max-over-bindings, so `minmax < window` == "some source had all bindings
-- pressed within the window".
local fold_source<const> = function(state, agg)
	state.pressed = state.pressed or agg.any_pressed
	state.justpressed = state.justpressed or agg.any_justpressed
	state.justreleased = state.justreleased or agg.any_justreleased
	state.alljustpressed = state.alljustpressed or agg.all_justpressed
	state.alljustreleased = state.alljustreleased or agg.all_justreleased
	state.consumed = state.consumed or agg.any_consumed
	if agg.has_presstime and (not state.has_presstime or agg.presstime < state.presstime) then
		state.has_presstime = true
		state.presstime = agg.presstime
	end
	if agg.press_id > state.press_id then
		state.press_id = agg.press_id
	end
	if state.value_q16 == 0 then
		state.value_q16 = agg.value_q16
	end
	if state.value_x_q16 == 0 then
		state.value_x_q16 = agg.value_x_q16
	end
	if state.value_y_q16 == 0 then
		state.value_y_q16 = agg.value_y_q16
	end
	if agg.min_press_delta < state.min_press_delta then
		state.min_press_delta = agg.min_press_delta
	end
	if agg.any_binding and agg.max_press_delta < state.minmax_press_delta then
		state.minmax_press_delta = agg.max_press_delta
	end
	if agg.min_release_delta < state.min_release_delta then
		state.min_release_delta = agg.min_release_delta
	end
end

local evaluate_guard<const> = function(player, action, state)
	if not state.justpressed then
		return false
	end
	local record = player.guard_records[action]
	if record and record.last_press_id == state.press_id then
		return record.last_result
	end
	local accepted = true
	if record and (frame_serial - record.last_accepted_frame) <= guard_window_frames then
		accepted = false
	end
	if not record then
		record = {}
		player.guard_records[action] = record
	end
	if accepted then
		record.last_accepted_frame = frame_serial
	elseif not record.last_accepted_frame then
		record.last_accepted_frame = frame_serial
	end
	record.last_press_id = state.press_id
	record.last_result = accepted
	return accepted
end

local evaluate_repeat<const> = function(player, action, state)
	local repeat_record = player.repeat_records[action]
	if not repeat_record then
		repeat_record = { active = false, count = 0, press_start_frame = -1, last_frame = -1, last_result = false, last_repeat_frame = -1 }
		player.repeat_records[action] = repeat_record
	end
	if repeat_record.last_frame == frame_serial then
		return repeat_record.last_result, repeat_record.count
	end
	local result = false
	if state.justpressed then
		repeat_record.active = true
		repeat_record.count = 0
		repeat_record.press_start_frame = frame_serial
		repeat_record.last_repeat_frame = frame_serial
	elseif not state.pressed then
		repeat_record.active = false
		repeat_record.count = 0
		repeat_record.press_start_frame = -1
		repeat_record.last_repeat_frame = -1
	else
		if not repeat_record.active then
			repeat_record.active = true
			repeat_record.count = 0
			repeat_record.press_start_frame = frame_serial
			repeat_record.last_repeat_frame = frame_serial
		end
		local next_frame<const> = repeat_record.count == 0 and (repeat_record.press_start_frame + initial_repeat_delay_frames) or (repeat_record.last_repeat_frame + repeat_interval_frames)
		if frame_serial >= next_frame then
			repeat_record.count = repeat_record.count + 1
			repeat_record.last_repeat_frame = next_frame
			result = true
		end
	end
	repeat_record.last_frame = frame_serial
	repeat_record.last_result = result
	return result, repeat_record.count
end

function input.update()
	frame_serial = frame_serial + 1
	for index = 1, player_count do
		local player<const> = players[index]
		if player then
			sample_player(player)
		end
	end
end

function input.push_context(player_index, id, keyboard, gamepad, pointer, priority, enabled)
	push_context_record(ensure_player(player_index), {
		id = id,
		priority = priority or 100,
		enabled = enabled or enabled == nil,
		keyboard = keyboard or {},
		gamepad = gamepad or {},
		pointer = pointer or {},
	})
end

function input.clear_context(player_index, id)
	local player<const> = ensure_player(player_index)
	for i = #player.contexts, 1, -1 do
		if player.contexts[i].id == id then
			table.remove(player.contexts, i)
		end
	end
	clear_action_evaluation_state(player)
end

-- Full evaluation runs once per action per frame (per eval generation); later
-- reads this frame hit the cache below and only re-derive the window compares.
local refresh_action_state<const> = function(player, state)
	state.pressed = false
	state.justpressed = false
	state.justreleased = false
	state.alljustpressed = false
	state.alljustreleased = false
	state.consumed = false
	state.has_presstime = false
	state.presstime = 0
	state.press_id = 0
	state.value_q16 = 0
	state.value_x_q16 = 0
	state.value_y_q16 = 0
	state.min_press_delta = huge_delta
	state.minmax_press_delta = huge_delta
	state.min_release_delta = huge_delta
	local agg<const> = player.aggregation
	local action<const> = state.action
	for source_index = source_keyboard, source_pointer do
		aggregate_source(player, action, source_index, agg)
		fold_source(state, agg)
	end
	state.timestamp = frame_serial
	state.guardedjustpressed = evaluate_guard(player, action, state)
	local repeatpressed<const>, repeatcount<const> = evaluate_repeat(player, action, state)
	state.repeatpressed = repeatpressed
	state.repeatcount = repeatcount
	state.eval_frame = frame_serial
	state.eval_gen = player.eval_generation
end

local evaluate_action_state<const> = function(player_index, action, window)
	local player<const> = ensure_player(player_index)
	sample_player(player)
	local state<const> = ensure_action_state_record(player, action)
	if state.eval_frame ~= frame_serial or state.eval_gen ~= player.eval_generation then
		refresh_action_state(player, state)
	end
	local frame_window<const> = window or buffer_frame_retention
	state.waspressed = state.min_press_delta < frame_window
	state.allwaspressed = state.minmax_press_delta < frame_window
	state.wasreleased = state.min_release_delta < frame_window
	return state
end

local get_active_action_state<const> = function(action, window)
	return evaluate_action_state(active_player.index, action, window)
end

function input.query(player_index, pattern)
	local player<const> = ensure_player(player_index)
	active_player = player
	local result<const> = action_parser.check(pattern, get_active_action_state)
	active_player = nil
	return result
end

function input.pressed(player_index, action)
	return evaluate_action_state(player_index, action).pressed
end

function input.just_pressed(player_index, action)
	return evaluate_action_state(player_index, action).justpressed
end

function input.just_released(player_index, action)
	return evaluate_action_state(player_index, action).justreleased
end

local consume_one<const> = function(player, action)
	for source_index = source_keyboard, source_pointer do
		player.binding_generation = player.binding_generation + 1
		local contexts<const> = player.contexts
		for i = 1, #contexts do
			local ctx<const> = contexts[i]
			if ctx.enabled then
				local mapping<const> = source_mapping(ctx, source_index)
				local bindings<const> = mapping[action]
				if bindings then
					for j = 1, #bindings do
						local button<const> = binding_id(bindings[j])
						if not seen_binding(player, button) then
							local state<const> = track_button(player, source_index, button)
							if state.pressed and not state.consumed then
								state.consumed = true
							end
						end
					end
				end
			end
		end
	end
end

-- Comma-separated consume strings split once; repeat calls reuse the cached
-- list so the steady-state consume path stays allocation-free.
local consume_lists<const> = {}

local split_consume_list<const> = function(actions)
	local list<const> = {}
	local start = 1
	local len<const> = #actions
	while start <= len do
		local comma<const> = string.find(actions, ',', start, true)
		if comma then
			list[#list + 1] = string.sub(actions, start, comma - 1)
			start = comma + 1
		else
			list[#list + 1] = string.sub(actions, start)
			consume_lists[actions] = list
			return list
		end
	end
	consume_lists[actions] = list
	return list
end

function input.consume(player_index, actions)
	local player<const> = ensure_player(player_index)
	sample_player(player)
	player.eval_generation = player.eval_generation + 1
	if type(actions) == 'table' then
		for i = 1, #actions do
			consume_one(player, actions[i])
		end
		return
	end
	local list<const> = consume_lists[actions] or split_consume_list(actions)
	for i = 1, #list do
		consume_one(player, list[i])
	end
end

function input.raw_button_state(player_index, source_index, button)
	local player<const> = ensure_player(player_index)
	sample_player(player)
	return player.buttons[source_index][button] or empty_state
end

input.source_keyboard = source_keyboard
input.source_gamepad = source_gamepad
input.source_pointer = source_pointer

return input
