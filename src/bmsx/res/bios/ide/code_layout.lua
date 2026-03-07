-- code_layout.lua

local syntax_highlight = require("syntax_highlight")

local code_layout = {}
code_layout.__index = code_layout
local wrap_break_chars = { [' '] = true, ['\t'] = true, ['-'] = true }

local function clamp(value, min_value, max_value)
	if value < min_value then
		return min_value
	end
	if value > max_value then
		return max_value
	end
	return value
end

function code_layout.new(font, options)
	local self = setmetatable({}, code_layout)
	self.font = font
	self.highlight_cache = {}
	self.highlight_cache_order = {}
	self.highlight_cache_head = 1
	self.highlight_cache_tail = 0
	self.highlight_cache_size = 0
	self.max_highlight_cache = options.max_highlight_cache or 512
	self.visual_lines = {}
	self.visual_count = 0
	self.row_to_first_visual_line = {}
	self.row_visual_line_counts = {}
	self.visual_lines_dirty = true
	self.last_hot_row_range = nil
	self.last_hot_guard_rows = 0
	self.viewport_row_margin = 64
	self.last_viewport_row_estimate = 120
	self.builtin_epoch = 0
	self.builtin_identifiers = options.builtin_identifiers or {}
	self.builtin_lookup = syntax_highlight.apply_builtin_lookup(self.builtin_identifiers)
	local probe_advance = font:advance("M")
	local fallback_advance = font:advance(" ")
	local base = probe_advance > 0 and probe_advance or (fallback_advance > 0 and fallback_advance or 1)
	self.average_char_advance = base
	return self
end

function code_layout:set_builtin_identifiers(ids, epoch)
	if epoch and epoch == self.builtin_epoch then
		return
	end
	self.builtin_epoch = epoch or (self.builtin_epoch + 1)
	self.builtin_identifiers = ids
	self.builtin_lookup = syntax_highlight.apply_builtin_lookup(ids)
	self.highlight_cache = {}
	self.highlight_cache_order = {}
	self.highlight_cache_head = 1
	self.highlight_cache_tail = 0
	self.highlight_cache_size = 0
	self:mark_visual_lines_dirty()
end

function code_layout:mark_visual_lines_dirty()
	self.visual_lines_dirty = true
end

function code_layout:invalidate_line(row)
	self.highlight_cache[row] = nil
end

function code_layout:invalidate_all_highlights()
	self.highlight_cache = {}
	self.highlight_cache_order = {}
	self.highlight_cache_head = 1
	self.highlight_cache_tail = 0
	self.highlight_cache_size = 0
	self:mark_visual_lines_dirty()
end

function code_layout:measure_range_fast(entry, start_display, end_display)
	local length = #entry.hi.text
	if length == 0 then
		return 0
	end
	local clamped_start = clamp(start_display, 0, length)
	local clamped_end = clamp(end_display, clamped_start, length)
	return entry.advance_prefix[clamped_end] - entry.advance_prefix[clamped_start]
end

function code_layout:column_to_display(highlight, column)
	if column <= 0 then
		return 0
	end
	if column >= highlight.column_to_display_len then
		return #highlight.text
	end
	return highlight.column_to_display[column]
end

