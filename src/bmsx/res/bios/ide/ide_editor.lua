-- ide_editor.lua

local constants = require("ide_constants")
local piece_tree_buffer = require("piece_tree_buffer")
local code_layout = require("code_layout")

local editor = {}

local state = {
	font = nil,
	line_height = 0,
	char_advance = 0,
	header_height = 0,
	status_height = 0,
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
}

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

local function update_gutter_width()
	local line_count = state.buffer:get_line_count()
	local digits = #tostring(line_count)
	local next_width = (digits * state.char_advance) + (state.gutter_padding * 2)
	if next_width ~= state.gutter_width then
		state.gutter_width = next_width
		state.layout:mark_visual_lines_dirty()
	end
end

local function get_code_area_bounds()
	local code_top = state.header_height
	local code_bottom = display_height() - state.status_height
	local code_left = 0
	local code_right = display_width()
	local gutter_left = code_left
	local gutter_right = gutter_left + state.gutter_width
	local text_left = gutter_right + 2
	return {
		code_top = code_top,
		code_bottom = code_bottom,
		code_left = code_left,
		code_right = code_right,
		gutter_left = gutter_left,
		gutter_right = gutter_right,
		text_left = text_left,
	}
end

local function compute_wrap_width()
	local gutter_space = state.gutter_width + 2
	local available = display_width() - gutter_space - constants.code_area_right_margin
	return math.max(state.char_advance, available - 2)
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

local function draw_code_area()
	update_gutter_width()
	update_layout()
	local bounds = get_code_area_bounds()
	local gutter_offset = bounds.text_left - bounds.code_left
	local advance = state.char_advance
	local wrap_enabled = state.word_wrap_enabled

	local horizontal_visible = (not wrap_enabled) and state.code_horizontal_scrollbar_visible
	local vertical_visible
	local row_capacity
	local column_capacity
	local visual_count = state.layout:get_visual_line_count()

	for _ = 1, 3 do
		local available_height = math.max(0, (bounds.code_bottom - bounds.code_top) - (horizontal_visible and constants.scrollbar_width or 0))
		row_capacity = math.max(1, math.floor(available_height / state.line_height))
		vertical_visible = visual_count > row_capacity
		local available_width = math.max(
			0,
			(bounds.code_right - bounds.code_left)
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

	local content_bottom = bounds.code_bottom - (horizontal_visible and constants.scrollbar_width or 0)

	put_rectfill(bounds.code_left, bounds.code_top, bounds.code_right, bounds.code_bottom, 0, constants.color_code_background)
	if bounds.gutter_right > bounds.gutter_left then
		put_rectfill(bounds.gutter_left, bounds.code_top, bounds.gutter_right, content_bottom, 0, constants.color_gutter_background)
	end

	local text_left_floor = math.floor(bounds.text_left)
	local slice_width = column_capacity + 2
	for i = 0, row_capacity - 1 do
		local visual_index = state.scroll_row + i
		local row_y = bounds.code_top + i * state.line_height
		if row_y >= content_bottom then
			break
		end
		if visual_index >= visual_count then
			write_inline_with_font("~", text_left_floor, row_y, 0, constants.color_syntax.code_dim, state.font)
		else
			local segment = state.layout:visual_index_to_segment(visual_index)
			local line_index = segment.row
			if segment.start_column == 0 and bounds.gutter_right > bounds.gutter_left then
				local line_number = tostring(line_index + 1)
				local number_x = bounds.gutter_right - state.gutter_padding - (#line_number * state.char_advance)
				write_inline_with_font(line_number, math.floor(number_x), row_y, 0, constants.color_text_dim, state.font)
			end
			local entry = state.layout:get_cached_highlight(state.buffer, line_index)
			local highlight = entry.hi
			local render_text = highlight.text
			local column_start = wrap_enabled and segment.start_column or state.scroll_column
			if wrap_enabled and (column_start < segment.start_column or column_start > segment.end_column) then
				column_start = segment.start_column
			end
			local max_column = wrap_enabled and segment.end_column or (state.buffer:get_line_end_offset(line_index) - state.buffer:get_line_start_offset(line_index))
			local column_count = wrap_enabled and math.max(0, max_column - column_start) or slice_width
			local column_to_display = highlight.column_to_display
			local clamped_start_column = math.min(column_start, highlight.column_to_display_len - 1)
			local clamped_end_column = math.min(column_start + column_count, highlight.column_to_display_len - 1)
			local slice_start_display = column_to_display[clamped_start_column]
			local slice_end_display = column_to_display[clamped_end_column]
			draw_highlight_slice(render_text, highlight.colors, entry.advance_prefix, slice_start_display, slice_end_display, text_left_floor, row_y)
		end
	end

	if vertical_visible then
		local track_left = bounds.code_right - constants.scrollbar_width
		local track_right = bounds.code_right
		local track_top = bounds.code_top
		local track_bottom = content_bottom
		put_rectfill(track_left, track_top, track_right, track_bottom, 0, constants.color_scrollbar_track)
		local track_height = math.max(1, track_bottom - track_top)
		local max_scroll = math.max(0, visual_count - row_capacity)
		local thumb_height = math.floor(track_height * (row_capacity / math.max(1, visual_count)))
		thumb_height = math.max(constants.scrollbar_min_thumb_height, thumb_height)
		local thumb_top
		if max_scroll > 0 then
			local range = track_height - thumb_height
			thumb_top = track_top + math.floor(range * (state.scroll_row / max_scroll))
		end
		put_rectfill(track_left, thumb_top, track_right, thumb_top + thumb_height, 0, constants.color_scrollbar_thumb)
	end

	if horizontal_visible then
		local track_left = bounds.code_left
		local track_right = bounds.code_right - (vertical_visible and constants.scrollbar_width or 0)
		local track_top = bounds.code_bottom - constants.scrollbar_width
		local track_bottom = bounds.code_bottom
		put_rectfill(track_left, track_top, track_right, track_bottom, 0, constants.color_scrollbar_track)
		local track_width = math.max(1, track_right - track_left)
		local max_scroll = math.max(0, compute_max_line_length() - column_capacity)
		local thumb_width = math.floor(track_width * (column_capacity / math.max(1, compute_max_line_length())))
		thumb_width = math.max(constants.scrollbar_min_thumb_height, thumb_width)
		local thumb_left
		if max_scroll > 0 then
			local range = track_width - thumb_width
			thumb_left = track_left + math.floor(range * (state.scroll_column / max_scroll))
		end
		put_rectfill(thumb_left, track_top, thumb_left + thumb_width, track_bottom, 0, constants.color_scrollbar_thumb)
	end
end

function editor.init()
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
	state.active_path = get_lua_entry_path()
	local source = get_lua_resource_source(state.active_path)
	state.buffer = piece_tree_buffer.new(source)
	state.layout = code_layout.new(state.font, {
		max_highlight_cache = 512,
		builtin_identifiers = list_lua_builtins(),
	})
end

function editor.update()
end

function editor.draw()
	local width = display_width()
	local height = display_height()
	put_rectfill(0, 0, width, state.header_height, 0, constants.color_top_bar)
	put_rectfill(0, height - state.status_height, width, height, 0, constants.color_status_bar)
	draw_code_area()
end

return editor
