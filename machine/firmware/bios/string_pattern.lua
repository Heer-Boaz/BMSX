local byte<const> = string.byte
local sub<const> = string.sub
local concat<const> = table.concat
local unpack<const> = table.unpack
local tonumber<const> = tonumber
local tostring<const> = tostring
local type<const> = type

local string_pattern<const> = {}

local ascii_percent<const> = 37
local ascii_dot<const> = 46
local ascii_zero<const> = 48
local ascii_nine<const> = 57
local ascii_one<const> = 49
local ascii_upper_a<const> = 65
local ascii_upper_z<const> = 90
local ascii_lower_a<const> = 97
local ascii_lower_z<const> = 122
local ascii_underscore<const> = 95

local text_replacement_type<const> = { string = true, number = true }

local is_alpha<const> = function(code)
	return (code >= ascii_upper_a and code <= ascii_upper_z) or (code >= ascii_lower_a and code <= ascii_lower_z)
end

local is_digit<const> = function(code)
	return code >= ascii_zero and code <= ascii_nine
end

local is_space<const> = function(code)
	return code == 32 or (code >= 9 and code <= 13)
end

local is_punctuation<const> = function(code)
	return (code >= 33 and code <= 47) or (code >= 58 and code <= 64) or (code >= 91 and code <= 96) or (code >= 123 and code <= 126)
end

local class_match<const> = function(code, token)
	if token >= ascii_upper_a and token <= ascii_upper_z then
		return not class_match(code, token + 32)
	end
	if token == 97 then
		return is_alpha(code)
	end
	if token == 99 then
		return code <= 31 or code == 127
	end
	if token == 100 then
		return is_digit(code)
	end
	if token == 103 then
		return code >= 33 and code <= 126
	end
	if token == 108 then
		return code >= ascii_lower_a and code <= ascii_lower_z
	end
	if token == 112 then
		return is_punctuation(code)
	end
	if token == 115 then
		return is_space(code)
	end
	if token == 117 then
		return code >= ascii_upper_a and code <= ascii_upper_z
	end
	if token == 119 then
		return is_alpha(code) or is_digit(code) or code == ascii_underscore
	end
	if token == 120 then
		return is_digit(code) or (code >= 65 and code <= 70) or (code >= 97 and code <= 102)
	end
	if token == 122 then
		return code == 0
	end
	return code == token
end

local item_end<const> = function(pattern, index)
	local ch<const> = sub(pattern, index, index)
	if ch == '%' then
		return index + 2
	end
	if ch ~= '[' then
		return index + 1
	end
	index = index + 1
	if sub(pattern, index, index) == '^' then
		index = index + 1
	end
	while index <= #pattern do
		local item<const> = sub(pattern, index, index)
		if item == '%' then
			index = index + 2
		elseif item == ']' then
			return index + 1
		else
			index = index + 1
		end
	end
	error('invalid string pattern')
end

local bracket_match<const> = function(pattern, start_index, finish_index, code)
	local index = start_index + 1
	local negate = false
	if sub(pattern, index, index) == '^' then
		negate = true
		index = index + 1
	end
	local matched = false
	while index < finish_index - 1 do
		local next_index<const> = item_end(pattern, index)
		if sub(pattern, next_index, next_index) == '-' and next_index + 1 < finish_index and next_index == index + 1 then
			local range_end<const> = item_end(pattern, next_index + 1)
			if range_end == next_index + 2 and code >= byte(pattern, index) and code <= byte(pattern, next_index + 1) then
				matched = true
			end
			index = range_end
		elseif sub(pattern, index, index) == '%' then
			if class_match(code, byte(pattern, index + 1)) then
				matched = true
			end
			index = next_index
		else
			if code == byte(pattern, index) then
				matched = true
			end
			index = next_index
		end
	end
	if negate then
		return not matched
	end
	return matched
end

