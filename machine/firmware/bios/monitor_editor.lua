local terminal<const> = require('bios/terminal')
local monitor_commands<const> = require('bios/monitor_commands')
local layout<const> = require('bios/terminal_layout')

local monitor_editor<const> = {}

local input_capacity<const> = layout.columns - 4
local history_capacity<const> = layout.history_capacity
local palette_text<const> = terminal.palette_text
local ascii_space<const> = 32

bss monitor_editor_line: word[input_capacity]
bss monitor_editor_length: word
bss monitor_editor_cursor: word
bss monitor_editor_history: word[history_capacity * input_capacity]
bss monitor_editor_history_lengths: word[history_capacity]
bss monitor_editor_history_head: word
bss monitor_editor_history_count: word
bss monitor_editor_history_offset: word
bss monitor_editor_draft: word[input_capacity]
bss monitor_editor_draft_length: word
bss monitor_editor_draft_cursor: word
bss monitor_editor_candidate_row: word[layout.columns]

local render<const> = function()
	terminal.render_input(monitor_editor_line, *monitor_editor_length, *monitor_editor_cursor, palette_text)
end

local reset_navigation<const> = function()
	*monitor_editor_history_offset = 0
end

local erase_range<const> = function(first, last)
	local line<const>: *word = monitor_editor_line
	local count<const> = last - first
	for index = first, *monitor_editor_length - count - 1 do
		line[index] = line[index + count]
	end
	*monitor_editor_length = *monitor_editor_length - count
	*monitor_editor_cursor = first
	reset_navigation()
	render()
end

local latest_history_slot<const> = function(offset)
	return (*monitor_editor_history_head - offset + history_capacity) % history_capacity
end

local history_equals_line<const> = function(slot)
	local lengths<const>: *word = monitor_editor_history_lengths
	if lengths[slot] ~= *monitor_editor_length then
		return false
	end
	local history<const>: *word = monitor_editor_history
	local line<const>: *word = monitor_editor_line
	local base<const> = slot * input_capacity
	for index = 0, *monitor_editor_length - 1 do
		if history[base + index] ~= line[index] then
			return false
		end
	end
	return true
end

local remember_line<const> = function()
	if *monitor_editor_length == 0 then
		return
	end
	if *monitor_editor_history_count ~= 0 and history_equals_line(latest_history_slot(1)) then
		return
	end
	local slot<const> = *monitor_editor_history_head
	local history<const>: *word = monitor_editor_history
	local line<const>: *word = monitor_editor_line
	local lengths<const>: *word = monitor_editor_history_lengths
	local base<const> = slot * input_capacity
	for index = 0, *monitor_editor_length - 1 do
		history[base + index] = line[index]
	end
	lengths[slot] = *monitor_editor_length
	*monitor_editor_history_head = (slot + 1) % history_capacity
	if *monitor_editor_history_count < history_capacity then
		*monitor_editor_history_count = *monitor_editor_history_count + 1
	end
end

local save_draft<const> = function()
	local line<const>: *word = monitor_editor_line
	local draft<const>: *word = monitor_editor_draft
	for index = 0, *monitor_editor_length - 1 do
		draft[index] = line[index]
	end
	*monitor_editor_draft_length = *monitor_editor_length
	*monitor_editor_draft_cursor = *monitor_editor_cursor
end

local load_words<const> = function(source, length, cursor)
	local from<const>: *word = source
	local line<const>: *word = monitor_editor_line
	for index = 0, length - 1 do
		line[index] = from[index]
	end
	*monitor_editor_length = length
	*monitor_editor_cursor = cursor
	render()
end

local load_history<const> = function(offset)
	local history<const>: *word = monitor_editor_history
	local lengths<const>: *word = monitor_editor_history_lengths
	local slot<const> = latest_history_slot(offset)
	local length<const> = lengths[slot]
	load_words(history + slot * input_capacity, length, length)
end

function monitor_editor.open()
	*monitor_editor_length = 0
	*monitor_editor_cursor = 0
	*monitor_editor_history_head = 0
	*monitor_editor_history_count = 0
	*monitor_editor_history_offset = 0
	local lengths<const>: *word = monitor_editor_history_lengths
	for index = 0, history_capacity - 1 do
		lengths[index] = 0
	end
end

function monitor_editor.begin()
	*monitor_editor_length = 0
	*monitor_editor_cursor = 0
	reset_navigation()
	terminal.begin_input()
	render()
	terminal.show_cursor()
end

function monitor_editor.submit()
	terminal.hide_cursor()
	terminal.end_input()
	remember_line()
	reset_navigation()
	return monitor_editor_line, *monitor_editor_length
end

function monitor_editor.insert(code)
	if *monitor_editor_length == input_capacity then
		return
	end
	local line<const>: *word = monitor_editor_line
	for index = *monitor_editor_length, *monitor_editor_cursor + 1, -1 do
		line[index] = line[index - 1]
	end
	line[*monitor_editor_cursor] = code
	*monitor_editor_length = *monitor_editor_length + 1
	*monitor_editor_cursor = *monitor_editor_cursor + 1
	reset_navigation()
	render()
