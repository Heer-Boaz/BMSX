local bin<const> = require('cartlib/bin')
local string_lib<const> = string
local table_lib<const> = table

local romdir<const> = {}

local toc_header_size<const> = 48
local toc_entry_size<const> = 88
local toc_invalid_u32<const> = 0xffffffff
local rom_header_toc_index<const> = 4
local rom_header_metadata_index<const> = 16
local rom_header_metadata_length_index<const> = 17
local toc_header_entry_count_index<const> = 3
local toc_entry_token_lo_index<const> = 0
local toc_entry_token_hi_index<const> = 1
local toc_entry_kind_index<const> = 2
local toc_entry_op_index<const> = 3
local toc_entry_resid_index<const> = 4
local toc_entry_resid_length_index<const> = 5
local toc_entry_data_start_index<const> = 10
local toc_entry_data_end_index<const> = 11
local toc_entry_metadata_start_index<const> = 14
local toc_entry_metadata_end_index<const> = 15
local toc_entry_collision_start_index<const> = 18
local toc_entry_collision_end_index<const> = 19
local op_delete<const> = 1
local hash_prime<const> = 0x1b3
local u32_mod<const> = 0x100000000
local cart_rom_base<const> = 0x10000000

local kind_image<const> = 1
local kind_audio<const> = 2
local kind_data<const> = 3
local kind_bin<const> = 4
local kind_model<const> = 7
local kind_aem<const> = 8
local kind_lua<const> = 9
local kind_code<const> = 10
local kind_texture<const> = 11

local kind_name_by_id<const> = {
	[kind_image] = 'image',
	[kind_audio] = 'audio',
	[kind_data] = 'data',
	[kind_bin] = 'bin',
	[kind_model] = 'model',
	[kind_aem] = 'aem',
	[kind_lua] = 'lua',
	[kind_code] = 'code',
	[kind_texture] = 'texture',
}

local read_header<const> = function(rom_base)
	local header<const>: *word = rom_base
	return {
		rom_base = rom_base,
		toc_off = header[rom_header_toc_index],
		metadata_off = header[rom_header_metadata_index],
		metadata_len = header[rom_header_metadata_length_index],
	}
end

local register_token<const> = function(rom, entry)
	local hi_map = rom.tokens[entry.token_hi]
	if hi_map == nil then
		hi_map = {}
		rom.tokens[entry.token_hi] = hi_map
	end
	local kind_map = hi_map[entry.token_lo]
	if kind_map == nil then
		kind_map = {}
		hi_map[entry.token_lo] = kind_map
	end
	kind_map[entry.kind] = entry
end

local entry_span<const> = function(rom_base, start, finish)
	if start == toc_invalid_u32 then
		return 0, 0, 0, 0
	end
	return rom_base + start, finish - start, start, finish
end

