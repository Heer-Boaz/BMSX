local constants = require("ide_constants")
local piece_tree_buffer = require("piece_tree_buffer")
local code_layout = require("code_layout")
local source_text = require("source_text")
local lua_analysis_cache = require("lua_analysis_cache")
local editor_undo = require("editor_undo")

local editor = {}

local undo_coalesce_interval_ms = 400
local toggle_editor_key = "F1"
local editor_cpu_hz = 800000000

local character_map = {
	["KeyA"] = { normal = "a", shift = "A" },
	["KeyB"] = { normal = "b", shift = "B" },
	["KeyC"] = { normal = "c", shift = "C" },
	["KeyD"] = { normal = "d", shift = "D" },
	["KeyE"] = { normal = "e", shift = "E" },
	["KeyF"] = { normal = "f", shift = "F" },
	["KeyG"] = { normal = "g", shift = "G" },
	["KeyH"] = { normal = "h", shift = "H" },
	["KeyI"] = { normal = "i", shift = "I" },
	["KeyJ"] = { normal = "j", shift = "J" },
	["KeyK"] = { normal = "k", shift = "K" },
	["KeyL"] = { normal = "l", shift = "L" },
	["KeyM"] = { normal = "m", shift = "M" },
	["KeyN"] = { normal = "n", shift = "N" },
	["KeyO"] = { normal = "o", shift = "O" },
	["KeyP"] = { normal = "p", shift = "P" },
	["KeyQ"] = { normal = "q", shift = "Q" },
	["KeyR"] = { normal = "r", shift = "R" },
	["KeyS"] = { normal = "s", shift = "S" },
	["KeyT"] = { normal = "t", shift = "T" },
	["KeyU"] = { normal = "u", shift = "U" },
	["KeyV"] = { normal = "v", shift = "V" },
	["KeyW"] = { normal = "w", shift = "W" },
	["KeyX"] = { normal = "x", shift = "X" },
	["KeyY"] = { normal = "y", shift = "Y" },
	["KeyZ"] = { normal = "z", shift = "Z" },
	["Digit0"] = { normal = "0", shift = ")" },
	["Digit1"] = { normal = "1", shift = "!" },
	["Digit2"] = { normal = "2", shift = "@" },
	["Digit3"] = { normal = "3", shift = "#" },
	["Digit4"] = { normal = "4", shift = "$" },
	["Digit5"] = { normal = "5", shift = "%" },
	["Digit6"] = { normal = "6", shift = "^" },
	["Digit7"] = { normal = "7", shift = "&" },
	["Digit8"] = { normal = "8", shift = "*" },
	["Digit9"] = { normal = "9", shift = "(" },
	["Minus"] = { normal = "-", shift = "_" },
	["Equal"] = { normal = "=", shift = "+" },
	["BracketLeft"] = { normal = "[", shift = "{" },
	["BracketRight"] = { normal = "]", shift = "}" },
	["Backslash"] = { normal = "\\", shift = "|" },
	["Semicolon"] = { normal = ";", shift = ":" },
	["Quote"] = { normal = "'", shift = '"' },
	["Comma"] = { normal = ",", shift = "<" },
	["Period"] = { normal = ".", shift = ">" },
	["Slash"] = { normal = "/", shift = "?" },
	["Backquote"] = { normal = "`", shift = "~" },
}

local character_codes = {
	"KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM",
	"KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
	"Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
	"Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period",
	"Slash", "Backquote",
}

local state = {
	font = nil,
	line_height = 0,
	char_advance = 0,
	header_height = 0,
	status_height = 0,
	open = false,
	initialized = false,
	gutter_width = 2,
	gutter_padding = 3,
	scroll_row = 0,
	scroll_column = 0,
	word_wrap_enabled = false,
	code_vertical_scrollbar_visible = false,
	code_horizontal_scrollbar_visible = false,
	cached_visible_row_count = 1,
	cached_visible_column_count = 1,
	buffer = nil,
	layout = nil,
	active_path = nil,
	max_line_length = 0,
	max_line_length_version = -1,
	cursor_row = 0,
	cursor_column = 0,
	desired_column = 0,
	desired_display_offset = 0,
	selection_anchor = nil,
	pointer_selecting = false,
	undo_stack = {},
	redo_stack = {},
	last_history_key = nil,
	last_history_timestamp = 0,
	save_point_depth = 0,
	analysis_entry = nil,
	analysis_version = -1,
	dirty = false,
	cpu_hz_before_open = nil,
}

local tmp_position = { row = 0, column = 0 }
local view_metrics = {
	code_top = 0,
	code_bottom = 0,
	code_left = 0,
	code_right = 0,
	gutter_left = 0,
	gutter_right = 0,
	text_left = 0,
	content_bottom = 0,
	content_right = 0,
	row_capacity = 1,
	column_capacity = 1,
	visual_count = 0,
}

local function clamp(value, min_value, max_value)
	if value < min_value then
		return min_value
	end
	if value > max_value then
		return max_value
	end
	return value
end

local function compute_max_line_length()
	if state.max_line_length_version == state.buffer.version then
		return state.max_line_length
	end
	local line_count = state.buffer:get_line_count()
	local max_length = 0
	for row = 0, line_count - 1 do
		local length = state.buffer:get_line_end_offset(row) - state.buffer:get_line_start_offset(row)
		if length > max_length then
			max_length = length
		end
	end
	state.max_line_length = max_length
	state.max_line_length_version = state.buffer.version
	return max_length
end

local function get_line_length(row)
	return state.buffer:get_line_end_offset(row) - state.buffer:get_line_start_offset(row)
end

local function update_gutter_width()
	local line_count = state.buffer:get_line_count()
	local digits = #tostring(line_count)
	local next_width = (digits * state.char_advance) + (state.gutter_padding * 2)
	if next_width ~= state.gutter_width then
		state.gutter_width = next_width
		state.layout:mark_visual_lines_dirty()
	end
end

local function compute_wrap_width()
	local gutter_space = state.gutter_width + 2
	local available = display_width() - gutter_space - constants.code_area_right_margin
	return math.max(state.char_advance, available - 2)
end

local function update_layout()
	state.scroll_row = state.layout:ensure_visual_lines({
		buffer = state.buffer,
		word_wrap_enabled = state.word_wrap_enabled,
		scroll_row = state.scroll_row,
		document_version = state.buffer.version,
		path = state.active_path,
		compute_wrap_width = compute_wrap_width,
		estimated_visible_row_count = math.max(1, state.cached_visible_row_count),
	})
end