end

function monitor_editor.backspace()
	if *monitor_editor_cursor == 0 then
		return
	end
	local erase_at<const> = *monitor_editor_cursor - 1
	erase_range(erase_at, *monitor_editor_cursor)
end

function monitor_editor.delete()
	if *monitor_editor_cursor == *monitor_editor_length then
		return
	end
	erase_range(*monitor_editor_cursor, *monitor_editor_cursor + 1)
end

function monitor_editor.left()
	if *monitor_editor_cursor ~= 0 then
		*monitor_editor_cursor = *monitor_editor_cursor - 1
		render()
	end
end

function monitor_editor.right()
	if *monitor_editor_cursor ~= *monitor_editor_length then
		*monitor_editor_cursor = *monitor_editor_cursor + 1
		render()
	end
end

function monitor_editor.home()
	if *monitor_editor_cursor ~= 0 then
		*monitor_editor_cursor = 0
		render()
	end
end

function monitor_editor.move_end()
	if *monitor_editor_cursor ~= *monitor_editor_length then
		*monitor_editor_cursor = *monitor_editor_length
		render()
	end
end

function monitor_editor.word_left()
	local line<const>: *word = monitor_editor_line
	local cursor = *monitor_editor_cursor
	while cursor > 0 and line[cursor - 1] == ascii_space do
		cursor = cursor - 1
	end
	while cursor > 0 and line[cursor - 1] ~= ascii_space do
		cursor = cursor - 1
	end
	if cursor ~= *monitor_editor_cursor then
		*monitor_editor_cursor = cursor
		render()
	end
end

function monitor_editor.word_right()
	local line<const>: *word = monitor_editor_line
	local cursor = *monitor_editor_cursor
	while cursor < *monitor_editor_length and line[cursor] ~= ascii_space do
		cursor = cursor + 1
	end
	while cursor < *monitor_editor_length and line[cursor] == ascii_space do
		cursor = cursor + 1
	end
	if cursor ~= *monitor_editor_cursor then
		*monitor_editor_cursor = cursor
		render()
	end
end

function monitor_editor.backspace_word()
	local line<const>: *word = monitor_editor_line
	local first = *monitor_editor_cursor
	while first > 0 and line[first - 1] == ascii_space do
		first = first - 1
	end
	while first > 0 and line[first - 1] ~= ascii_space do
		first = first - 1
	end
	if first ~= *monitor_editor_cursor then
		erase_range(first, *monitor_editor_cursor)
	end
end

function monitor_editor.delete_word()
	local line<const>: *word = monitor_editor_line
	local last = *monitor_editor_cursor
	while last < *monitor_editor_length and line[last] ~= ascii_space do
		last = last + 1
	end
	while last < *monitor_editor_length and line[last] == ascii_space do
		last = last + 1
	end
	if last ~= *monitor_editor_cursor then
		erase_range(*monitor_editor_cursor, last)
	end
end

function monitor_editor.clear()
	*monitor_editor_length = 0
	*monitor_editor_cursor = 0
	reset_navigation()
	render()
end

function monitor_editor.previous()
	if *monitor_editor_history_offset == *monitor_editor_history_count then
		return
	end
	if *monitor_editor_history_offset == 0 then
		save_draft()
	end
	*monitor_editor_history_offset = *monitor_editor_history_offset + 1
	load_history(*monitor_editor_history_offset)
end

function monitor_editor.next()
	if *monitor_editor_history_offset == 0 then
		return
	end
	*monitor_editor_history_offset = *monitor_editor_history_offset - 1
	if *monitor_editor_history_offset == 0 then
		load_words(monitor_editor_draft, *monitor_editor_draft_length, *monitor_editor_draft_cursor)
	else
		load_history(*monitor_editor_history_offset)
	end
end

function monitor_editor.complete()
	local length<const>, cursor<const>, match_count<const>, changed<const> = monitor_commands.complete(
		monitor_editor_line,
		*monitor_editor_length,
		*monitor_editor_cursor,
		input_capacity)
	*monitor_editor_length = length
	*monitor_editor_cursor = cursor
	if changed then
		reset_navigation()
		render()
	end
	return match_count
end

function monitor_editor.show_candidates(selected, match_count)
	monitor_commands.fill_candidates(
		monitor_editor_candidate_row,
		match_count,
		selected)
	terminal.show_status_row(monitor_editor_candidate_row)
end

function monitor_editor.accept_candidate(selected)
	local length<const> = monitor_commands.accept_candidate(
		monitor_editor_line,
		input_capacity,
		selected)
	*monitor_editor_length = length
	*monitor_editor_cursor = length
	reset_navigation()
	render()
end

return monitor_editor
