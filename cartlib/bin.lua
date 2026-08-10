local bin<const> = {}
local read_u32le<const> = require('cartlib/memory').read_u32le
local decode_float<const> = require('string/float/decode')
local string_lib<const> = string
local table_lib<const> = table

local tag_null<const> = 0
local tag_true<const> = 1
local tag_false<const> = 2
local tag_f64<const> = 3
local tag_str<const> = 4
local tag_arr<const> = 5
local tag_ref<const> = 6
local tag_obj<const> = 7
local tag_bin<const> = 8
local tag_int<const> = 9
local tag_f32<const> = 10
local tag_set<const> = 11
local metadata_header_size<const> = 12

local new_reader<const> = function(addr, label)
	return {
		pos = addr,
		label = label,
		prop_names = nil,
	}
end

local read_u8<const> = function(reader)
	local source<const>: *u8 = reader.pos
	local value<const> = *source
	reader.pos = reader.pos + 1
	return value
end

local read_varuint<const> = function(reader)
	local value = 0
	local shift = 0
	for _ = 1, 5 do
		local byte<const> = read_u8(reader)
		value = value | ((byte & 0x7f) << shift)
		if (byte & 0x80) == 0 then
			return value
		end
		shift = shift + 7
	end
	return value
end

local read_varint<const> = function(reader)
	local raw<const> = read_varuint(reader)
	local value<const> = raw >> 1
	if (raw & 1) == 0 then
		return value
	end
	return -(value + 1)
end

local read_string<const> = function(reader)
	local length<const> = read_varuint(reader)
	if length == 0 then
		return ''
	end
	local out<const> = {}
	local chunk<const> = {}
	local chunk_len = 0
	local source: *u8 = reader.pos
	local finish<const> = source + length
	while source < finish do
		chunk_len = chunk_len + 1
		chunk[chunk_len] = *source
		source = source + 1
		if chunk_len == 256 then
			out[#out + 1] = string_lib.char(table_lib.unpack(chunk, 1, chunk_len))
			chunk_len = 0
		end
	end
	reader.pos = finish
	if chunk_len > 0 then
		out[#out + 1] = string_lib.char(table_lib.unpack(chunk, 1, chunk_len))
	end
	return table_lib.concat(out)
end

local read_prop_names<const> = function(reader)
	local count<const> = read_varuint(reader)
	local names<const> = {}
	for index = 1, count do
		names[index] = read_string(reader)
	end
	return names
end

local read_binary<const> = function(reader)
	local length<const> = read_varuint(reader)
	local values<const> = {}
	local source: *u8 = reader.pos
	for index = 1, length do
		values[index] = *source
		source = source + 1
	end
	reader.pos = source
	return values
end

local read_value

local read_array<const> = function(reader)
	local count<const> = read_varuint(reader)
	local values<const> = {}
	for index = 1, count do
		values[index] = read_value(reader)
	end
	return values
end

local read_object<const> = function(reader)
	local count<const> = read_varuint(reader)
	local values<const> = {}
	local names<const> = reader.prop_names
	for _ = 1, count do
		local prop_id<const> = read_varuint(reader)
		values[names[prop_id + 1]] = read_value(reader)
	end
	return values
end

read_value = function(reader)
	local tag<const> = read_u8(reader)
	local value
	if tag == tag_null then
		value = nil
	elseif tag == tag_true then
		value = true
	elseif tag == tag_false then
		value = false
	elseif tag == tag_f64 then
		value = decode_float(read_u32le(reader.pos + 4), read_u32le(reader.pos), 8)
		reader.pos = reader.pos + 8
	elseif tag == tag_str then
		value = read_string(reader, 'string')
	elseif tag == tag_arr then
		value = read_array(reader)
	elseif tag == tag_ref then
		value = { r = read_varuint(reader) }
	elseif tag == tag_obj then
		value = read_object(reader)
	elseif tag == tag_bin then
		value = read_binary(reader)
	elseif tag == tag_int then
		value = read_varint(reader)
	elseif tag == tag_f32 then
		value = decode_float(read_u32le(reader.pos), 0, 4)
		reader.pos = reader.pos + 4
	elseif tag == tag_set then
		value = read_array(reader)
	else
		error(reader.label .. ' has unsupported bin tag ' .. tostring(tag) .. '.')
	end
	return value
end

function bin.decode(addr, label)
	local reader<const> = new_reader(addr, label)
	read_u8(reader)
	reader.prop_names = read_prop_names(reader)
	local value<const> = read_value(reader)
	return value
end

function bin.decode_with_props(addr, prop_names, label)
	local reader<const> = new_reader(addr, label)
	reader.prop_names = prop_names
	local value<const> = read_value(reader)
	return value
end

function bin.read_metadata_prop_names(addr)
	local header<const>: *word = addr
	local count<const> = header[2]
	local reader<const> = new_reader(addr + metadata_header_size, 'ROM metadata')
	local names<const> = {}
	for index = 1, count do
		names[index] = read_string(reader)
	end
	return names, reader.pos - addr
end

return bin