local read_toc_string<const> = function(toc_base, string_table_offset, offset, length)
	if length == 0 then
		return ''
	end
	local source<const>: *u8 = toc_base + string_table_offset + offset
	local out<const> = {}
	local chunk<const> = {}
	local chunk_len = 0
	for index = 0, length - 1 do
		chunk_len = chunk_len + 1
		chunk[chunk_len] = source[index]
		if chunk_len == 256 then
			out[#out + 1] = string_lib.char(table_lib.unpack(chunk, 1, chunk_len))
			chunk_len = 0
		end
	end
	if chunk_len > 0 then
		out[#out + 1] = string_lib.char(table_lib.unpack(chunk, 1, chunk_len))
	end
	return table_lib.concat(out)
end

local parse_metadata_header<const> = function(header)
	if header.metadata_len == 0 then
		return
	end
	local names<const>, payload_off<const> = bin.read_metadata_prop_names(header.rom_base + header.metadata_off)
	header.metadata_prop_names = names
	header.metadata_payload_off = header.metadata_off + payload_off
end

local parse_rom<const> = function(header)
	parse_metadata_header(header)
	local toc_base<const> = header.rom_base + header.toc_off
	local toc<const>: *word = toc_base
	local entry_count<const> = toc[toc_header_entry_count_index]
	local string_table_offset<const> = toc_header_size + entry_count * toc_entry_size

	local rom<const> = {
		header = header,
		tokens = {},
		entries = {},
	}
	for index = 0, entry_count - 1 do
		local entry_base<const> = toc_base + toc_header_size + index * toc_entry_size
		local packed_entry<const>: *word = entry_base
		local payload_addr<const>, payload_len<const> = entry_span(
			header.rom_base,
			packed_entry[toc_entry_data_start_index],
			packed_entry[toc_entry_data_end_index]
		)
		local meta_addr<const>, meta_len<const>, meta_start<const>, meta_finish<const> = entry_span(
			header.rom_base,
			packed_entry[toc_entry_metadata_start_index],
			packed_entry[toc_entry_metadata_end_index]
		)
		local collision_addr<const> = entry_span(
			header.rom_base,
			packed_entry[toc_entry_collision_start_index],
			packed_entry[toc_entry_collision_end_index]
		)
		local id<const> = read_toc_string(
			toc_base,
			string_table_offset,
			packed_entry[toc_entry_resid_index],
			packed_entry[toc_entry_resid_length_index]
		)
		local kind<const> = packed_entry[toc_entry_kind_index]
		local entry<const> = {
			id = id,
			token_lo = packed_entry[toc_entry_token_lo_index],
			token_hi = packed_entry[toc_entry_token_hi_index],
			kind = kind,
			op = packed_entry[toc_entry_op_index],
			rom = rom,
			type = kind_name_by_id[kind],
			addr = payload_addr,
			len = payload_len,
			meta_start = meta_start,
			meta_finish = meta_finish,
			meta_addr = meta_addr,
			meta_len = meta_len,
			collision_addr = collision_addr,
		}
		rom.entries[#rom.entries + 1] = entry
		register_token(rom, entry)
	end
	return rom
end

local hash_id<const> = function(id)
	local lo = 0x84222325
	local hi = 0xcbf29ce4
	for index = 1, #id do
		local xored_lo<const> = (lo ~ string_lib.byte(id, index)) % u32_mod
		local lo_mul<const> = xored_lo * hash_prime
		local carry<const> = lo_mul // u32_mod
		local hi_mul<const> = hi * hash_prime + carry
		lo = lo_mul % u32_mod
		hi = ((hi_mul % u32_mod) + ((xored_lo * 256) % u32_mod)) % u32_mod
	end
	return lo, hi
end

local find_by_token<const> = function(rom, token_lo, token_hi, kind)
	if rom == nil then
		return nil
	end
	local hi_map<const> = rom.tokens[token_hi]
	if hi_map == nil then
		return nil
	end
	local kind_map<const> = hi_map[token_lo]
	if kind_map == nil then
		return nil
	end
	if kind ~= nil then
		return kind_map[kind]
	end
	local found = nil
	for _, entry in pairs(kind_map) do
		if found ~= nil then
			error('ROM lookup is ambiguous; pass a TOC kind.')
		end
		found = entry
	end
	return found
end

local find_in_roms<const> = function(roms, id, kind)
	local token_lo<const>, token_hi<const> = hash_id(id)
	for index = 1, #roms do
		local entry<const> = find_by_token(roms[index], token_lo, token_hi, kind)
		if entry ~= nil then
			if entry.op == op_delete then
				return nil, true
			end
			return entry, false
		end
	end
	return nil, false
end

local decode_payload<const> = function(entry)
	if entry.payload_loaded then
		return entry.payload_value
	end
	entry.payload_loaded = true
	entry.payload_value = bin.decode(entry.addr, entry.id)
	return entry.payload_value
end

local decode_meta<const> = function(entry)
	if entry.meta_loaded then
		return entry.meta_value
	end
	entry.meta_loaded = true
	if entry.meta_len == 0 then
		return nil
	end
	local header<const> = entry.rom.header
	if header.metadata_prop_names ~= nil and entry.meta_start >= header.metadata_payload_off and entry.meta_finish <= header.metadata_off + header.metadata_len then
		entry.meta_value = bin.decode_with_props(entry.meta_addr, header.metadata_prop_names, entry.id .. ' metadata')
	else
		entry.meta_value = bin.decode(entry.meta_addr, entry.id .. ' metadata')
	end
	return entry.meta_value
end

local record_for_entry<const> = function(entry)
	if entry.record ~= nil then
		return entry.record
	end
	local out<const> = {
		resid = entry.id,
		type = entry.type,
		addr = entry.addr,
		len = entry.len,
	}
	local meta<const> = decode_meta(entry)
	if meta ~= nil then
		out.meta = meta
	end
	if entry.kind == kind_image then
		out.imgmeta = meta
		out.collision_addr = entry.collision_addr
	elseif entry.kind == kind_texture then
		out.texturemeta = meta
	elseif entry.kind == kind_audio then
		out.audiometa = meta
	end
	entry.record = out
	return out
end

local list_entries<const> = function(roms, kind)
	local out<const> = {}
	local blocked<const> = {}
	for rom_index = 1, #roms do
		local rom<const> = roms[rom_index]
		for entry_index = 1, #rom.entries do
			local entry<const> = rom.entries[entry_index]
			if (kind == nil or entry.kind == kind) and not blocked[entry.id] then
				blocked[entry.id] = true
				if entry.op ~= op_delete then
					out[#out + 1] = entry
				end
			end
		end
	end
	return out
end

local system_rom<const> = parse_rom(read_header(0x00000000))
local active_roms<const> = { parse_rom(read_header(cart_rom_base)) }
local active_plus_system_roms<const> = { active_roms[1], system_rom }
local system_roms<const> = { system_rom }

function romdir.reload_cartridge_directory()
	local cart_rom<const> = parse_rom(read_header(cart_rom_base))
	active_roms[1] = cart_rom
	active_plus_system_roms[1] = cart_rom
end

function romdir.resource(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id)
	if entry == nil then
		error('ROM resource "' .. tostring(id) .. '" was not found.')
	end
	return record_for_entry(entry)
end

function romdir.lookup(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end

function romdir.image(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id, kind_image)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end

function romdir.texture(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id, kind_texture)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end

function romdir.system_image(id)
	local entry<const> = find_in_roms(system_roms, id, kind_image)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end

function romdir.audio(id)
	local entry<const> = find_in_roms(active_roms, id, kind_audio)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end


function romdir.aem_event_maps()
	local entries<const> = list_entries(active_roms, kind_aem)
	local out<const> = {}
	for index = 1, #entries do
		out[index] = decode_payload(entries[index])
	end
	return out
end

return romdir