function code_layout:get_cached_highlight(buffer, row)
	local cached = self.highlight_cache[row]
	local text_version = buffer.version
	if cached and cached.builtin_epoch == self.builtin_epoch then
		if cached.text_version == text_version then
			return cached
		end
		local line_signature = buffer:get_line_signature(row)
		if cached.line_signature == line_signature then
			cached.text_version = text_version
			return cached
		end
	end

	local source = buffer:get_line_content(row)
	local highlight = syntax_highlight.highlight_text_line(source, nil, self.builtin_lookup)
	local display_len = #highlight.text
	local display_to_column = {}
	for i = 0, display_len do
		display_to_column[i] = 0
	end
	for column = 0, #source - 1 do
		local start_display = highlight.column_to_display[column]
		local end_display = highlight.column_to_display[column + 1]
		for display = start_display, end_display - 1 do
			display_to_column[display] = column
		end
	end
	display_to_column[display_len] = #source
	local advance_prefix = {}
	advance_prefix[0] = 0
	for i = 0, display_len - 1 do
		local ch = string.sub(highlight.text, i + 1, i + 1)
		advance_prefix[i + 1] = advance_prefix[i] + self.font:advance(ch)
	end
	local entry = {
		src = source,
		hi = highlight,
		display_to_column = display_to_column,
		advance_prefix = advance_prefix,
		text_version = text_version,
		line_signature = buffer:get_line_signature(row),
		builtin_epoch = self.builtin_epoch,
		row_signature = 0,
	}
	self.highlight_cache[row] = entry
	self.highlight_cache_tail = self.highlight_cache_tail + 1
	self.highlight_cache_order[self.highlight_cache_tail] = row
	self.highlight_cache_size = self.highlight_cache_size + 1
	while self.highlight_cache_size > self.max_highlight_cache do
		local key = self.highlight_cache_order[self.highlight_cache_head]
		self.highlight_cache_order[self.highlight_cache_head] = nil
		self.highlight_cache_head = self.highlight_cache_head + 1
		self.highlight_cache_size = self.highlight_cache_size - 1
		self.highlight_cache[key] = nil
	end
	return entry
end

function code_layout:ensure_visual_lines(context)
	local visible_rows = math.max(1, context.estimated_visible_row_count or self.last_viewport_row_estimate)
	self.last_viewport_row_estimate = visible_rows
	if not self.visual_lines_dirty and not self:viewport_within_hot_window(context.scroll_row, visible_rows) then
		self.visual_lines_dirty = true
	end
	if self.visual_lines_dirty then
		self:rebuild_visual_lines(context.buffer, context.word_wrap_enabled, context.compute_wrap_width(), context.scroll_row, visible_rows)
		self.visual_lines_dirty = false
	end
	return self:clamp_scroll_row(context.scroll_row)
end

function code_layout:get_visual_line_count()
	return self.visual_count
end

function code_layout:visual_index_to_segment(index)
	if index < 0 or index >= self.visual_count then
		return nil
	end
	return self.visual_lines[index + 1]
end

function code_layout:position_to_visual_index(buffer, row, column)
	if self.visual_count == 0 then
		return 0
	end
	local safe_row = clamp(row, 0, buffer:get_line_count() - 1)
	local base_index = self.row_to_first_visual_line[safe_row] or 0
	local index = base_index
	while index < self.visual_count do
		local segment = self:visual_index_to_segment(index)
		if not segment or segment.row ~= safe_row then
			break
		end
		if column < segment.end_column or segment.start_column == segment.end_column then
			return index
		end
		index = index + 1
	end
	return math.min(self.visual_count - 1, index - 1)
end

function code_layout:clamp_scroll_row(scroll_row)
	local max_scroll = math.max(0, self.visual_count - 1)
	return clamp(scroll_row, 0, max_scroll)
end

function code_layout:rebuild_visual_lines(buffer, word_wrap_enabled, wrap_width, scroll_row, visible_row_estimate)
	local line_count = buffer:get_line_count()
	if line_count == 0 then
		self.visual_lines = { { row = 0, start_column = 0, end_column = 0 } }
		self.visual_count = 1
		self.row_to_first_visual_line = { [0] = 0 }
		self.row_visual_line_counts = { [0] = 1 }
		self.last_hot_row_range = nil
		self.last_hot_guard_rows = 0
		return
	end
	local needs_full = self.visual_count == 0
		or (self.row_to_first_visual_line_len and self.row_to_first_visual_line_len ~= line_count)
		or (self.row_visual_line_counts_len and self.row_visual_line_counts_len ~= line_count)
	if needs_full then
		self:rebuild_all_visual_lines(buffer, word_wrap_enabled, wrap_width)
		self.last_hot_row_range = { start = 0, ["end"] = line_count - 1 }
		self.last_hot_guard_rows = math.max(8, math.floor(visible_row_estimate / 2))
		return
	end
	local hot_rows = self:compute_hot_row_window(line_count, scroll_row, visible_row_estimate)
	self:rebuild_row_range(buffer, word_wrap_enabled, wrap_width, hot_rows.start, hot_rows["end"])
	self.last_hot_row_range = hot_rows
	self.last_hot_guard_rows = math.max(8, math.floor(visible_row_estimate / 2))
