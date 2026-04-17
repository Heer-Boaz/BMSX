-- identifier_chain.lua

local identifier_chain = {}
local separators = {
	["."] = true,
	[":"] = true,
}

local function is_identifier_start(ch)
	local code = string.byte(ch)
	return code and ((code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 95)
end

local function is_identifier_part(ch)
	local code = string.byte(ch)
	return is_identifier_start(ch) or (code and code >= 48 and code <= 57)
end

local function is_valid_identifier_segment(value)
	if #value == 0 then
		return false
	end
	if not is_identifier_start(string.sub(value, 1, 1)) then
		return false
	end
	for index = 2, #value do
		if not is_identifier_part(string.sub(value, index, index)) then
			return false
		end
	end
	return true
end

function identifier_chain.parse_identifier_chain(expression)
	if not expression or #expression == 0 then
		return nil
	end
	local parts = {}
	local segment_start = 1
	for index = 1, #expression do
		local ch = string.sub(expression, index, index)
		if separators[ch] then
			local segment = string.sub(expression, segment_start, index - 1)
			if not is_valid_identifier_segment(segment) then
				return nil
			end
			parts[#parts + 1] = segment
			segment_start = index + 1
		end
	end
	local tail_segment = string.sub(expression, segment_start)
	if not is_valid_identifier_segment(tail_segment) then
		return nil
	end
	parts[#parts + 1] = tail_segment
	return parts
end

function identifier_chain.resolve_identifier_chain_root(expression)
	local parts = identifier_chain.parse_identifier_chain(expression)
	if not parts or #parts == 0 then
		return nil
	end
	return parts[1]
end

return identifier_chain
