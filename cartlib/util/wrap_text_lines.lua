local wrap_whitespace_chars<const> = { [' '] = true, ['\t'] = true }

local wrap_text_lines<const> = function(text, max_chars, first_prefix, next_prefix)
	local lines<const> = {}
	local line_map<const> = {}
	if #text == 0 then
		return lines, line_map
	end
	local output_prefix = ''
	if first_prefix ~= nil then
		output_prefix = first_prefix
	end
	local next_output_prefix = output_prefix
	if next_prefix ~= nil then
		next_output_prefix = next_prefix
	end
	local output_prefix_length = #output_prefix
	local next_output_prefix_length<const> = #next_output_prefix
	local line_start = 1
	local logical_line_index = 1
	while true do
		local newline_start<const> = string.find(text, '\n', line_start, true)
		local logical_line<const> = newline_start == nil and string.sub(text, line_start) or string.sub(text, line_start, newline_start - 1)
		local line_length<const> = #logical_line
		if line_length == 0 then
			if max_chars - output_prefix_length <= 0 then
				error('wrap_text_lines prefix exceeds max_chars.')
			end
			lines[#lines + 1] = output_prefix
			line_map[#line_map + 1] = logical_line_index
			output_prefix = next_output_prefix
			output_prefix_length = next_output_prefix_length
		else
			local start_index = 1
			while start_index <= line_length do
				local available<const> = max_chars - output_prefix_length
				if available <= 0 then
					error('wrap_text_lines prefix exceeds max_chars.')
				end
				if line_length - start_index + 1 <= available then
					lines[#lines + 1] = output_prefix .. string.sub(logical_line, start_index)
					line_map[#line_map + 1] = logical_line_index
					output_prefix = next_output_prefix
					output_prefix_length = next_output_prefix_length
					break
				end
				local limit<const> = start_index + available - 1
				local break_index = 0
				for index = start_index, limit do
					if wrap_whitespace_chars[string.sub(logical_line, index, index)] then
						break_index = index
					end
				end
				if break_index > start_index then
					local end_index = break_index
					while end_index > start_index and wrap_whitespace_chars[string.sub(logical_line, end_index - 1, end_index - 1)] do
						end_index = end_index - 1
					end
					lines[#lines + 1] = output_prefix .. string.sub(logical_line, start_index, end_index - 1)
					line_map[#line_map + 1] = logical_line_index
					output_prefix = next_output_prefix
					output_prefix_length = next_output_prefix_length
					start_index = break_index + 1
					while start_index <= line_length and wrap_whitespace_chars[string.sub(logical_line, start_index, start_index)] do
						start_index = start_index + 1
					end
				else
					lines[#lines + 1] = output_prefix .. string.sub(logical_line, start_index, limit)
					line_map[#line_map + 1] = logical_line_index
					output_prefix = next_output_prefix
					output_prefix_length = next_output_prefix_length
					start_index = limit + 1
				end
			end
		end
		if newline_start == nil then
			break
		end
		line_start = newline_start + 1
		logical_line_index = logical_line_index + 1
	end
	return lines, line_map
end

return { wrap_text_lines = wrap_text_lines }