end

function code_layout:rebuild_all_visual_lines(buffer, word_wrap_enabled, wrap_width)
	local line_count = buffer:get_line_count()
	local segments = {}
	local visual_count = 0
	local row_index_lookup = {}
	local counts = {}
	local effective_wrap = word_wrap_enabled and wrap_width or math.huge
	local approx_wrap_columns = (not word_wrap_enabled or wrap_width == math.huge)
		and math.huge
		or math.max(1, math.floor(wrap_width / math.max(1, self.average_char_advance)))
	for row = 0, line_count - 1 do
		row_index_lookup[row] = visual_count
		local entry = self:get_cached_highlight(buffer, row)
		local row_segments, seg_count = self:build_segments_for_row(entry.src, row, entry, word_wrap_enabled, effective_wrap, approx_wrap_columns)
		for i = 1, seg_count do
			segments[visual_count + 1] = row_segments[i]
			visual_count = visual_count + 1
		end
		counts[row] = seg_count
	end
	if visual_count == 0 then
		segments[1] = { row = 0, start_column = 0, end_column = 0 }
		visual_count = 1
	end
	self.visual_lines = segments
	self.visual_count = visual_count
	self.row_to_first_visual_line = row_index_lookup
	self.row_to_first_visual_line_len = line_count
	self.row_visual_line_counts = counts
	self.row_visual_line_counts_len = line_count
end

function code_layout:splice_visual_lines(start_index, delete_count, insert_segments, insert_count)
	local visual_lines = self.visual_lines
	local visual_count = self.visual_count
	local start_pos = start_index + 1
	local tail_start = start_pos + delete_count
	local tail_end = visual_count
	local delta = insert_count - delete_count
	if delta > 0 then
		table.move(visual_lines, tail_start, tail_end, tail_start + delta, visual_lines)
	elseif delta < 0 then
		table.move(visual_lines, tail_start, tail_end, tail_start + delta, visual_lines)
		for i = visual_count, visual_count + delta + 1, -1 do
			visual_lines[i] = nil
		end
	end
	for i = 1, insert_count do
		visual_lines[start_pos + i - 1] = insert_segments[i]
	end
	self.visual_count = visual_count + delta
end

function code_layout:rebuild_row_range(buffer, word_wrap_enabled, wrap_width, start_row, end_row)
	if start_row > end_row then
		return
	end
	local line_count = buffer:get_line_count()
	local effective_wrap = word_wrap_enabled and wrap_width or math.huge
	local approx_wrap_columns = (not word_wrap_enabled or wrap_width == math.huge)
		and math.huge
		or math.max(1, math.floor(wrap_width / math.max(1, self.average_char_advance)))
	for row = start_row, end_row do
		local start_index = self.row_to_first_visual_line[row]
		local old_count = self.row_visual_line_counts[row] or 0
		local entry = self:get_cached_highlight(buffer, row)
		local row_segments, seg_count = self:build_segments_for_row(entry.src, row, entry, word_wrap_enabled, effective_wrap, approx_wrap_columns)
		self:splice_visual_lines(start_index, old_count, row_segments, seg_count)
		self.row_visual_line_counts[row] = seg_count
		self.row_to_first_visual_line[row] = start_index
		local delta = seg_count - old_count
		if delta ~= 0 then
			for adjust = row + 1, line_count - 1 do
				self.row_to_first_visual_line[adjust] = (self.row_to_first_visual_line[adjust] or 0) + delta
			end
		end
	end
end

