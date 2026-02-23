-- syntax_highlight.lua

local constants = require("ide_constants")

local keywords = {
	["and"] = true,
	["break"] = true,
	["do"] = true,
	["else"] = true,
	["elseif"] = true,
	["end"] = true,
	["false"] = true,
	["for"] = true,
	["function"] = true,
	["goto"] = true,
	["if"] = true,
	["in"] = true,
	["local"] = true,
	["nil"] = true,
	["not"] = true,
	["or"] = true,
	["repeat"] = true,
	["return"] = true,
	["then"] = true,
	["true"] = true,
	["until"] = true,
	["while"] = true,
}

local multi_char_operators = {
	["=="] = true,
	["~="] = true,
	["<="] = true,
	[">="] = true,
	[".."] = true,
	["//"] = true,
	["<<"] = true,
	[">>"] = true,
}

local operator_chars = {
	["+"] = true,
	["-"] = true,
	["*"] = true,
	["/"] = true,
	["%"] = true,
	["<"] = true,
	[">"] = true,
	["="] = true,
	["#"] = true,
	["("] = true,
	[")"] = true,
	["{"] = true,
	["}"] = true,
	["["] = true,
	["]"] = true,
	[":"] = true,
	[","] = true,
	["."] = true,
	[";"] = true,
	["&"] = true,
	["|"] = true,
	["~"] = true,
	["^"] = true,
}

local identifier_path_separators = {
	["."] = true,
	[":"] = true,
}

local string_delimiters = {
	['"'] = true,
	["'"] = true,
}

local comment_annotations = { "TODO", "FIXME", "BUG", "HACK", "NOTE", "WARNING" }

local function byte_at(line, index)
	return string.byte(line, index + 1)
end

local function char_at(line, index)
	return string.sub(line, index + 1, index + 1)
end

local function slice(line, start_index, end_index)
	return string.sub(line, start_index + 1, end_index)
end

