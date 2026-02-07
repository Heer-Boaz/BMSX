-- textflow.lua
-- shared text wrapping and tail-scrolling helpers for BIOS screens

local textflow = {}

function textflow.line_slots(width, left, font_width, min_slots)
	local available = width - (left * 2)
	local slots = math.floor(available / font_width)
	local minimum = min_slots or 8
	if slots < minimum then
		slots = minimum
	end
	return slots
end

function textflow.wrap_prefixed(text, line_slots, first_prefix, next_prefix)
	local lines = {}
	local remaining = tostring(text)
	local prefix = first_prefix or ''
	local first_limit = line_slots - #prefix
	local next = next_prefix or prefix
	local next_limit = line_slots - #next
	local limit = first_limit
	if limit < 1 then
		limit = 1
	end
	if next_limit < 1 then
		next_limit = 1
	end
	while #remaining > limit do
		local chunk = string.sub(remaining, 1, limit)
		local split = string.match(chunk, '.*()%s+')
		if split and split >= math.floor(limit * 0.5) then
			lines[#lines + 1] = prefix .. string.sub(remaining, 1, split - 1)
			remaining = string.gsub(string.sub(remaining, split + 1), '^%s+', '')
		else
			lines[#lines + 1] = prefix .. chunk
			remaining = string.gsub(string.sub(remaining, limit + 1), '^%s+', '')
		end
		prefix = next
		limit = next_limit
	end
	lines[#lines + 1] = prefix .. remaining
	return lines
end

function textflow.wrap_entries(entries, line_slots, first_prefix, next_prefix)
	local lines = {}
	local first = first_prefix or ''
	local next = next_prefix or first
	for i = 1, #entries do
		local wrapped = textflow.wrap_prefixed(entries[i], line_slots, first, next)
		for j = 1, #wrapped do
			lines[#lines + 1] = wrapped[j]
		end
	end
	return lines
end

function textflow.window_size(height, top, line_height, reserved_lines, min_lines)
	local total_lines = math.floor((height - top) / line_height)
	local window_size = total_lines - (reserved_lines or 0)
	local minimum = min_lines or 1
	if window_size < minimum then
		window_size = minimum
	end
	return window_size
end

function textflow.max_scroll(line_count, window_size)
	return math.max(0, line_count - window_size)
end

function textflow.new_scroll_state()
	return {
		top = 0,
		last_line_count = 0,
	}
end

function textflow.reset_scroll_state(state)
	state.top = 0
	state.last_line_count = 0
end

function textflow.clamp_scroll(scroll_top, line_count, window_size)
	if scroll_top < 0 then
		return 0
	end
	local max_scroll = textflow.max_scroll(line_count, window_size)
	if scroll_top > max_scroll then
		return max_scroll
	end
	return scroll_top
end

function textflow.scroll_window(lines, scroll_top, window_size)
	local line_count = #lines
	local clamped_scroll = textflow.clamp_scroll(scroll_top, line_count, window_size)
	local first = clamped_scroll + 1
	local last = math.min(first + window_size - 1, line_count)
	local out = {}
	for i = first, last do
		out[#out + 1] = lines[i]
	end
	return clamped_scroll, textflow.max_scroll(line_count, window_size), out
end

function textflow.update_scroll_state(state, line_count, window_size, delta)
	if line_count ~= state.last_line_count then
		state.last_line_count = line_count
		state.top = textflow.max_scroll(line_count, window_size)
	end
	local step = delta or 0
	state.top = textflow.clamp_scroll(state.top + step, line_count, window_size)
	return state.top, textflow.max_scroll(line_count, window_size)
end

function textflow.scroll_window_state(lines, state, window_size)
	local top, max_scroll, out = textflow.scroll_window(lines, state.top, window_size)
	state.top = top
	return top, max_scroll, out
end

function textflow.visible_tail(lines, max_lines)
	if max_lines <= 0 then
		return {}
	end
	local count = #lines
	if count <= max_lines then
		return lines
	end
	local first = count - max_lines + 1
	local out = {}
	for i = first, count do
		out[#out + 1] = lines[i]
	end
	return out
end

function textflow.wrap_tail(text, line_slots, max_lines, first_prefix, next_prefix)
	local wrapped = textflow.wrap_prefixed(text, line_slots, first_prefix, next_prefix)
	return textflow.visible_tail(wrapped, max_lines)
end

function textflow.draw_lines(lines, x, y, color, line_height)
	local step = line_height or 8
	for i = 1, #lines do
		write(lines[i], x, y, 0, color)
		y = y + step
	end
	return y
end

function textflow.draw_wrapped_tail(text, x, y, color, line_height, line_slots, max_lines, first_prefix, next_prefix)
	local lines = textflow.wrap_tail(text, line_slots, max_lines, first_prefix, next_prefix)
	return textflow.draw_lines(lines, x, y, color, line_height)
end

return textflow