local function refresh_view_metrics()
	update_gutter_width()
	update_layout()
	view_metrics.code_top = state.header_height
	view_metrics.code_bottom = display_height() - state.status_height
	view_metrics.code_left = 0
	view_metrics.code_right = display_width()
	view_metrics.gutter_left = view_metrics.code_left
	view_metrics.gutter_right = view_metrics.gutter_left + state.gutter_width
	view_metrics.text_left = view_metrics.gutter_right + 2

	local gutter_offset = view_metrics.text_left - view_metrics.code_left
	local advance = state.char_advance
	local wrap_enabled = state.word_wrap_enabled
	local horizontal_visible = (not wrap_enabled) and state.code_horizontal_scrollbar_visible
	local vertical_visible = state.code_vertical_scrollbar_visible
	local row_capacity = state.cached_visible_row_count
	local column_capacity = state.cached_visible_column_count
	local visual_count = state.layout:get_visual_line_count()

	for _ = 1, 3 do
		local available_height = math.max(0, (view_metrics.code_bottom - view_metrics.code_top) - (horizontal_visible and constants.scrollbar_width or 0))
		row_capacity = math.max(1, math.floor(available_height / state.line_height))
		vertical_visible = visual_count > row_capacity
		local available_width = math.max(
			0,
			(view_metrics.code_right - view_metrics.code_left)
			- (vertical_visible and constants.scrollbar_width or 0)
			- gutter_offset
			- constants.code_area_right_margin
		)
		column_capacity = math.max(1, math.floor(available_width / advance))
		if wrap_enabled then
			horizontal_visible = false
		else
			horizontal_visible = compute_max_line_length() > column_capacity
		end
	end

	state.code_vertical_scrollbar_visible = vertical_visible
	state.code_horizontal_scrollbar_visible = horizontal_visible
	state.cached_visible_row_count = row_capacity
	state.cached_visible_column_count = column_capacity

	view_metrics.content_bottom = view_metrics.code_bottom - (horizontal_visible and constants.scrollbar_width or 0)
	view_metrics.content_right = view_metrics.code_right - (vertical_visible and constants.scrollbar_width or 0)
	view_metrics.row_capacity = row_capacity
	view_metrics.column_capacity = column_capacity
	view_metrics.visual_count = visual_count

	return view_metrics
end

local function compare_positions(left_row, left_column, right_row, right_column)
	if left_row ~= right_row then
		return left_row - right_row
	end
	return left_column - right_column
end

local function get_selection_range()
	local anchor = state.selection_anchor
	if not anchor then
		return nil
	end
	if anchor.row == state.cursor_row and anchor.column == state.cursor_column then
		return nil
	end
	if compare_positions(state.cursor_row, state.cursor_column, anchor.row, anchor.column) < 0 then
		return state.cursor_row, state.cursor_column, anchor.row, anchor.column
	end
	return anchor.row, anchor.column, state.cursor_row, state.cursor_column
end

local function clear_selection()
	state.selection_anchor = nil
end

local function ensure_selection_anchor_from_current_cursor()
	if not state.selection_anchor then
		state.selection_anchor = { row = state.cursor_row, column = state.cursor_column }
	end
end

local function break_undo_sequence()
	state.last_history_key = nil
	state.last_history_timestamp = 0
end

local function clamp_cursor_position()
	local line_count = state.buffer:get_line_count()
	state.cursor_row = clamp(state.cursor_row, 0, line_count - 1)
	state.cursor_column = clamp(state.cursor_column, 0, get_line_length(state.cursor_row))
	if state.selection_anchor then
		state.selection_anchor.row = clamp(state.selection_anchor.row, 0, line_count - 1)
		state.selection_anchor.column = clamp(state.selection_anchor.column, 0, get_line_length(state.selection_anchor.row))
	end
end

local function update_desired_track()
	refresh_view_metrics()
	clamp_cursor_position()
	local visual_index = state.layout:position_to_visual_index(state.buffer, state.cursor_row, state.cursor_column)
	local segment = state.layout:visual_index_to_segment(visual_index)
	local entry = state.layout:get_cached_highlight(state.buffer, state.cursor_row)
	local highlight = entry.hi
	local cursor_display = state.layout:column_to_display(highlight, state.cursor_column)
	state.desired_column = state.cursor_column
	if state.word_wrap_enabled and segment then
		local segment_display_start = state.layout:column_to_display(highlight, segment.start_column)
		state.desired_display_offset = math.max(0, cursor_display - segment_display_start)
	else
		state.desired_display_offset = cursor_display
	end
end

