local byte<const> = __bmsx_string_byte
local char<const> = __bmsx_string_char
local concat<const> = table.concat

local ascii_upper_a<const> = 65
local ascii_upper_z<const> = 90
local ascii_lower_a<const> = 97
local ascii_lower_z<const> = 122
local ascii_case_delta<const> = ascii_lower_a - ascii_upper_a

local map_ascii_case<const> = function(value, first, last, delta)
	local mapped<const> = {}
	for index = 1, #value do
		local code = byte(value, index)
		if code >= first and code <= last then
			code = code + delta
		end
		mapped[index] = char(code)
	end
	return concat(mapped)
end

local normalize_index<const> = function(value, length, zero)
	local index<const> = value // 1
	if index > 0 then
		return index
	end
	if index < 0 then
		return length + index + 1
	end
	return zero
end


string.byte = byte
string.char = char


string.len = function(value)
	return #value
end


string.upper = function(value)
	return map_ascii_case(value, ascii_lower_a, ascii_lower_z, -ascii_case_delta)
end


string.lower = function(value)
	return map_ascii_case(value, ascii_upper_a, ascii_upper_z, ascii_case_delta)
end


string.sub = function(value, start_arg, end_arg)
	local length<const> = #value
	local start_index = start_arg == nil and 1 or normalize_index(start_arg, length, 1)
	local end_index = end_arg == nil and length or normalize_index(end_arg, length, 0)
	if start_index < 1 then
		start_index = 1
	end
	if end_index > length then
		end_index = length
	end
	if end_index < start_index then
		return ''
	end
	if start_index == 1 and end_index == length then
		return value
	end
	if start_index == end_index then
		return char(byte(value, start_index))
	end
	local output<const> = {}
	for index = start_index, end_index do
		output[#output + 1] = char(byte(value, index))
	end
	return concat(output)
end


string.reverse = function(value)
	local length<const> = #value
	if length <= 1 then
		return value
	end
	local output<const> = {}
	for index = length, 1, -1 do
		output[#output + 1] = char(byte(value, index))
	end
	return concat(output)
end

string.rep = function(value, count_arg, separator)
	local count<const> = count_arg == nil and 1 or count_arg // 1
	if count <= 0 then
		return ''
	end
	local output = ''
	local chunk = value
	local remaining = count
	if separator ~= nil then
		output = value
		chunk = separator .. value
		remaining = count - 1
	end
	while remaining > 0 do
		if remaining % 2 == 1 then
			output = output .. chunk
		end
		remaining = remaining // 2
		if remaining > 0 then
			chunk = chunk .. chunk
		end
	end
	return output
end


return string
