local bin<const> = {}

local version<const> = 0xa1
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
local metadata_magic<const> = 0x44544d42
local metadata_version<const> = 1
local metadata_header_size<const> = 12

local new_reader<const> = function(addr, len, label)
	return {
		pos = addr,
		limit = addr + len,
		label = label or 'bin',
		depth = 0,
		prop_names = nil,
	}
end

local need<const> = function(reader, bytes, label)
	if reader.pos + bytes > reader.limit then
		error((label or reader.label) .. ' is truncated.')
	end
end

local read_u8<const> = function(reader, label)
	need(reader, 1, label)
	local value<const> = mem8[reader.pos]
	reader.pos = reader.pos + 1
	return value
end

local read_varuint<const> = function(reader, label)
	local value = 0
	local shift = 0
	for _ = 1, 5 do
		local byte<const> = read_u8(reader, label)
		value = value | ((byte & 0x7f) << shift)
		if (byte & 0x80) == 0 then
			return value
		end
		shift = shift + 7
	end
	error((label or reader.label) .. ' varuint overflow.')
end

local read_varint<const> = function(reader, label)
	local raw<const> = read_varuint(reader, label)
	local value<const> = raw >> 1
	if (raw & 1) == 0 then
		return value
	end
	return -(value + 1)
end

local read_string<const> = function(reader, label)
	local length<const> = read_varuint(reader, label)
	need(reader, length, label)
	if length == 0 then
		return ''
	end
	local out<const> = {}
	local chunk<const> = {}
	local chunk_len = 0
	local finish<const> = reader.pos + length
	while reader.pos < finish do
		chunk_len = chunk_len + 1
		chunk[chunk_len] = mem8[reader.pos]
		reader.pos = reader.pos + 1
		if chunk_len == 256 then
			out[#out + 1] = string.char(table.unpack(chunk, 1, chunk_len))
			chunk_len = 0
		end
	end
	if chunk_len > 0 then
		out[#out + 1] = string.char(table.unpack(chunk, 1, chunk_len))
	end
	return table.concat(out)
end

local read_prop_names<const> = function(reader)
	local count<const> = read_varuint(reader, 'property count')
	local names<const> = {}
	for index = 1, count do
		names[index] = read_string(reader, 'property name')
	end
	return names
end

local read_binary<const> = function(reader)
	local length<const> = read_varuint(reader, 'binary length')
	need(reader, length, 'binary payload')
	local values<const> = {}
	for index = 1, length do
		values[index] = mem8[reader.pos]
		reader.pos = reader.pos + 1
	end
	return values
end

local read_value

local read_array<const> = function(reader)
	local count<const> = read_varuint(reader, 'array length')
	local values<const> = {}
	for index = 1, count do
		values[index] = read_value(reader)
	end
	return values
end

local read_object<const> = function(reader)
	local count<const> = read_varuint(reader, 'object property count')
	local values<const> = {}
	local names<const> = reader.prop_names
	for _ = 1, count do
		local prop_id<const> = read_varuint(reader, 'property id')
		local name<const> = names[prop_id + 1]
		if name == nil then
			error('bin object has invalid property id ' .. tostring(prop_id) .. '.')
		end
		values[name] = read_value(reader)
	end
	return values
end

read_value = function(reader)
	reader.depth = reader.depth + 1
	if reader.depth > 32768 then
		error(reader.label .. ' nesting is too deep.')
	end
	local tag<const> = read_u8(reader, 'tag')
	local value
	if tag == tag_null then
		value = nil
	elseif tag == tag_true then
		value = true
	elseif tag == tag_false then
		value = false
	elseif tag == tag_f64 then
		need(reader, 8, 'float64')
		value = u64_to_f64(mem32le[reader.pos + 4], mem32le[reader.pos])
		reader.pos = reader.pos + 8
	elseif tag == tag_str then
		value = read_string(reader, 'string')
	elseif tag == tag_arr then
		value = read_array(reader)
	elseif tag == tag_ref then
		value = { r = read_varuint(reader, 'ref id') }
	elseif tag == tag_obj then
		value = read_object(reader)
	elseif tag == tag_bin then
		value = read_binary(reader)
	elseif tag == tag_int then
		value = read_varint(reader, 'int')
	elseif tag == tag_f32 then
		need(reader, 4, 'float32')
		value = u32_to_f32(mem32le[reader.pos])
		reader.pos = reader.pos + 4
	elseif tag == tag_set then
		value = read_array(reader)
	else
		error('Unsupported bin tag ' .. tostring(tag) .. '.')
	end
	reader.depth = reader.depth - 1
	return value
end

local finish<const> = function(reader)
	if reader.pos ~= reader.limit then
		error(reader.label .. ' has trailing bytes.')
	end
end

function bin.decode(addr, len, label)
	local reader<const> = new_reader(addr, len, label)
	local actual_version<const> = read_u8(reader, 'bin version')
	if actual_version ~= version then
		error('Unsupported binary payload version.')
	end
	reader.prop_names = read_prop_names(reader)
	local value<const> = read_value(reader)
	finish(reader)
	return value
end

function bin.decode_with_props(addr, len, prop_names, label)
	local reader<const> = new_reader(addr, len, label)
	reader.prop_names = prop_names
	local value<const> = read_value(reader)
	finish(reader)
	return value
end

function bin.read_metadata_prop_names(addr, len)
	if len < metadata_header_size then
		error('ROM metadata section is too small.')
	end
	if mem[addr] ~= metadata_magic then
		error('ROM metadata section magic is invalid.')
	end
	if mem[addr + 4] ~= metadata_version then
		error('ROM metadata section version is invalid.')
	end
	local count<const> = mem[addr + 8]
	local reader<const> = new_reader(addr + metadata_header_size, len - metadata_header_size, 'ROM metadata')
	local names<const> = {}
	for index = 1, count do
		names[index] = read_string(reader, 'ROM metadata property name')
	end
	return names, reader.pos - addr
end

return bin