local function set_cursor_from_visual_index(target_visual_index, desired_column_hint, desired_display_offset_hint)
	local metrics = refresh_view_metrics()
	local visual_count = metrics.visual_count
	local clamped_visual_index = clamp(target_visual_index, 0, math.max(0, visual_count - 1))
	local segment = state.layout:visual_index_to_segment(clamped_visual_index)
	if not segment then
		state.cursor_row = 0
		state.cursor_column = 0
		state.desired_column = 0
		state.desired_display_offset = 0
		return
	end
	local row = segment.row
	local line = state.buffer:get_line_content(row)
	local entry = state.layout:get_cached_highlight(state.buffer, row)
	local highlight = entry.hi
	local target_column
	if state.word_wrap_enabled then
		local segment_start_column = segment.start_column
		local segment_end_column = math.max(segment.start_column, segment.end_column)
		if desired_display_offset_hint ~= nil then
			local segment_display_start = state.layout:column_to_display(highlight, segment_start_column)
			local segment_display_end = state.layout:column_to_display(highlight, segment_end_column)
			local target_display = clamp(segment_display_start + desired_display_offset_hint, segment_display_start, segment_display_end)
			target_column = entry.display_to_column[target_display]
			if target_column == nil then
				target_column = #line
			end
			target_column = clamp(target_column, segment_start_column, segment_end_column)
		else
			target_column = clamp(desired_column_hint or state.cursor_column, segment_start_column, segment_end_column)
		end
		target_column = clamp(target_column, 0, #line)
		local has_next_same_row = clamped_visual_index + 1 < visual_count
			and state.layout:visual_index_to_segment(clamped_visual_index + 1).row == row
		if has_next_same_row and target_column >= segment_end_column and segment_end_column > segment_start_column then
			target_column = segment_end_column - 1
		end
		local cursor_display = state.layout:column_to_display(highlight, target_column)
		local segment_display_start = state.layout:column_to_display(highlight, segment_start_column)
		state.desired_display_offset = math.max(0, cursor_display - segment_display_start)
	else
		target_column = clamp(desired_column_hint or state.cursor_column, 0, #line)
		state.desired_display_offset = state.layout:column_to_display(highlight, target_column)
	end
	state.cursor_row = row
	state.cursor_column = target_column
	state.desired_column = math.max(0, desired_column_hint or target_column)
end

local function ensure_cursor_visible()
	local metrics = refresh_view_metrics()
	clamp_cursor_position()

	local cursor_visual_index = state.layout:position_to_visual_index(state.buffer, state.cursor_row, state.cursor_column)
	local max_scroll_row = math.max(0, metrics.visual_count - metrics.row_capacity)
	local vertical_margin = math.min(3, math.max(0, math.floor(metrics.row_capacity / 6)))
	local top_guard = state.scroll_row + vertical_margin
	local bottom_guard = state.scroll_row + metrics.row_capacity - 1 - vertical_margin

	if cursor_visual_index < top_guard then
		state.scroll_row = clamp(cursor_visual_index - vertical_margin, 0, max_scroll_row)
	elseif cursor_visual_index > bottom_guard then
		state.scroll_row = clamp(cursor_visual_index - metrics.row_capacity + 1 + vertical_margin, 0, max_scroll_row)
	elseif state.scroll_row > max_scroll_row then
		state.scroll_row = max_scroll_row
	end
	if state.scroll_row < 0 then
		state.scroll_row = 0
	end

	if state.word_wrap_enabled then
		state.scroll_column = 0
		return
	end

	local line_length = get_line_length(state.cursor_row)
	local doc_max_scroll_column = math.max(0, compute_max_line_length() - metrics.column_capacity)
	local line_max_scroll_column = math.max(0, line_length - metrics.column_capacity)
	local max_scroll_column = math.min(doc_max_scroll_column, line_max_scroll_column)
	local horizontal_margin = math.min(4, math.max(0, math.floor(metrics.column_capacity / 6)))
	local left_guard = state.scroll_column + horizontal_margin
	local right_guard = state.scroll_column + metrics.column_capacity - 1 - horizontal_margin

	if state.cursor_column < left_guard then
		state.scroll_column = clamp(state.cursor_column - horizontal_margin, 0, max_scroll_column)
	elseif state.cursor_column > right_guard then
		state.scroll_column = clamp(state.cursor_column - metrics.column_capacity + 1 + horizontal_margin, 0, max_scroll_column)
	elseif state.scroll_column > max_scroll_column then
		state.scroll_column = max_scroll_column
	end
	if state.scroll_column < 0 then
		state.scroll_column = 0
	end
end

local function step_left(row, column)
	if column > 0 then
		return row, column - 1
	end
	if row > 0 then
		local previous_row = row - 1
		return previous_row, get_line_length(previous_row)
	end
	return nil, nil
end

local function step_right(row, column)
	local length = get_line_length(row)
	if column < length then
		return row, column + 1
	end
	if row < state.buffer:get_line_count() - 1 then
		return row + 1, 0
	end
	return nil, nil
end

local function is_identifier_part_code(code)
	return code
		and (((code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 95) or (code >= 48 and code <= 57))
end

local function is_whitespace_code(code)
	return code == 32 or code == 9 or code == 10 or code == 13
end

local function find_word_left(row, column)
	local cursor_offset = state.buffer:offset_at(row, column)
	if cursor_offset == 0 then
		return 0, 0
	end
	local offset = cursor_offset - 1
	while offset >= 0 do
		local code = state.buffer:char_code_at(offset)
		if not is_whitespace_code(code) then
			break
		end
		if offset == 0 then
			return 0, 0
		end
		offset = offset - 1
	end
	local word = is_identifier_part_code(state.buffer:char_code_at(offset))
	while offset > 0 do
		local previous_code = state.buffer:char_code_at(offset - 1)
		if is_whitespace_code(previous_code) or is_identifier_part_code(previous_code) ~= word then
			break
		end
		offset = offset - 1
	end
	state.buffer:position_at(offset, tmp_position)
	return tmp_position.row, tmp_position.column
end

local function find_word_right(row, column)
	local cursor_offset = state.buffer:offset_at(row, column)
	local length = state.buffer:length()
	if cursor_offset >= length then
		local last_row = state.buffer:get_line_count() - 1
		return last_row, get_line_length(last_row)
	end
	local offset = cursor_offset
	while offset < length do
		local code = state.buffer:char_code_at(offset)
		if not is_whitespace_code(code) then
			break
		end
		offset = offset + 1
	end
	if offset >= length then
		local last_row = state.buffer:get_line_count() - 1
		return last_row, get_line_length(last_row)
	end
	local word = is_identifier_part_code(state.buffer:char_code_at(offset))
	offset = offset + 1
	while offset < length do
		local code = state.buffer:char_code_at(offset)
		if is_whitespace_code(code) or is_identifier_part_code(code) ~= word then
			break
		end
		offset = offset + 1
	end
	while offset < length do
		local code = state.buffer:char_code_at(offset)
		if not is_whitespace_code(code) then
			break
		end
		offset = offset + 1
	end
	state.buffer:position_at(offset, tmp_position)
	return tmp_position.row, tmp_position.column
end

local function mark_document_mutated(start_row)
	state.layout:invalidate_line(start_row)
	state.layout:mark_visual_lines_dirty()
	state.max_line_length_version = -1
	state.analysis_version = -1
end

local function update_dirty_flag()
	state.dirty = #state.undo_stack ~= state.save_point_depth
end

local function update_last_undo_after_state()
	local record = state.undo_stack[#state.undo_stack]
	if not record then
		return
	end
	local anchor = state.selection_anchor
	record:set_after_state(
		state.cursor_row,
		state.cursor_column,
		state.scroll_row,
		state.scroll_column,
		anchor and anchor.row or 0,
		anchor and anchor.column or 0,
		anchor ~= nil
	)
	update_dirty_flag()
end

local function release_undo_record(record)
	local ops = record.ops
	for index = 1, #ops do
		local op = ops[index]
		if op.deleted_root then
			state.buffer:release_detached_subtree(op.deleted_root)
			op.deleted_root = nil
		end
		if op.inserted_root then
			state.buffer:release_detached_subtree(op.inserted_root)
			op.inserted_root = nil
		end
	end
end

local function clear_redo_stack()
	for index = 1, #state.redo_stack do
		release_undo_record(state.redo_stack[index])
	end
	state.redo_stack = {}
end

local function prepare_undo(key, allow_merge)
	local now = $.platform.clock.now()
	local should_merge = allow_merge
		and state.last_history_key == key
		and now - state.last_history_timestamp <= undo_coalesce_interval_ms
	if should_merge then
		state.last_history_timestamp = now
		return
	end

	local record = editor_undo.undo_record.new()
	local anchor = state.selection_anchor
	record:set_before_state(
		state.cursor_row,
		state.cursor_column,
		state.scroll_row,
		state.scroll_column,
		anchor and anchor.row or 0,
		anchor and anchor.column or 0,
		anchor ~= nil
	)
	record:set_after_state(
		state.cursor_row,
		state.cursor_column,
		state.scroll_row,
		state.scroll_column,
		anchor and anchor.row or 0,
		anchor and anchor.column or 0,
		anchor ~= nil
	)

	if #state.undo_stack >= 256 then
		local dropped = table.remove(state.undo_stack, 1)
		release_undo_record(dropped)
	end
	state.undo_stack[#state.undo_stack + 1] = record
	clear_redo_stack()

	state.last_history_timestamp = now
	if allow_merge then
		state.last_history_key = key
	else
		state.last_history_key = nil
	end
	update_dirty_flag()
end

local function apply_undoable_replace(offset, delete_length, insert_text)
	if delete_length == 0 and #insert_text == 0 then
		return
	end
	local record = state.undo_stack[#state.undo_stack]
	local op = editor_undo.text_undo_op.new()

	if delete_length == 0 and #insert_text > 0 then
		state.buffer:insert(offset, insert_text)
		op:set_insert(offset, #insert_text)
	elseif delete_length > 0 and #insert_text == 0 then
		local deleted_root = state.buffer:delete_to_subtree(offset, delete_length)
		op:set_delete(offset, delete_length, deleted_root)
	else
		local deleted_root = state.buffer:replace_to_subtree(offset, delete_length, insert_text)
		op:set_replace(offset, delete_length, deleted_root, #insert_text)
	end

	record.ops[#record.ops + 1] = op
end

local function apply_replace_and_set_cursor(start_offset, delete_length, insert_text, cursor_offset, start_row)
	apply_undoable_replace(start_offset, delete_length, insert_text)
	state.buffer:position_at(cursor_offset, tmp_position)
	state.cursor_row = tmp_position.row
	state.cursor_column = tmp_position.column
	clear_selection()
	state.pointer_selecting = false
	mark_document_mutated(start_row)
	update_desired_track()
	ensure_cursor_visible()
	update_last_undo_after_state()
end

local function undo()
	if #state.undo_stack == 0 then
		return
	end
	local record = table.remove(state.undo_stack)
	local ops = record.ops
	for index = #ops, 1, -1 do
		local op = ops[index]
		if op.kind == "insert" then
			op.inserted_root = state.buffer:delete_to_subtree(op.offset, op.inserted_len)
		elseif op.kind == "delete" then
			state.buffer:insert_subtree(op.offset, op.deleted_root)
			op.deleted_root = nil
		else
			op.inserted_root = state.buffer:delete_to_subtree(op.offset, op.inserted_len)
			state.buffer:insert_subtree(op.offset, op.deleted_root)
			op.deleted_root = nil
		end
	end

	if #state.redo_stack >= 256 then
		local dropped = table.remove(state.redo_stack, 1)
		release_undo_record(dropped)
	end
	state.redo_stack[#state.redo_stack + 1] = record

	state.cursor_row = record.before_cursor_row
	state.cursor_column = record.before_cursor_column
	state.scroll_row = record.before_scroll_row
	state.scroll_column = record.before_scroll_column
	if record.before_has_selection_anchor then
		state.selection_anchor = { row = record.before_selection_anchor_row, column = record.before_selection_anchor_column }
	else
		state.selection_anchor = nil
	end
	state.pointer_selecting = false
	state.layout:mark_visual_lines_dirty()
	state.max_line_length_version = -1
	state.analysis_version = -1
	update_desired_track()
	ensure_cursor_visible()
	update_dirty_flag()
	break_undo_sequence()
end

local function redo()
	if #state.redo_stack == 0 then
		return
	end
	local record = table.remove(state.redo_stack)
	local ops = record.ops
	for index = 1, #ops do
		local op = ops[index]
		if op.kind == "insert" then
			state.buffer:insert_subtree(op.offset, op.inserted_root)
			op.inserted_root = nil
		elseif op.kind == "delete" then
			op.deleted_root = state.buffer:delete_to_subtree(op.offset, op.deleted_len)
		else
			op.deleted_root = state.buffer:delete_to_subtree(op.offset, op.deleted_len)
			state.buffer:insert_subtree(op.offset, op.inserted_root)
			op.inserted_root = nil
		end
	end

	if #state.undo_stack >= 256 then
		local dropped = table.remove(state.undo_stack, 1)
		release_undo_record(dropped)
	end
	state.undo_stack[#state.undo_stack + 1] = record

	state.cursor_row = record.after_cursor_row
	state.cursor_column = record.after_cursor_column
	state.scroll_row = record.after_scroll_row
	state.scroll_column = record.after_scroll_column
	if record.after_has_selection_anchor then
		state.selection_anchor = { row = record.after_selection_anchor_row, column = record.after_selection_anchor_column }
	else
		state.selection_anchor = nil
	end
	state.pointer_selecting = false
	state.layout:mark_visual_lines_dirty()
	state.max_line_length_version = -1
	state.analysis_version = -1
	update_desired_track()
	ensure_cursor_visible()
	update_dirty_flag()
	break_undo_sequence()
end

local function delete_selection(undo_key, allow_merge)
	local start_row, start_column, end_row, end_column = get_selection_range()
	if not start_row then
		return false
	end
	local start_offset = state.buffer:offset_at(start_row, start_column)
	local end_offset = state.buffer:offset_at(end_row, end_column)
	prepare_undo(undo_key, allow_merge)
	apply_replace_and_set_cursor(start_offset, end_offset - start_offset, "", start_offset, start_row)
	return true
end

local function extract_indentation(line, column)
	local limit = math.min(column, #line)
	local index = 1
	while index <= limit do
		local code = string.byte(line, index)
		if code ~= 32 and code ~= 9 then
			return string.sub(line, 1, index - 1)
		end
		index = index + 1
	end
	return string.sub(line, 1, limit)
end

local function insert_text(text)
	if #text == 0 then
		return
	end
	local start_row, start_column, end_row, end_column = get_selection_range()
	local edit_row = start_row or state.cursor_row
	local start_offset
	local delete_length
	if start_row then
		start_offset = state.buffer:offset_at(start_row, start_column)
		delete_length = state.buffer:offset_at(end_row, end_column) - start_offset
	else
		start_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
		delete_length = 0
	end
	prepare_undo("insert-text", #text == 1)
	apply_replace_and_set_cursor(start_offset, delete_length, text, start_offset + #text, edit_row)
end

local function insert_line_break()
	local start_row, start_column, end_row, end_column = get_selection_range()
	local insertion_row = start_row or state.cursor_row
	local insertion_column = start_column or state.cursor_column
	local line = state.buffer:get_line_content(insertion_row)
	local insertion = "\n" .. extract_indentation(line, insertion_column)
	local start_offset
	local delete_length
	if start_row then
		start_offset = state.buffer:offset_at(start_row, start_column)
		delete_length = state.buffer:offset_at(end_row, end_column) - start_offset
	else
		start_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
		delete_length = 0
	end
	prepare_undo("insert-line-break", false)
	apply_replace_and_set_cursor(start_offset, delete_length, insertion, start_offset + #insertion, insertion_row)
end

local function backspace()
	local cursor_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
	local start_row
	if get_selection_range() == nil and cursor_offset == 0 then
		return
	end
	if delete_selection("backspace", true) then
		return
	end
	prepare_undo("backspace", true)
	local delete_offset = cursor_offset - 1
	state.buffer:position_at(delete_offset, tmp_position)
	start_row = tmp_position.row
	apply_replace_and_set_cursor(delete_offset, 1, "", delete_offset, start_row)
end

local function delete_forward()
	local cursor_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
	if get_selection_range() == nil and cursor_offset >= state.buffer:length() then
		return
	end
	if delete_selection("delete-forward", true) then
		return
	end
	prepare_undo("delete-forward", true)
	apply_replace_and_set_cursor(cursor_offset, 1, "", cursor_offset, state.cursor_row)
end

local function delete_word_backward()
	local cursor_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
	if get_selection_range() == nil and cursor_offset == 0 then
		return
	end
	if delete_selection("delete-word-backward", false) then
		return
	end
	local target_row, target_column = find_word_left(state.cursor_row, state.cursor_column)
	local target_offset = state.buffer:offset_at(target_row, target_column)
	if target_offset == cursor_offset then
		backspace()
		return
	end
	prepare_undo("delete-word-backward", false)
	apply_replace_and_set_cursor(target_offset, cursor_offset - target_offset, "", target_offset, target_row)
end

local function delete_word_forward()
	local cursor_offset = state.buffer:offset_at(state.cursor_row, state.cursor_column)
	if get_selection_range() == nil and cursor_offset >= state.buffer:length() then
		return
	end
	if delete_selection("delete-word-forward", false) then
		return
	end
	local target_row, target_column = find_word_right(state.cursor_row, state.cursor_column)
	local target_offset = state.buffer:offset_at(target_row, target_column)
	if target_offset == cursor_offset then
		delete_forward()
		return
	end
	prepare_undo("delete-word-forward", false)
	apply_replace_and_set_cursor(cursor_offset, target_offset - cursor_offset, "", cursor_offset, state.cursor_row)
end

local function get_selected_line_range()
	local start_row, _, end_row, end_column = get_selection_range()
	if not start_row then
		return state.cursor_row, state.cursor_row
	end
	if end_column == 0 and end_row > start_row then
		end_row = end_row - 1
	end
	return start_row, end_row
end

local function indent_selection_or_insert_tab()
	local start_row, end_row = get_selected_line_range()
	local has_selection_range = get_selection_range() ~= nil
	local has_block = has_selection_range and end_row >= start_row
	if not has_block and not has_selection_range then
		insert_text("\t")
		return
	end
	prepare_undo("indent", false)
	for row = end_row, start_row, -1 do
		local offset = state.buffer:get_line_start_offset(row)
		apply_undoable_replace(offset, 0, "\t")
	end
	if state.selection_anchor and state.selection_anchor.row >= start_row and state.selection_anchor.row <= end_row then
		state.selection_anchor.column = state.selection_anchor.column + 1
	end
	if state.cursor_row >= start_row and state.cursor_row <= end_row then
		state.cursor_column = state.cursor_column + 1
	end
	state.pointer_selecting = false
	mark_document_mutated(start_row)
	update_desired_track()
	ensure_cursor_visible()
	update_last_undo_after_state()
end

local function unindent_selection_or_line()
	local start_row, end_row = get_selected_line_range()
	local removed = {}
	local changed = false
	for row = start_row, end_row do
		local line = state.buffer:get_line_content(row)
		local first = string.byte(line, 1)
		if first == 9 or first == 32 then
			removed[row] = 1
			changed = true
		end
	end
	if not changed then
		return
	end
	prepare_undo("unindent", false)
	for row = end_row, start_row, -1 do
		if removed[row] == 1 then
			local offset = state.buffer:get_line_start_offset(row)
			apply_undoable_replace(offset, 1, "")
		end
	end
	if state.selection_anchor and removed[state.selection_anchor.row] == 1 then
		state.selection_anchor.column = math.max(0, state.selection_anchor.column - 1)
	end
	if removed[state.cursor_row] == 1 then
		state.cursor_column = math.max(0, state.cursor_column - 1)
	end
	state.pointer_selecting = false
	mark_document_mutated(start_row)
	update_desired_track()
	ensure_cursor_visible()
	update_last_undo_after_state()
end

local function select_all()
	local last_row = state.buffer:get_line_count() - 1
	state.selection_anchor = { row = 0, column = 0 }
	state.cursor_row = last_row
	state.cursor_column = get_line_length(last_row)
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function collapse_selection_to_start()
	local start_row, start_column = get_selection_range()
	if not start_row then
		return false
	end
	state.cursor_row = start_row
	state.cursor_column = start_column
	clear_selection()
	update_desired_track()
	ensure_cursor_visible()
	return true
end

local function collapse_selection_to_end()
	local _, _, end_row, end_column = get_selection_range()
	if not end_row then
		return false
	end
	state.cursor_row = end_row
	state.cursor_column = end_column
	clear_selection()
	update_desired_track()
	ensure_cursor_visible()
	return true
end

local function move_cursor_left(selecting)
	if not selecting and collapse_selection_to_start() then
		break_undo_sequence()
		return
	end
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	local next_row, next_column = step_left(state.cursor_row, state.cursor_column)
	if not next_row then
		return
	end
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = next_row
	state.cursor_column = next_column
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_cursor_right(selecting)
	if not selecting and collapse_selection_to_end() then
		break_undo_sequence()
		return
	end
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	local next_row, next_column = step_right(state.cursor_row, state.cursor_column)
	if not next_row then
		return
	end
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = next_row
	state.cursor_column = next_column
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_word_left(selecting)
	if not selecting and collapse_selection_to_start() then
		break_undo_sequence()
		return
	end
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	local row, column = find_word_left(state.cursor_row, state.cursor_column)
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = row
	state.cursor_column = column
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_word_right(selecting)
	if not selecting and collapse_selection_to_end() then
		break_undo_sequence()
		return
	end
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	local row, column = find_word_right(state.cursor_row, state.cursor_column)
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = row
	state.cursor_column = column
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_cursor_vertical(delta, selecting)
	refresh_view_metrics()
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	local current_visual_index = state.layout:position_to_visual_index(state.buffer, state.cursor_row, state.cursor_column)
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	set_cursor_from_visual_index(current_visual_index + delta, state.desired_column, state.desired_display_offset)
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_to_line_start(selecting)
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_column = 0
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_to_line_end(selecting)
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_column = get_line_length(state.cursor_row)
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_to_document_start(selecting)
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = 0
	state.cursor_column = 0
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function move_to_document_end(selecting)
	local previous_row = state.cursor_row
	local previous_column = state.cursor_column
	if selecting then
		if not state.selection_anchor then
			state.selection_anchor = { row = previous_row, column = previous_column }
		end
	else
		clear_selection()
	end
	state.cursor_row = state.buffer:get_line_count() - 1
	state.cursor_column = get_line_length(state.cursor_row)
	update_desired_track()
	ensure_cursor_visible()
	break_undo_sequence()
end

local function get_modifiers(player_input)
	return player_input["getModifiersState"](player_input)
end

local function is_key_just_pressed(player_input, code)
	return player_input["getButtonState"](player_input, code, "keyboard").justpressed
end

local function should_repeat_key(player_input, code)
	local repeat_state = player_input["getButtonRepeatState"](player_input, code, "keyboard")
	return repeat_state.justpressed or repeat_state.repeatpressed
end

local function consume_key(player_input, code)
	player_input["consumeButton"](player_input, code, "keyboard")
end

local function truncate_for_width(text, pixel_width)
	local max_chars = math.max(0, math.floor(pixel_width / math.max(1, state.char_advance)))
	if #text <= max_chars then
		return text
	end
	if max_chars <= 3 then
		return string.sub(text, 1, max_chars)
	end
	return string.sub(text, 1, max_chars - 3) .. "..."
end

local function update_analysis_if_needed()
	if state.analysis_version == state.buffer.version then
		return
	end
	local source = source_text.get_text_snapshot(state.buffer)
	state.analysis_entry = lua_analysis_cache.get_cached_lua_parse({
		path = state.active_path,
		source = source,
		version = state.buffer.version,
	})
	state.analysis_version = state.buffer.version
end

local function resolve_display_from_x(entry, start_display, end_display, x)
	if x <= 0 then
		return start_display
	end
	local prefix = entry.advance_prefix
	local start_advance = prefix[start_display]
	local low = start_display
	local high = end_display
	while low < high do
		local mid = (low + high) >> 1
		local offset = prefix[mid] - start_advance
		if offset < x then
			low = mid + 1
		else
			high = mid
		end
	end
	local candidate = low
	if candidate > start_display then
		local previous = candidate - 1
		local previous_offset = prefix[previous] - start_advance
		local candidate_offset = prefix[candidate] - start_advance
		if x - previous_offset <= candidate_offset - x then
			candidate = previous
		end
	end
	return candidate
end

local function resolve_pointer_position(pointer_x, pointer_y, metrics)
	local line_count = state.buffer:get_line_count()
	if metrics.visual_count == 0 then
		return 0, 0, 0
	end
	local row_offset = clamp(math.floor((pointer_y - metrics.code_top) / state.line_height), 0, math.max(0, metrics.row_capacity - 1))
	local visual_index = clamp(state.scroll_row + row_offset, 0, math.max(0, metrics.visual_count - 1))
	local segment = state.layout:visual_index_to_segment(visual_index)
	if not segment then
		local last_row = line_count - 1
		return last_row, get_line_length(last_row), 0
	end
	local row = segment.row
	local line_length = get_line_length(row)
	local entry = state.layout:get_cached_highlight(state.buffer, row)
	local highlight = entry.hi
	local start_column = state.word_wrap_enabled and segment.start_column or state.scroll_column
	local end_column = state.word_wrap_enabled and segment.end_column or line_length
	if pointer_x < metrics.text_left then
		if state.word_wrap_enabled then
			return row, start_column, 0
		end
		return row, 0, 0
	end
	local slice_start_display = state.layout:column_to_display(highlight, start_column)
	local slice_end_display = state.layout:column_to_display(highlight, end_column)
	local local_x = pointer_x - metrics.text_left
	local target_display = resolve_display_from_x(entry, slice_start_display, slice_end_display, local_x)
	local target_column = entry.display_to_column[target_display]
	if target_column == nil then
		target_column = #entry.src
	end
	if state.word_wrap_enabled then
		target_column = clamp(target_column, segment.start_column, segment.end_column)
	else
		target_column = clamp(target_column, 0, line_length)
	end
	return row, target_column, math.max(0, target_display - slice_start_display)
end

local function handle_pointer_input(metrics)
	local pointer = mousepos()
	local inside_code = pointer.valid
		and pointer.inside
		and pointer.x >= metrics.code_left
		and pointer.x < metrics.content_right
		and pointer.y >= metrics.code_top
		and pointer.y < metrics.content_bottom
	local primary_just_pressed = mousebtnp(0)
	local primary_pressed = mousebtn(0)
	local primary_just_released = mousebtnr(0)

	if primary_just_pressed and inside_code then
		local player_input = get_player_input()
		local modifiers = get_modifiers(player_input)
		local row, column, display_offset = resolve_pointer_position(pointer.x, pointer.y, metrics)
		if modifiers.shift then
			ensure_selection_anchor_from_current_cursor()
		else
			state.selection_anchor = { row = row, column = column }
		end
		state.cursor_row = row
		state.cursor_column = column
		state.desired_column = column
		state.desired_display_offset = display_offset
		state.pointer_selecting = true
		ensure_cursor_visible()
		break_undo_sequence()
	end

	if state.pointer_selecting and primary_pressed and inside_code then
		local row, column, display_offset = resolve_pointer_position(pointer.x, pointer.y, metrics)
		state.cursor_row = row
		state.cursor_column = column
		state.desired_column = column
		state.desired_display_offset = display_offset
		ensure_cursor_visible()
	end

	if primary_just_released then
		if state.pointer_selecting and state.selection_anchor
			and state.selection_anchor.row == state.cursor_row
			and state.selection_anchor.column == state.cursor_column then
			clear_selection()
		end
		state.pointer_selecting = false
		update_desired_track()
	end
end

local function handle_pointer_wheel(metrics)
	local pointer = mousepos()
	local inside_code = pointer.valid
		and pointer.inside
		and pointer.x >= metrics.code_left
		and pointer.x < metrics.code_right
		and pointer.y >= metrics.code_top
		and pointer.y < metrics.code_bottom
	if not inside_code then
		return
	end
	local wheel = mousewheel()
	if not wheel.valid or wheel.value == 0 then
		return
	end
	local direction = wheel.value > 0 and 1 or -1
	local steps = math.max(1, math.floor(math.abs(wheel.value)))
	local max_scroll_row = math.max(0, metrics.visual_count - metrics.row_capacity)
	state.scroll_row = clamp(state.scroll_row + direction * steps, 0, max_scroll_row)
	break_undo_sequence()
end

local function handle_keyboard_input(metrics)
	local player_input = get_player_input()
	local modifiers = get_modifiers(player_input)
	local primary_mod = modifiers.ctrl or modifiers.meta
	local selecting = modifiers.shift

	if primary_mod and selecting and is_key_just_pressed(player_input, "KeyZ") then
		consume_key(player_input, "KeyZ")
		redo()
		return
	end
	if primary_mod and is_key_just_pressed(player_input, "KeyY") then
		consume_key(player_input, "KeyY")
		redo()
		return
	end
	if primary_mod and is_key_just_pressed(player_input, "KeyZ") then
		consume_key(player_input, "KeyZ")
		undo()
		return
	end
	if primary_mod and is_key_just_pressed(player_input, "KeyA") then
		consume_key(player_input, "KeyA")
		select_all()
		return
	end

	if should_repeat_key(player_input, "ArrowLeft") then
		consume_key(player_input, "ArrowLeft")
		if primary_mod then
			move_word_left(selecting)
		else
			move_cursor_left(selecting)
		end
		return
	end
	if should_repeat_key(player_input, "ArrowRight") then
		consume_key(player_input, "ArrowRight")
		if primary_mod then
			move_word_right(selecting)
		else
			move_cursor_right(selecting)
		end
		return
	end
	if should_repeat_key(player_input, "ArrowUp") then
		consume_key(player_input, "ArrowUp")
		move_cursor_vertical(-1, selecting)
		return
	end
	if should_repeat_key(player_input, "ArrowDown") then
		consume_key(player_input, "ArrowDown")
		move_cursor_vertical(1, selecting)
		return
	end
	if should_repeat_key(player_input, "PageUp") then
		consume_key(player_input, "PageUp")
		move_cursor_vertical(-metrics.row_capacity, selecting)
		return
	end
	if should_repeat_key(player_input, "PageDown") then
		consume_key(player_input, "PageDown")
		move_cursor_vertical(metrics.row_capacity, selecting)
		return
	end
	if should_repeat_key(player_input, "Home") then
		consume_key(player_input, "Home")
		if primary_mod then
			move_to_document_start(selecting)
		else
			move_to_line_start(selecting)
		end
		return
	end
	if should_repeat_key(player_input, "End") then
		consume_key(player_input, "End")
		if primary_mod then
			move_to_document_end(selecting)
		else
			move_to_line_end(selecting)
		end
		return
	end

	if should_repeat_key(player_input, "Backspace") then
		consume_key(player_input, "Backspace")
		if primary_mod then
			delete_word_backward()
		else
			backspace()
		end
		return
	end
	if should_repeat_key(player_input, "Delete") then
		consume_key(player_input, "Delete")
		if primary_mod then
			delete_word_forward()
		else
			delete_forward()
		end
		return
	end
	if is_key_just_pressed(player_input, "Enter") then
		consume_key(player_input, "Enter")
		insert_line_break()
		return
	end
	if should_repeat_key(player_input, "Tab") then
		consume_key(player_input, "Tab")
		if selecting then
			unindent_selection_or_line()
		else
			indent_selection_or_insert_tab()
		end
		return
	end
	if is_key_just_pressed(player_input, "Escape") then
		consume_key(player_input, "Escape")
		clear_selection()
		update_desired_track()
		break_undo_sequence()
		return
	end

	if primary_mod or modifiers.alt then
		return
	end

	if should_repeat_key(player_input, "Space") then
		consume_key(player_input, "Space")
		insert_text(" ")
		return
	end
	for index = 1, #character_codes do
		local code = character_codes[index]
		if should_repeat_key(player_input, code) then
			consume_key(player_input, code)
			local entry = character_map[code]
			insert_text(selecting and entry.shift or entry.normal)
			return
		end
	end
end

local function draw_highlight_slice(render_text, colors, advance_prefix, start_display, end_display, origin_x, origin_y)
	if end_display <= start_display then
		return
	end
	local cursor_x = origin_x
	local index = start_display
	while index < end_display do
		local color = colors[index]
		local seg_end = index + 1
		while seg_end < end_display and colors[seg_end] == color do
			seg_end = seg_end + 1
		end
		write_inline_span_with_font(render_text, index, seg_end, cursor_x, origin_y, 0, color, state.font)
		cursor_x = cursor_x + (advance_prefix[seg_end] - advance_prefix[index])
		index = seg_end
	end
end

local function compute_selection_slice(row, highlight, slice_start_display, slice_end_display)
	local start_row, start_column, end_row, end_column = get_selection_range()
	if not start_row or row < start_row or row > end_row then
		return nil, nil
	end
	local line_length = get_line_length(row)
	local selection_start_column = row == start_row and start_column or 0
	local selection_end_column = row == end_row and end_column or line_length
	if row == end_row and end_column == 0 and end_row > start_row then
		selection_end_column = 0
	end
	if selection_start_column == selection_end_column then
		return nil, nil
	end
	local start_display = state.layout:column_to_display(highlight, selection_start_column)
	local end_display = state.layout:column_to_display(highlight, selection_end_column)
	local visible_start = math.max(slice_start_display, start_display)
	local visible_end = math.min(slice_end_display, end_display)
	if visible_end <= visible_start then
		return nil, nil
	end
	return visible_start, visible_end
end

local function draw_code_area()
	local metrics = refresh_view_metrics()
	local horizontal_visible = state.code_horizontal_scrollbar_visible
	local vertical_visible = state.code_vertical_scrollbar_visible
	local wrap_enabled = state.word_wrap_enabled

	put_rectfill(metrics.code_left, metrics.code_top, metrics.code_right, metrics.code_bottom, 0, constants.color_code_background)
	if metrics.gutter_right > metrics.gutter_left then
		put_rectfill(metrics.gutter_left, metrics.code_top, metrics.gutter_right, metrics.content_bottom, 0, constants.color_gutter_background)
	end

	local cursor_visual_index = state.layout:position_to_visual_index(state.buffer, state.cursor_row, state.cursor_column)
	local text_left_floor = math.floor(metrics.text_left)
	local slice_width = metrics.column_capacity + 2
	for index = 0, metrics.row_capacity - 1 do
		local visual_index = state.scroll_row + index
		local row_y = metrics.code_top + index * state.line_height
		if row_y >= metrics.content_bottom then
			break
		end
		if visual_index >= metrics.visual_count then
			write_inline_with_font("~", text_left_floor, row_y, 0, constants.color_syntax.code_dim, state.font)
		else
			local segment = state.layout:visual_index_to_segment(visual_index)
			local line_index = segment.row
			if segment.start_column == 0 and metrics.gutter_right > metrics.gutter_left then
				local line_number = tostring(line_index + 1)
				local number_x = metrics.gutter_right - state.gutter_padding - (#line_number * state.char_advance)
				write_inline_with_font(line_number, math.floor(number_x), row_y, 0, constants.color_text_dim, state.font)
			end
			local entry = state.layout:get_cached_highlight(state.buffer, line_index)
			local highlight = entry.hi
			local render_text = highlight.text
			local column_start = wrap_enabled and segment.start_column or state.scroll_column
			local max_column = wrap_enabled and segment.end_column or get_line_length(line_index)
			local column_count = wrap_enabled and math.max(0, max_column - column_start) or slice_width
			local clamped_start_column = math.min(column_start, highlight.column_to_display_len - 1)
			local clamped_end_column = math.min(column_start + column_count, highlight.column_to_display_len - 1)
			local slice_start_display = highlight.column_to_display[clamped_start_column]
			local slice_end_display = highlight.column_to_display[clamped_end_column]

			local selection_start_display, selection_end_display = compute_selection_slice(line_index, highlight, slice_start_display, slice_end_display)
			if selection_start_display then
				local selection_left = metrics.text_left + (entry.advance_prefix[selection_start_display] - entry.advance_prefix[slice_start_display])
				local selection_right = metrics.text_left + (entry.advance_prefix[selection_end_display] - entry.advance_prefix[slice_start_display])
				put_rectfill(selection_left, row_y, selection_right, row_y + state.line_height, 0, constants.color_scrollbar_thumb)
			end

			draw_highlight_slice(render_text, highlight.colors, entry.advance_prefix, slice_start_display, slice_end_display, text_left_floor, row_y)

			if visual_index == cursor_visual_index then
				local cursor_display = state.layout:column_to_display(highlight, state.cursor_column)
				if cursor_display >= slice_start_display and cursor_display <= slice_end_display then
					local cursor_x = metrics.text_left + (entry.advance_prefix[cursor_display] - entry.advance_prefix[slice_start_display])
					put_rectfill(math.floor(cursor_x), row_y, math.floor(cursor_x) + 1, row_y + state.line_height, 0, constants.color_syntax.keyword)
				end
			end
		end
	end

	if vertical_visible then
		local track_left = metrics.code_right - constants.scrollbar_width
		local track_right = metrics.code_right
		local track_top = metrics.code_top
		local track_bottom = metrics.content_bottom
		put_rectfill(track_left, track_top, track_right, track_bottom, 0, constants.color_scrollbar_track)
		local track_height = math.max(1, track_bottom - track_top)
		local max_scroll = math.max(0, metrics.visual_count - metrics.row_capacity)
		local thumb_height = math.floor(track_height * (metrics.row_capacity / math.max(1, metrics.visual_count)))
		thumb_height = math.max(constants.scrollbar_min_thumb_height, thumb_height)
		local thumb_top
		if max_scroll > 0 then
			local range = track_height - thumb_height
			thumb_top = track_top + math.floor(range * (state.scroll_row / max_scroll))
		else
			thumb_top = track_top
		end
		put_rectfill(track_left, thumb_top, track_right, thumb_top + thumb_height, 0, constants.color_scrollbar_thumb)
	end

	if horizontal_visible then
		local track_left = metrics.code_left
		local track_right = metrics.code_right - (vertical_visible and constants.scrollbar_width or 0)
		local track_top = metrics.code_bottom - constants.scrollbar_width
		local track_bottom = metrics.code_bottom
		put_rectfill(track_left, track_top, track_right, track_bottom, 0, constants.color_scrollbar_track)
		local track_width = math.max(1, track_right - track_left)
		local max_scroll = math.max(0, compute_max_line_length() - metrics.column_capacity)
		local thumb_width = math.floor(track_width * (metrics.column_capacity / math.max(1, compute_max_line_length())))
		thumb_width = math.max(constants.scrollbar_min_thumb_height, thumb_width)
		local thumb_left
		if max_scroll > 0 then
			local range = track_width - thumb_width
			thumb_left = track_left + math.floor(range * (state.scroll_column / max_scroll))
		else
			thumb_left = track_left
		end
		put_rectfill(thumb_left, track_top, thumb_left + thumb_width, track_bottom, 0, constants.color_scrollbar_thumb)
	end
end

local function draw_header()
	local width = display_width()
	put_rectfill(0, 0, width, state.header_height, 0, constants.color_top_bar)
	local left = truncate_for_width("Lua IDE", math.floor(width * 0.25))
	local right = truncate_for_width(state.active_path, math.floor(width * 0.7))
	write_inline_with_font(left, 4, 2, 0, constants.color_syntax.builtin, state.font)
	write_inline_with_font(right, math.max(4, width - 4 - (#right * state.char_advance)), 2, 0, constants.color_syntax.code_text, state.font)
end

local function draw_status()
	local width = display_width()
	local top = display_height() - state.status_height
	put_rectfill(0, top, width, display_height(), 0, constants.color_status_bar)

	local line_info = string.format("Ln %d  Col %d", state.cursor_row + 1, state.cursor_column + 1)
	local selection_info = ""
	local start_row, start_column, end_row, end_column = get_selection_range()
	if start_row then
		local start_offset = state.buffer:offset_at(start_row, start_column)
		local end_offset = state.buffer:offset_at(end_row, end_column)
		selection_info = string.format("  Sel %d", end_offset - start_offset)
	end
	local dirty_info = state.dirty and "  * modified" or "  clean"
	local left_text = line_info .. selection_info .. dirty_info

	update_analysis_if_needed()
	local status_text = left_text
	if state.analysis_entry and state.analysis_entry.syntax_error then
		local syntax_error = state.analysis_entry.syntax_error
		status_text = string.format("Syntax Error  %d:%d  %s", syntax_error.line, syntax_error.column, syntax_error.message)
	end

	local available_left = width - 8
	local display_text = truncate_for_width(status_text, available_left)
	if state.analysis_entry and state.analysis_entry.syntax_error then
		write_inline_with_font(display_text, 4, top + 2, 0, constants.color_syntax.string, state.font)
		return
	end
	write_inline_with_font(display_text, 4, top + 2, 0, constants.color_syntax.code_text, state.font)
end

function editor.init(path)
	if type(path) ~= "string" then
		path = nil
	end
	state.font = get_default_font()
	state.line_height = state.font.lineheight
	state.char_advance = state.font:advance("M")
	state.header_height = state.line_height + 4
	state.status_height = state.line_height + 6
	state.gutter_width = 2
	state.gutter_padding = 3
	state.scroll_row = 0
	state.scroll_column = 0
	state.word_wrap_enabled = false
	state.code_vertical_scrollbar_visible = false
	state.code_horizontal_scrollbar_visible = false
	state.cached_visible_row_count = 1
	state.cached_visible_column_count = 1
	state.max_line_length = 0
	state.max_line_length_version = -1
	state.cursor_row = 0
	state.cursor_column = 0
	state.desired_column = 0
	state.desired_display_offset = 0
	state.selection_anchor = nil
	state.pointer_selecting = false
	state.undo_stack = {}
	state.redo_stack = {}
	state.last_history_key = nil
	state.last_history_timestamp = 0
	state.save_point_depth = 0
	state.active_path = path or get_lua_entry_path()
	local source = get_lua_resource_source(state.active_path)
	state.buffer = piece_tree_buffer.new(source)
	state.layout = code_layout.new(state.font, {
		max_highlight_cache = 512,
		builtin_identifiers = list_lua_builtins(),
	})
	state.analysis_entry = nil
	state.analysis_version = -1
	state.dirty = false
	state.cpu_hz_before_open = nil
	state.initialized = true
	update_desired_track()
	ensure_cursor_visible()
end

function editor.open()
	if not state.initialized then
		editor.init(nil)
	end
	if state.open then
		return
	end
	state.cpu_hz_before_open = get_cpu_freq_hz()
	set_cpu_freq_hz(math.max(state.cpu_hz_before_open, editor_cpu_hz))
	state.open = true
end

function editor.close()
	if not state.open then
		return
	end
	state.pointer_selecting = false
	set_cpu_freq_hz(state.cpu_hz_before_open)
	state.cpu_hz_before_open = nil
	state.open = false
end

function editor.toggle()
	if state.open then
		editor.close()
		return
	end
	editor.open()
end

function editor.is_open()
	return state.open
end

function editor.open_path(path)
	editor.init(path)
	editor.open()
end

function editor.update()
	local player_input = get_player_input()
	if is_key_just_pressed(player_input, toggle_editor_key) then
		consume_key(player_input, toggle_editor_key)
		editor.toggle()
	end
	if not state.open then
		return
	end
	local metrics = refresh_view_metrics()
	handle_pointer_wheel(metrics)
	handle_pointer_input(metrics)
	handle_keyboard_input(metrics)
	update_analysis_if_needed()
end

function editor.draw()
	if not state.open then
		return
	end
	draw_header()
	draw_code_area()
	draw_status()
end

return editor