local single_match<const> = function(source, source_index, pattern, pattern_index, finish_index)
	if source_index > #source then
		return false
	end
	local item<const> = sub(pattern, pattern_index, pattern_index)
	if item == '.' then
		return true
	end
	local code<const> = byte(source, source_index)
	if item == '%' then
		return class_match(code, byte(pattern, pattern_index + 1))
	end
	if item == '[' then
		return bracket_match(pattern, pattern_index, finish_index, code)
	end
	return code == byte(pattern, pattern_index)
end

local match_here

local trim_captures<const> = function(captures, count)
	while #captures > count do
		captures[#captures] = nil
	end
end

local max_expand<const> = function(source, source_index, pattern, pattern_index, finish_index, next_pattern_index, captures)
	local count = 0
	while single_match(source, source_index + count, pattern, pattern_index, finish_index) do
		count = count + 1
	end
	local capture_count<const> = #captures
	for offset = count, 0, -1 do
		local result<const> = match_here(source, source_index + offset, pattern, next_pattern_index, captures)
		if result ~= nil then
			return result
		end
		trim_captures(captures, capture_count)
	end
	return nil
end

local min_expand<const> = function(source, source_index, pattern, pattern_index, finish_index, next_pattern_index, captures)
	local current = source_index
	local capture_count<const> = #captures
	while true do
		local result<const> = match_here(source, current, pattern, next_pattern_index, captures)
		if result ~= nil then
			return result
		end
		trim_captures(captures, capture_count)
		if not single_match(source, current, pattern, pattern_index, finish_index) then
			return nil
		end
		current = current + 1
	end
end

local capture_value<const> = function(source, capture)
	if capture.position ~= nil then
		return capture.position
	end
	return sub(source, capture.start, capture.finish - 1)
end

local balanced_finish<const> = function(source, source_index, open_char, close_char)
	if sub(source, source_index, source_index) ~= open_char then
		return nil
	end
	local depth = 1
	local index = source_index + 1
	while index <= #source do
		local current<const> = sub(source, index, index)
		if current == close_char then
			depth = depth - 1
			if depth == 0 then
				return index + 1
			end
		elseif current == open_char then
			depth = depth + 1
		end
		index = index + 1
	end
	return nil
end

local frontier_match<const> = function(source, source_index, pattern, bracket_index, bracket_finish)
	local previous_code = 0
	if source_index > 1 then
		previous_code = byte(source, source_index - 1)
	end
	local current_code = 0
	if source_index <= #source then
		current_code = byte(source, source_index)
	end
	return not bracket_match(pattern, bracket_index, bracket_finish, previous_code)
		and bracket_match(pattern, bracket_index, bracket_finish, current_code)
end

local capture_match_finish<const> = function(source, source_index, pattern, pattern_index, captures)
	local capture_index<const> = byte(pattern, pattern_index + 1) - ascii_zero
	local capture<const> = captures[capture_index]
	if capture == nil or capture.finish == nil or capture.position ~= nil then
		error('invalid string pattern capture')
	end
	local length<const> = capture.finish - capture.start
	for offset = 0, length - 1 do
		if byte(source, source_index + offset) ~= byte(source, capture.start + offset) then
			return nil
		end
	end
	return source_index + length
end

match_here = function(source, source_index, pattern, pattern_index, captures)
	if pattern_index > #pattern then
		return source_index
	end
	local pattern_char<const> = sub(pattern, pattern_index, pattern_index)
	if pattern_char == '$' and pattern_index == #pattern then
		if source_index == #source + 1 then
			return source_index
		end
		return nil
	end
	if pattern_char == '%' then
		local token<const> = byte(pattern, pattern_index + 1)
		if token == 98 then
			local finish<const> = balanced_finish(source, source_index, sub(pattern, pattern_index + 2, pattern_index + 2), sub(pattern, pattern_index + 3, pattern_index + 3))
			if finish == nil then
				return nil
			end
			return match_here(source, finish, pattern, pattern_index + 4, captures)
		end
		if token == 102 then
			local bracket_index<const> = pattern_index + 2
			if sub(pattern, bracket_index, bracket_index) ~= '[' then
				error('invalid string pattern')
			end
			local bracket_finish<const> = item_end(pattern, bracket_index)
			if frontier_match(source, source_index, pattern, bracket_index, bracket_finish) then
				return match_here(source, source_index, pattern, bracket_finish, captures)
			end
			return nil
		end
		if token >= ascii_one and token <= ascii_nine then
			local finish<const> = capture_match_finish(source, source_index, pattern, pattern_index, captures)
			if finish == nil then
				return nil
			end
			return match_here(source, finish, pattern, pattern_index + 2, captures)
		end
	end
	if pattern_char == '(' then
		local capture_index<const> = #captures + 1
		if sub(pattern, pattern_index + 1, pattern_index + 1) == ')' then
			captures[capture_index] = { position = source_index }
			local result<const> = match_here(source, source_index, pattern, pattern_index + 2, captures)
			if result == nil then
				captures[capture_index] = nil
			end
			return result
		end
		captures[capture_index] = { start = source_index }
		local result<const> = match_here(source, source_index, pattern, pattern_index + 1, captures)
		if result == nil then
			captures[capture_index] = nil
		end
		return result
	end
	if pattern_char == ')' then
		for capture_index = #captures, 1, -1 do
			if captures[capture_index].finish == nil then
				captures[capture_index].finish = source_index
				local result<const> = match_here(source, source_index, pattern, pattern_index + 1, captures)
				if result == nil then
					captures[capture_index].finish = nil
				end
				return result
			end
		end
		error('invalid string pattern')
	end
	local finish_index<const> = item_end(pattern, pattern_index)
	local suffix<const> = sub(pattern, finish_index, finish_index)
	if suffix == '?' then
		local count<const> = #captures
		if single_match(source, source_index, pattern, pattern_index, finish_index) then
			local result<const> = match_here(source, source_index + 1, pattern, finish_index + 1, captures)
			if result ~= nil then
				return result
			end
			trim_captures(captures, count)
		end
		return match_here(source, source_index, pattern, finish_index + 1, captures)
	end
	if suffix == '*' then
		return max_expand(source, source_index, pattern, pattern_index, finish_index, finish_index + 1, captures)
	end
	if suffix == '+' then
		if single_match(source, source_index, pattern, pattern_index, finish_index) then
			return max_expand(source, source_index + 1, pattern, pattern_index, finish_index, finish_index + 1, captures)
		end
		return nil
	end
	if suffix == '-' then
		return min_expand(source, source_index, pattern, pattern_index, finish_index, finish_index + 1, captures)
	end
	if single_match(source, source_index, pattern, pattern_index, finish_index) then
		return match_here(source, source_index + 1, pattern, finish_index, captures)
	end
	return nil
end

local values_for<const> = function(source, captures, match_start, match_finish)
	local values<const> = {}
	if #captures == 0 then
		values[1] = sub(source, match_start, match_finish - 1)
		return values
	end
	for index = 1, #captures do
		values[index] = capture_value(source, captures[index])
	end
	return values
end

local find_match<const> = function(source, pattern, start_index)
	local anchored = false
	local pattern_index = 1
	if sub(pattern, 1, 1) == '^' then
		anchored = true
		pattern_index = 2
	end
	local source_index = start_index
	while source_index <= #source + 1 do
		local captures<const> = {}
		local result<const> = match_here(source, source_index, pattern, pattern_index, captures)
		if result ~= nil then
			return source_index, result, captures
		end
		if anchored then
			return nil
		end
		source_index = source_index + 1
	end
	return nil
end

local plain_find<const> = function(source, needle, start_index)
	if #needle == 0 then
		return start_index, start_index - 1
	end
	local last_start<const> = #source - #needle + 1
	for index = start_index, last_start do
		local matched = true
		for needle_index = 1, #needle do
			if byte(source, index + needle_index - 1) ~= byte(needle, needle_index) then
				matched = false
				break
			end
		end
		if matched then
			return index, index + #needle - 1
		end
	end
	return nil
end

local normalize_index<const> = function(value, length)
	local index<const> = value // 1
	if index > 0 then
		return index
	end
	if index < 0 then
		return length + index + 1
	end
	return 1
end

function string_pattern.find(source, pattern, start_arg, plain)
	local start_index<const> = start_arg == nil and 1 or normalize_index(start_arg, #source)
	if start_index > #source then
		return nil
	end
	if plain then
		return plain_find(source, pattern, start_index)
	end
	local match_start<const>, match_finish<const>, captures<const> = find_match(source, pattern, start_index)
	if match_start == nil then
		return nil
	end
	local out<const> = { match_start, match_finish - 1 }
	if #captures > 0 then
		local values<const> = values_for(source, captures, match_start, match_finish)
		for index = 1, #values do
			out[#out + 1] = values[index]
		end
	end
	return unpack(out, 1, #out)
end

function string_pattern.match(source, pattern, start_arg)
	local start_index<const> = start_arg == nil and 1 or normalize_index(start_arg, #source)
	local match_start<const>, match_finish<const>, captures<const> = find_match(source, pattern, start_index)
	if match_start == nil then
		return nil
	end
	local values<const> = values_for(source, captures, match_start, match_finish)
	return unpack(values, 1, #values)
end

local append_replacement<const> = function(out, replacement, whole, captures)
	local index = 1
	while index <= #replacement do
		if sub(replacement, index, index) ~= '%' or index == #replacement then
			out[#out + 1] = sub(replacement, index, index)
			index = index + 1
		else
			index = index + 1
			local token<const> = sub(replacement, index, index)
			if token == '%' then
				out[#out + 1] = '%'
			elseif token == '0' then
				out[#out + 1] = whole
			else
				local capture_index<const> = tonumber(token)
				if capture_index == nil then
					out[#out + 1] = token
				else
					local captured<const> = captures[capture_index]
					if captured == nil then
						out[#out + 1] = ''
					else
						out[#out + 1] = captured
					end
				end
			end
			index = index + 1
		end
	end
end

local replacement_value<const> = function(replacement, whole, captures)
	local replacement_type<const> = type(replacement)
	if text_replacement_type[replacement_type] then
		local out<const> = {}
		append_replacement(out, tostring(replacement), whole, captures)
		return concat(out)
	end
	if replacement_type == 'table' then
		local key = whole
		if #captures > 0 then
			key = captures[1]
		end
		local mapped<const> = replacement[key]
		if mapped == nil then
			return whole
		end
		return tostring(mapped)
	end
	if replacement_type == 'function' then
		local mapped
		if #captures > 0 then
			mapped = replacement(unpack(captures, 1, #captures))
		else
			mapped = replacement(whole)
		end
		if not mapped then
			return whole
		end
		return tostring(mapped)
	end
	error('string.gsub replacement must be a string, number, function, or table.')
end

function string_pattern.gsub(source, pattern, replacement, limit_arg)
	local limit = limit_arg == nil and #source + 1 or limit_arg // 1
	if limit < 0 then
		limit = 0
	end
	local out<const> = {}
	local count = 0
	local search_index = 1
	local last_index = 1
	while count < limit do
		local match_start<const>, match_finish<const>, raw_captures<const> = find_match(source, pattern, search_index)
		if match_start == nil then
			break
		end
		out[#out + 1] = sub(source, last_index, match_start - 1)
		local captures<const> = values_for(source, raw_captures, match_start, match_finish)
		local whole<const> = sub(source, match_start, match_finish - 1)
		out[#out + 1] = replacement_value(replacement, whole, captures)
		count = count + 1
		last_index = match_finish
		if match_finish == match_start then
			if search_index > #source then
				break
			end
			search_index = match_finish + 1
			last_index = search_index
		else
			search_index = match_finish
		end
	end
	out[#out + 1] = sub(source, last_index)
	return concat(out), count
end

function string_pattern.gmatch(source, pattern)
	local search_index = 1
	return function()
		local match_start<const>, match_finish<const>, raw_captures<const> = find_match(source, pattern, search_index)
		if match_start == nil then
			return nil
		end
		if match_finish == match_start then
			search_index = match_finish + 1
		else
			search_index = match_finish
		end
		local captures<const> = values_for(source, raw_captures, match_start, match_finish)
		return unpack(captures, 1, #captures)
	end
end

return string_pattern
