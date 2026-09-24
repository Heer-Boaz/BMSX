-- Packed installed scope metadata. Offsets mirror spec/blua32/diagnostics.
local decode_utf8<const> = require('string/utf8').decode
local scopes<const> = {}

local directory_header_index<const> = 15
local function_count_index<const> = 8
local function_table_index<const> = 9
local frame_table_index<const> = 11
local binding_table_index<const> = 13
local interval_table_index<const> = 15
local static_global_count_index<const> = 18
local function_words<const> = 4
local frame_words<const> = 7
local binding_words<const> = 8
local binding_upvalue<const> = 1
local binding_const<const> = 2
local binding_address<const> = 4
local binding_type<const> = 8

local contains<const> = function(interval_address, start, count, word)
	local intervals<const>: *word = interval_address
	local first = start
	local last = start + count
	while first < last do
		local middle<const> = (first + last) >> 1
		if intervals[middle * 2 + 1] <= word then
			first = middle + 1
		else
			last = middle
		end
	end
	return first < start + count and intervals[first * 2] <= word
end

local decode_binding<const> = function(base, binding_table, slot, interval_address, word)
	local bindings<const>: *word = binding_table
	local flags<const> = bindings[slot + 2]
	local address<const> = flags & binding_address ~= 0
	return decode_utf8(base + bindings[slot], bindings[slot + 1]), {
		index = bindings[slot + 3],
		upvalue = flags & binding_upvalue ~= 0,
		is_const = flags & binding_const ~= 0,
		is_address = address,
		is_type = flags & binding_type ~= 0,
		available = address or contains(interval_address, bindings[slot + 6], bindings[slot + 7], word),
	}
end

function scopes.resolve(rom_base, function_address, pc, inline_depth)
	local rom<const>: *word = rom_base
	local directory_offset<const> = rom[directory_header_index]
	if directory_offset == 0 then
		return nil, 'Frame symbols are unavailable.'
	end
	local base<const> = rom_base + directory_offset
	local directory<const>: *word = base
	local functions<const>: *word = base + directory[function_table_index]
	local count<const> = directory[function_count_index]
	local first = 0
	local last = count
	while first < last do
		local middle<const> = (first + last) >> 1
		if functions[middle * function_words] < function_address then
			first = middle + 1
		else
			last = middle
		end
	end
	if first == count or functions[first * function_words] ~= function_address then
		return nil, 'Frame function has no installed symbols.'
	end
	local function_index<const> = first * function_words
	local word<const> = (pc - functions[function_index + 1]) >> 2
	local frame_start<const> = functions[function_index + 2]
	local frame_end<const> = frame_start + functions[function_index + 3]
	local frames<const>: *word = base + directory[frame_table_index]
	local intervals<const>: *word = base + directory[interval_table_index]
	for frame_index = frame_start, frame_end - 1 do
		local at<const> = frame_index * frame_words
		if frames[at] == inline_depth and contains(intervals, frames[at + 3], frames[at + 4], word) then
			local name<const> = decode_utf8(base + frames[at + 1], frames[at + 2])
			local bindings<const>: *word = base + directory[binding_table_index]
			local binding_start<const> = frames[at + 5]
			local binding_end<const> = binding_start + frames[at + 6]
			local names<const> = {}
			for binding_index = 0, directory[static_global_count_index] - 1 do
				local identifier<const>, binding<const> = decode_binding(base, bindings, binding_index * binding_words, intervals, word)
				names[identifier] = binding
			end
			for binding_index = binding_start, binding_end - 1 do
				local slot<const> = binding_index * binding_words
				if contains(intervals, bindings[slot + 4], bindings[slot + 5], word) then
					local identifier<const>, binding<const> = decode_binding(base, bindings, slot, intervals, word)
					names[identifier] = binding
				end
			end
			return names, name
		end
	end
	return nil, 'Frame source scope is unavailable at this PC and inline depth.'
end

return scopes