function code_layout:find_wrap_break(line, entry, start_column, wrap_width)
	if wrap_width == math.huge then
		return #line
	end
	local column = start_column + 1
	local last_break = start_column
	local last_break_end = start_column + 1
	local length = #line
	while column <= length do
		local width = self:measure_columns(entry, start_column, column)
		if width > wrap_width then
			if last_break > start_column then
				return last_break_end
			end
			return column - 1
		end
		if column < length then
			local ch = string.sub(line, column + 1, column + 1)
				if wrap_break_chars[ch] then
					last_break = column
					local skip = column + 1
				while skip < length and string.sub(line, skip + 1, skip + 1) == " " do
					skip = skip + 1
				end
				last_break_end = skip
			end
		end
		column = column + 1
	end
	return length
end

function code_layout:measure_columns(entry, start_column, end_column)
	local highlight = entry.hi
	local start_display = self:column_to_display(highlight, start_column)
	local end_display = self:column_to_display(highlight, end_column)
	return self:measure_range_fast(entry, start_display, end_display)
end

function code_layout:find_approximate_wrap_break(line_length, start_column, approx_columns)
	if approx_columns == math.huge then
		return line_length
	end
	return math.min(line_length, start_column + approx_columns)
end

function code_layout:build_segments_for_row(line, row, entry, word_wrap_enabled, effective_wrap_width, approx_wrap_columns)
	if #line == 0 then
		return { { row = row, start_column = 0, end_column = 0 } }, 1
	end
	local segments = {}
	local seg_count = 0
	local length = #line
	local column = 0
	while column < length do
		local next_break = word_wrap_enabled
			and self:find_wrap_break(line, entry, column, effective_wrap_width)
			or self:find_approximate_wrap_break(length, column, approx_wrap_columns)
		local end_column = math.max(column + 1, math.min(length, next_break))
		seg_count = seg_count + 1
		segments[seg_count] = { row = row, start_column = column, end_column = end_column }
		column = end_column
	end
	return segments, seg_count
end

function code_layout:compute_hot_row_window(line_count, scroll_row, visible_rows)
	if line_count == 0 then
		return { start = 0, ["end"] = -1 }
	end
	local start_row
	local end_row
	local total_visual = self.visual_count
	if total_visual > 0 then
		local start_segment = self:visual_index_to_segment(clamp(scroll_row, 0, total_visual - 1))
		local end_segment = self:visual_index_to_segment(clamp(scroll_row + math.max(1, visible_rows), 0, total_visual - 1))
		if start_segment then
			start_row = start_segment.row
		end
		if end_segment then
			end_row = end_segment.row
		end
	end
	if start_row == nil then
		start_row = 0
	end
	if end_row == nil then
		end_row = line_count - 1
	end
	local margin = math.max(self.viewport_row_margin, visible_rows * 2)
	start_row = clamp(start_row - margin, 0, line_count - 1)
	end_row = clamp(end_row + margin, 0, line_count - 1)
	return { start = start_row, ["end"] = end_row }
end

function code_layout:viewport_within_hot_window(scroll_row, visible_rows)
	local hot = self.last_hot_row_range
	if not hot or self.visual_count == 0 then
		return false
	end
	local start_segment = self:visual_index_to_segment(clamp(scroll_row, 0, self.visual_count - 1))
	if not start_segment then
		return false
	end
	local end_visual = clamp(scroll_row + math.max(1, visible_rows) - 1, 0, self.visual_count - 1)
	local end_segment = self:visual_index_to_segment(end_visual) or start_segment
	local viewport_start_row = math.min(start_segment.row, end_segment.row)
	local viewport_end_row = math.max(start_segment.row, end_segment.row)
	local max_row = (self.row_to_first_visual_line_len or 1) - 1
	local guard_start = hot.start == 0 and 0 or self.last_hot_guard_rows
	local guard_end = hot["end"] >= max_row and 0 or self.last_hot_guard_rows
	local guarded_start = math.max(0, hot.start + guard_start)
	local guarded_end = math.max(guarded_start, hot["end"] - guard_end)
	if viewport_start_row < guarded_start then
		return false
	end
	if viewport_end_row > guarded_end then
		return false
	end
	return true
end

return code_layout
