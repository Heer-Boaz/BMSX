local terminal<const> = require('bios/terminal')
local monitor_commands<const> = require('bios/monitor_commands')
local layout<const> = require('bios/terminal_layout')

local monitor_editor<const> = {}

local input_capacity<const> = layout.columns - 4
local history_capacity<const> = layout.history_capacity
local palette_text<const> = terminal.palette_text

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
bss monitor_editor_completion_pending: word

local render<const> = function()
	terminal.render_input(monitor_editor_line, *monitor_editor_length, *monitor_editor_cursor, palette_text)
end

local reset_navigation<const> = function()
	*monitor_editor_history_offset = 0
	*monitor_editor_completion_pending = 0
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
	*monitor_editor_completion_pending = 0
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

function monitor_editor.resume()
	terminal.begin_input()
	render()
	terminal.show_cursor()
end

function monitor_editor.detach()
	terminal.hide_cursor()
	terminal.end_input()
end

function monitor_editor.submit()
	monitor_editor.detach()
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
	local line<const>: *word = monitor_editor_line
	local erase_at<const> = *monitor_editor_cursor - 1
	for index = erase_at, *monitor_editor_length - 2 do
		line[index] = line[index + 1]
	end
	*monitor_editor_length = *monitor_editor_length - 1
	*monitor_editor_cursor = erase_at
	reset_navigation()
	render()
end

function monitor_editor.delete()
	if *monitor_editor_cursor == *monitor_editor_length then
		return
	end
	local line<const>: *word = monitor_editor_line
	for index = *monitor_editor_cursor, *monitor_editor_length - 2 do
		line[index] = line[index + 1]
	end
	*monitor_editor_length = *monitor_editor_length - 1
	reset_navigation()
	render()
end

function monitor_editor.left()
	if *monitor_editor_cursor ~= 0 then
		*monitor_editor_cursor = *monitor_editor_cursor - 1
		*monitor_editor_completion_pending = 0
		render()
	end
end

function monitor_editor.right()
	if *monitor_editor_cursor ~= *monitor_editor_length then
		*monitor_editor_cursor = *monitor_editor_cursor + 1
		*monitor_editor_completion_pending = 0
		render()
	end
end

function monitor_editor.home()
	if *monitor_editor_cursor ~= 0 then
		*monitor_editor_cursor = 0
		*monitor_editor_completion_pending = 0
		render()
	end
end

function monitor_editor.move_end()
	if *monitor_editor_cursor ~= *monitor_editor_length then
		*monitor_editor_cursor = *monitor_editor_length
		*monitor_editor_completion_pending = 0
		render()
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
	*monitor_editor_completion_pending = 0
	load_history(*monitor_editor_history_offset)
end

function monitor_editor.next()
	if *monitor_editor_history_offset == 0 then
		return
	end
	*monitor_editor_history_offset = *monitor_editor_history_offset - 1
	*monitor_editor_completion_pending = 0
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
		render()
	end
	if match_count <= 1 then
		*monitor_editor_completion_pending = 0
		return false
	end
	if *monitor_editor_completion_pending ~= 0 and not changed then
		monitor_commands.start_candidates(monitor_editor_line, *monitor_editor_cursor)
		*monitor_editor_completion_pending = 0
		return true
	end
	*monitor_editor_completion_pending = 1
	return false
end

return monitor_editor
