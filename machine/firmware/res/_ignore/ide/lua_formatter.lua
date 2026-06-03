-- formatter.lua

local formatter = {}

local opening_tokens = {
	["function"] = true,
	["do"] = true,
	["then"] = true,
	["repeat"] = true,
	["else"] = true,
	["left_brace"] = true,
}

local closing_tokens = {
	["end"] = true,
	["until"] = true,
	["else"] = true,
	["elseif"] = true,
	["right_brace"] = true,
}

local tracked_keywords = {
	["function"] = true,
	["do"] = true,
	["then"] = true,
	["repeat"] = true,
	["else"] = true,
	["elseif"] = true,
	["end"] = true,
	["until"] = true,
}

local function trim_leading_whitespace(line)
	return string.gsub(line, "^%s+", "")
end

local function repeat_indent(count)
	if count <= 0 then
		return ""
	end
	return string.rep("\t", count)
end

local function is_identifier_start_code(code)
	return code and ((code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 95)
end

local function is_identifier_part_code(code)
	return is_identifier_start_code(code) or (code and code >= 48 and code <= 57)
end

local function starts_with(source, index, prefix)
	return string.sub(source, index, index + #prefix - 1) == prefix
end

local function split_source_lines(source)
	local lines = {}
	local start_index = 1
	local write_index = 1
	local index = 1
	local length = #source
	while index <= length do
		local code = string.byte(source, index)
		if code == 13 then
			lines[write_index] = string.sub(source, start_index, index - 1)
			write_index = write_index + 1
			if index < length and string.byte(source, index + 1) == 10 then
				index = index + 1
			end
			start_index = index + 1
		elseif code == 10 then
			lines[write_index] = string.sub(source, start_index, index - 1)
			write_index = write_index + 1
			start_index = index + 1
		end
		index = index + 1
	end
	lines[write_index] = string.sub(source, start_index, length)
	return lines
end

local function long_bracket_level_at(source, index, length)
	if string.byte(source, index) ~= 91 then
		return -1
	end
	local level = 0
	local cursor = index + 1
	while cursor <= length and string.byte(source, cursor) == 61 do
		level = level + 1
		cursor = cursor + 1
	end
	if cursor <= length and string.byte(source, cursor) == 91 then
		return level
	end
	return -1
end

local function long_bracket_close_length_at(source, index, level, length)
	if string.byte(source, index) ~= 93 then
		return 0
	end
	local cursor = index + 1
	for _ = 1, level do
		if cursor > length or string.byte(source, cursor) ~= 61 then
			return 0
		end
		cursor = cursor + 1
	end
	if cursor <= length and string.byte(source, cursor) == 93 then
		return level + 2
	end
	return 0
end

local function advance_newline(source, index, length, line, line_start)
	local code = string.byte(source, index)
	if code == 13 and index < length and string.byte(source, index + 1) == 10 then
		index = index + 2
	else
		index = index + 1
	end
	return index, line + 1, index
end

local function consume_span(source, index, end_index_exclusive, line, line_start)
	while index < end_index_exclusive do
		local code = string.byte(source, index)
		if code == 10 or code == 13 then
			index, line, line_start = advance_newline(source, index, #source, line, line_start)
		else
			index = index + 1
		end
	end
	return index, line, line_start
end

local function read_identifier(source, index, length)
	local cursor = index
	while cursor <= length and is_identifier_part_code(string.byte(source, cursor)) do
		cursor = cursor + 1
	end
	return cursor
end

function formatter.scan_tokens(source)
	local tokens = {}
	local length = #source
	local index = 1
	local line = 1
	local line_start = 1
	while index <= length do
		local code = string.byte(source, index)
		if code == 10 or code == 13 then
			index, line, line_start = advance_newline(source, index, length, line, line_start)
		elseif starts_with(source, index, "--") then
			local comment_start_line = line
			local comment_start_column = index - line_start + 1
			local open_level = long_bracket_level_at(source, index + 2, length)
			if open_level >= 0 then
				local close_index = index + 2 + open_level + 2
				local end_index_exclusive = length + 1
				while close_index <= length do
					local close_len = long_bracket_close_length_at(source, close_index, open_level, length)
					if close_len > 0 then
						end_index_exclusive = close_index + close_len
						break
					end
					close_index = close_index + 1
				end
				tokens[#tokens + 1] = {
					type = "comment_block",
					line = comment_start_line,
					column = comment_start_column,
					lexeme = string.sub(source, index, end_index_exclusive - 1),
				}
				index, line, line_start = consume_span(source, index, end_index_exclusive, line, line_start)
			else
				index = index + 2
				while index <= length do
					local current = string.byte(source, index)
					if current == 10 or current == 13 then
						break
					end
					index = index + 1
				end
			end
		elseif long_bracket_level_at(source, index, length) >= 0 then
			local token_line = line
			local token_column = index - line_start + 1
			local open_level = long_bracket_level_at(source, index, length)
			local close_index = index + open_level + 2
			local end_index_exclusive = length + 1
			while close_index <= length do
				local close_len = long_bracket_close_length_at(source, close_index, open_level, length)
				if close_len > 0 then
					end_index_exclusive = close_index + close_len
					break
				end
				close_index = close_index + 1
			end
			tokens[#tokens + 1] = {
				type = "string",
				line = token_line,
				column = token_column,
				lexeme = string.sub(source, index, end_index_exclusive - 1),
			}
			index, line, line_start = consume_span(source, index, end_index_exclusive, line, line_start)
		elseif code == 34 or code == 39 then
			local delimiter = code
			index = index + 1
			while index <= length do
				local current = string.byte(source, index)
				if current == 92 and index < length then
					index = index + 2
				elseif current == delimiter then
					index = index + 1
					break
				elseif current == 10 or current == 13 then
					index, line, line_start = advance_newline(source, index, length, line, line_start)
					break
				else
					index = index + 1
				end
			end
		elseif is_identifier_start_code(code) then
			local token_line = line
			local token_column = index - line_start + 1
			local end_index = read_identifier(source, index, length)
			local word = string.lower(string.sub(source, index, end_index - 1))
			if tracked_keywords[word] then
				tokens[#tokens + 1] = {
					type = word,
					line = token_line,
					column = token_column,
					lexeme = string.sub(source, index, end_index - 1),
				}
			end
			index = end_index
		elseif code == 123 then
			tokens[#tokens + 1] = { type = "left_brace", line = line, column = index - line_start + 1, lexeme = "{" }
			index = index + 1
		elseif code == 125 then
			tokens[#tokens + 1] = { type = "right_brace", line = line, column = index - line_start + 1, lexeme = "}" }
			index = index + 1
		else
			index = index + 1
		end
	end
	return tokens
end

local function build_tokens_by_line(tokens)
	local tokens_by_line = {}
	for index = 1, #tokens do
		local token = tokens[index]
		local bucket = tokens_by_line[token.line]
		if not bucket then
			bucket = {}
			tokens_by_line[token.line] = bucket
		end
		bucket[#bucket + 1] = token
	end
	return tokens_by_line
end

local function mark_preserved_inner_lines(preserved, line, lexeme)
	local segments = split_source_lines(lexeme)
	if #segments <= 2 then
		return
	end
	for offset = 2, #segments - 1 do
		preserved[line + offset - 1] = true
	end
end

local function determine_preserved_lines(tokens)
	local preserved = {}
	for index = 1, #tokens do
		local token = tokens[index]
		if token.type == "string" and string.sub(token.lexeme, 1, 1) == "[" then
			mark_preserved_inner_lines(preserved, token.line, token.lexeme)
		elseif token.type == "comment_block" then
			mark_preserved_inner_lines(preserved, token.line, token.lexeme)
		end
	end
	return preserved
end

local function compute_line_metadata(line_count, tokens_by_line)
	local metadata = {}
	for line = 1, line_count do
		local tokens = tokens_by_line[line] or {}
		if #tokens == 0 then
			metadata[line] = { decrease_before = 0, increase_after = 0 }
		else
			local leading_closers = 0
			for token_index = 1, #tokens do
				local token_type = tokens[token_index].type
				if not closing_tokens[token_type] then
					break
				end
				leading_closers = leading_closers + 1
			end
			local total_closers = 0
			local openers = 0
			for token_index = 1, #tokens do
				local token_type = tokens[token_index].type
				if closing_tokens[token_type] then
					total_closers = total_closers + 1
				end
				if opening_tokens[token_type] then
					openers = openers + 1
				end
			end
			local closers_after = total_closers - leading_closers
			metadata[line] = {
				decrease_before = leading_closers,
				increase_after = openers - closers_after,
			}
		end
	end
	return metadata
end

function formatter.format_lua_document(source)
	if #source == 0 then
		return ""
	end
	local newline = string.find(source, "\r\n", 1, true) and "\r\n" or "\n"
	local lines = split_source_lines(source)
	local tokens = formatter.scan_tokens(source)
	local tokens_by_line = build_tokens_by_line(tokens)
	local preserved_lines = determine_preserved_lines(tokens)
	local metadata = compute_line_metadata(#lines, tokens_by_line)
	local formatted = {}
	local indent_level = 0
	for line = 1, #lines do
		local info = metadata[line]
		local decrease = info.decrease_before
		if decrease > 0 then
			indent_level = math.max(0, indent_level - decrease)
		end
		local original_line = lines[line]
		if preserved_lines[line] then
			formatted[line] = original_line
		else
			local trimmed_leading = trim_leading_whitespace(original_line)
			local content = string.gsub(trimmed_leading, "%s+$", "")
			if #content == 0 then
				formatted[line] = ""
			else
				formatted[line] = repeat_indent(indent_level) .. content
			end
		end
		local increase = info.increase_after
		if increase ~= 0 then
			indent_level = math.max(0, indent_level + increase)
		end
	end
	return table.concat(formatted, newline)
end

function formatter.resolve_offset_position(lines, offset)
	local remaining = offset
	for row = 1, #lines do
		local line_length = #lines[row]
		if remaining <= line_length then
			return { row = row - 1, column = remaining }
		end
		remaining = remaining - line_length - 1
	end
	if #lines == 0 then
		return { row = 0, column = 0 }
	end
	local last_row = #lines
	return { row = last_row - 1, column = #lines[last_row] }
end

return formatter