local function starts_with(line, index, prefix)
	return slice(line, index, index + #prefix) == prefix
end

local function is_digit_code(code)
	return code and code >= 48 and code <= 57
end

local function is_hex_digit_code(code)
	if not code then
		return false
	end
	return (code >= 48 and code <= 57) or (code >= 65 and code <= 70) or (code >= 97 and code <= 102)
end

local function is_identifier_start_code(code)
	return code and ((code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 95)
end

local function is_identifier_part_code(code)
	return is_identifier_start_code(code) or (code and code >= 48 and code <= 57)
end

local function is_operator_char(ch)
	return operator_chars[ch] ~= nil
end

local function is_number_start(line, index)
	local ch = byte_at(line, index)
	if is_digit_code(ch) then
		return true
	end
	if ch == 46 then
		local next_code = byte_at(line, index + 1)
		return is_digit_code(next_code)
	end
	return false
end

local function read_number(line, start_index, length)
	local index = start_index
	if starts_with(line, index, "0x") or starts_with(line, index, "0X") then
		index = index + 2
		while index < length and is_hex_digit_code(byte_at(line, index)) do
			index = index + 1
		end
		if index < length and byte_at(line, index) == 46 then
			index = index + 1
			while index < length and is_hex_digit_code(byte_at(line, index)) do
				index = index + 1
			end
		end
		if index < length then
			local code = byte_at(line, index)
			if code == 112 or code == 80 then
				index = index + 1
				if index < length then
					local sign = byte_at(line, index)
					if sign == 43 or sign == 45 then
						index = index + 1
					end
				end
				while index < length and is_digit_code(byte_at(line, index)) do
					index = index + 1
				end
			end
		end
		return index
	end
	while index < length and is_digit_code(byte_at(line, index)) do
		index = index + 1
	end
	if index < length and byte_at(line, index) == 46 then
		index = index + 1
		while index < length and is_digit_code(byte_at(line, index)) do
			index = index + 1
		end
	end
	if index < length then
		local code = byte_at(line, index)
		if code == 101 or code == 69 then
			index = index + 1
			if index < length then
				local sign = byte_at(line, index)
				if sign == 43 or sign == 45 then
					index = index + 1
				end
			end
			while index < length and is_digit_code(byte_at(line, index)) do
				index = index + 1
			end
		end
	end
	return index
end

local function read_identifier(line, start_index, length)
	local index = start_index
	while index < length and is_identifier_part_code(byte_at(line, index)) do
		index = index + 1
	end
	return index
end

local function skip_whitespace(line, start_index, length)
	local index = start_index
	while index < length do
		local code = byte_at(line, index)
		if code ~= 32 and code ~= 9 then
			break
		end
		index = index + 1
	end
	return index
end

local function long_bracket_level_at(line, index, length)
	if byte_at(line, index) ~= 91 then
		return -1
	end
	local level = 0
	local cursor = index + 1
	while cursor < length and byte_at(line, cursor) == 61 do
		level = level + 1
		cursor = cursor + 1
	end
	if cursor < length and byte_at(line, cursor) == 91 then
		return level
	end
	return -1
end

local function long_bracket_close_length_at(line, index, level, length)
	if byte_at(line, index) ~= 93 then
		return 0
	end
	local cursor = index + 1
	for _ = 1, level do
		if cursor >= length or byte_at(line, cursor) ~= 61 then
			return 0
		end
		cursor = cursor + 1
	end
	if cursor < length and byte_at(line, cursor) == 93 then
		return level + 2
	end
	return 0
end

local function highlight_comment_annotations(line, start_index, end_index, column_colors)
	local upper = string.upper(line)
	for i = 1, #comment_annotations do
		local annotation = comment_annotations[i]
		local search_start = start_index
		while true do
			local found = string.find(upper, annotation, search_start + 1, true)
			if not found then
				break
			end
			local match_index = found - 1
			if match_index >= end_index then
				break
			end
			local limit = math.min(end_index, match_index + #annotation)
			for column = match_index, limit - 1 do
				column_colors[column] = constants.color_syntax.keyword
			end
			search_start = match_index + #annotation
		end
	end
end

local function highlight_comment(line, start_index, length, column_colors)
	if starts_with(line, start_index, "--[") then
		local open_level = long_bracket_level_at(line, start_index + 2, length)
		if open_level >= 0 then
			local close_index = start_index + 2 + open_level + 2
			local end_index
			while close_index < length do
				local close_len = long_bracket_close_length_at(line, close_index, open_level, length)
				if close_len > 0 then
					end_index = close_index + close_len
					break
				end
				close_index = close_index + 1
			end
			if not end_index then
				end_index = length
			end
			for column = start_index, end_index - 1 do
				column_colors[column] = constants.color_syntax.comment
			end
			highlight_comment_annotations(line, start_index, end_index, column_colors)
			return end_index
		end
	end
	for column = start_index, length - 1 do
		column_colors[column] = constants.color_syntax.comment
	end
	highlight_comment_annotations(line, start_index, length, column_colors)
	return length
end

local function read_identifier_path(line, start_index, length)
	local segments = {}
	local delimiters = {}
	local seg_count = 0
	local delim_count = 0
	local index = start_index
	while index < length and is_identifier_start_code(byte_at(line, index)) do
		local segment_start = index
		index = read_identifier(line, index, length)
		seg_count = seg_count + 1
		segments[seg_count] = { start = segment_start, ["end"] = index }
		if index >= length then
			break
		end
			local separator = char_at(line, index)
			if (identifier_path_separators[separator] ~= nil) and index + 1 < length and is_identifier_start_code(byte_at(line, index + 1)) then
			delim_count = delim_count + 1
			delimiters[delim_count] = index
			index = index + 1
		else
			break
		end
	end
	return { segments = segments, segment_count = seg_count, delimiters = delimiters, delimiter_count = delim_count, ["end"] = index }
end

local function highlight_scoped_label(line, start_index, length, column_colors)
	if not starts_with(line, start_index, "::") then
		return start_index
	end
	local index = skip_whitespace(line, start_index + 2, length)
	if index >= length or not is_identifier_start_code(byte_at(line, index)) then
		return start_index
	end
	local label_end = read_identifier(line, index, length)
	index = skip_whitespace(line, label_end, length)
	if not starts_with(line, index, "::") then
		return start_index
	end
	local end_index = index + 2
	for column = start_index, end_index - 1 do
		column_colors[column] = constants.color_syntax.label
	end
	return end_index
end

local function highlight_function_name_path(line, start_index, length, column_colors)
	local index = start_index
	local segments = {}
	local seg_count = 0
	while index < length and is_identifier_start_code(byte_at(line, index)) do
		local segment_start = index
		index = read_identifier(line, index, length)
		seg_count = seg_count + 1
		segments[seg_count] = { start = segment_start, ["end"] = index }
		if index < length then
			local separator = char_at(line, index)
				if identifier_path_separators[separator] ~= nil then
				column_colors[index] = constants.color_syntax.operator
				index = index + 1
			else
				break
			end
		end
	end
	for i = 1, seg_count do
		local segment = segments[i]
		for column = segment.start, segment["end"] - 1 do
			column_colors[column] = constants.color_syntax.function_name
		end
	end
	return index
end

local function highlight_parameter_list(line, open_paren_index, length, column_colors)
	column_colors[open_paren_index] = constants.color_syntax.operator
	local index = open_paren_index + 1
	while index < length do
		index = skip_whitespace(line, index, length)
		if index >= length then
			break
		end
		local ch = char_at(line, index)
		if ch == ")" then
			column_colors[index] = constants.color_syntax.operator
			return index + 1
		end
		if index + 3 <= length and slice(line, index, index + 3) == "..." then
			column_colors[index] = constants.color_syntax.parameter
			column_colors[index + 1] = constants.color_syntax.parameter
			column_colors[index + 2] = constants.color_syntax.parameter
			index = index + 3
		elseif is_identifier_start_code(byte_at(line, index)) then
			local end_index = read_identifier(line, index, length)
			for column = index, end_index - 1 do
				column_colors[column] = constants.color_syntax.parameter
			end
			index = end_index
		else
			column_colors[index] = constants.color_syntax.operator
			index = index + 1
		end
	end
	return length
end

local function highlight_function_signature(line, start_index, length, column_colors)
	local index = skip_whitespace(line, start_index, length)
	index = highlight_function_name_path(line, index, length, column_colors)
	index = skip_whitespace(line, index, length)
	if index < length and char_at(line, index) == "(" then
		return highlight_parameter_list(line, index, length, column_colors)
	end
	return index
end

local function highlight_goto_label(line, start_index, length, column_colors)
	local index = skip_whitespace(line, start_index, length)
	if index >= length or not is_identifier_start_code(byte_at(line, index)) then
		return index
	end
	local label_end = read_identifier(line, index, length)
	for column = index, label_end - 1 do
		column_colors[column] = constants.color_syntax.label
	end
	return label_end
end

local function highlight_builtin_identifier_path(line, path, builtin_lookup, column_colors)
	local names = {}
	for i = 1, path.segment_count do
		local segment = path.segments[i]
		names[i] = slice(line, segment.start, segment["end"])
	end
	for length = path.segment_count, 1, -1 do
		local candidate = table.concat(names, ".", 1, length)
		if builtin_lookup[candidate] then
			for seg_index = 1, length do
				local segment = path.segments[seg_index]
				for column = segment.start, segment["end"] - 1 do
					column_colors[column] = constants.color_syntax.builtin
				end
				if seg_index < length then
					local delimiter_column = path.delimiters[seg_index]
					column_colors[delimiter_column] = constants.color_syntax.operator
				end
			end
			return path.segments[length]["end"]
		end
	end
	if path.segment_count > 1 and builtin_lookup[names[1]] then
		for seg_index = 1, path.segment_count do
			local segment = path.segments[seg_index]
			for column = segment.start, segment["end"] - 1 do
				column_colors[column] = constants.color_syntax.builtin
			end
			if seg_index <= path.delimiter_count then
				column_colors[path.delimiters[seg_index]] = constants.color_syntax.operator
			end
		end
		return path.segments[path.segment_count]["end"]
	end
	return nil
end

local function apply_builtin_lookup(names)
	local lookup = {}
	for _, name in pairs(names) do
		if type(name) == "string" then
			lookup[string.lower(name)] = true
		end
	end
	return lookup
end

local function build_column_colors(length, color)
	local colors = {}
	for i = 0, length - 1 do
		colors[i] = color
	end
	return colors
end

local function highlight_text_line(line, builtin_lookup)
	local length = #line
	local column_colors = build_column_colors(length, constants.color_syntax.code_text)
	local i = 0
	while i < length do
		if i == 0 and starts_with(line, i, "#!") then
			for column = 0, length - 1 do
				column_colors[column] = constants.color_syntax.comment
			end
			break
		end
		if starts_with(line, i, "--") then
			i = highlight_comment(line, i, length, column_colors)
		else
			local label_end = highlight_scoped_label(line, i, length, column_colors)
			if label_end > i then
				i = label_end
			else
				local open_level = long_bracket_level_at(line, i, length)
				if open_level >= 0 then
					local close_index = i + open_level + 2
					local end_index
					while close_index < length do
						local close_len = long_bracket_close_length_at(line, close_index, open_level, length)
						if close_len > 0 then
							end_index = close_index + close_len
							break
						end
						close_index = close_index + 1
					end
					if not end_index then
						end_index = length
					end
					for column = i, end_index - 1 do
						column_colors[column] = constants.color_syntax.string
					end
					i = end_index
				else
					local ch = char_at(line, i)
						if string_delimiters[ch] ~= nil then
						local delimiter = ch
						column_colors[i] = constants.color_syntax.string
						i = i + 1
						while i < length do
							local current = char_at(line, i)
							column_colors[i] = constants.color_syntax.string
							if current == "\\" and i + 1 < length then
								column_colors[i + 1] = constants.color_syntax.string
								i = i + 2
							elseif current == delimiter then
								i = i + 1
								break
							else
								i = i + 1
							end
						end
					elseif i + 3 <= length and slice(line, i, i + 3) == "..." then
						column_colors[i] = constants.color_syntax.operator
						column_colors[i + 1] = constants.color_syntax.operator
						column_colors[i + 2] = constants.color_syntax.operator
						i = i + 3
					else
						local pair = i + 2 <= length and slice(line, i, i + 2)
						if pair and multi_char_operators[pair] then
							column_colors[i] = constants.color_syntax.operator
							column_colors[i + 1] = constants.color_syntax.operator
							i = i + 2
						elseif is_number_start(line, i) then
							local end_index = read_number(line, i, length)
							for column = i, end_index - 1 do
								column_colors[column] = constants.color_syntax.number
							end
							i = end_index
						elseif is_identifier_start_code(byte_at(line, i)) then
							local path = read_identifier_path(line, i, length)
							local first = path.segments[1]
							local word = slice(line, first.start, first["end"])
							local lower_word = string.lower(word)
							if keywords[lower_word] then
								for column = first.start, first["end"] - 1 do
									column_colors[column] = constants.color_syntax.keyword
								end
							end
							local builtin_end = highlight_builtin_identifier_path(line, path, builtin_lookup, column_colors)
							if builtin_end then
								i = builtin_end
							elseif lower_word == "function" then
								i = highlight_function_signature(line, first["end"], length, column_colors)
							elseif lower_word == "goto" then
								i = highlight_goto_label(line, first["end"], length, column_colors)
							elseif lower_word == "::" then
								i = highlight_scoped_label(line, first["end"], length, column_colors)
							else
								i = first["end"]
							end
						elseif is_operator_char(ch) then
							column_colors[i] = constants.color_syntax.operator
							i = i + 1
						else
							i = i + 1
						end
					end
				end
			end
		end
	end

	local colors = {}
	local column_to_display = {}
	local text_parts = {}
	local display_index = 0
	for column = 0, length - 1 do
		column_to_display[column] = display_index
		local ch = char_at(line, column)
		local color = column_colors[column]
		if ch == "\t" then
			text_parts[#text_parts + 1] = string.rep(" ", constants.tab_spaces)
			for _ = 1, constants.tab_spaces do
				colors[display_index] = color
				display_index = display_index + 1
			end
		else
			text_parts[#text_parts + 1] = ch
			colors[display_index] = color
			display_index = display_index + 1
		end
	end
	column_to_display[length] = display_index
	local text = table.concat(text_parts)
	local upper_text
	for index = 0, display_index - 1 do
		if colors[index] ~= constants.color_syntax.string then
			local ch = string.sub(text, index + 1, index + 1)
			local upper = string.upper(ch)
			if upper ~= ch then
				local buffer = {}
				for idx = 0, display_index - 1 do
					local current = string.sub(text, idx + 1, idx + 1)
					if colors[idx] == constants.color_syntax.string then
						buffer[#buffer + 1] = current
					else
						buffer[#buffer + 1] = string.upper(current)
					end
				end
				upper_text = table.concat(buffer)
				break
			end
		end
	end
	if not upper_text then
		upper_text = text
	end

	return {
		text = text,
		upper_text = upper_text,
		colors = colors,
		column_to_display = column_to_display,
		column_to_display_len = length + 1,
	}
end

return {
	apply_builtin_lookup = apply_builtin_lookup,
	highlight_text_line = highlight_text_line,
}
