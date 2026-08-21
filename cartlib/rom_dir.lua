local bin<const> = require('cartlib/bin')
local string_lib<const> = string
local table_lib<const> = table

local rom_dir<const> = {}

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
local kind_collision_shape<const> = 5
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
	[kind_collision_shape] = 'collision_shape',
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

-- The directory indexes raw TOC addresses rather than materializing one Lua
-- graph per ROM entry. The high token word and kind remain in ROM and are
-- verified on lookup; only an actual low-word collision allocates a side list.
local register_entry_base<const> = function(rom, token_lo, entry_base)
	local primary_entry_base<const> = rom.entry_base_by_token_lo[token_lo]
	if primary_entry_base == nil then
		rom.entry_base_by_token_lo[token_lo] = entry_base
		return
	end
	local collision_entries_by_token_lo = rom.collision_entries_by_token_lo
	if collision_entries_by_token_lo == nil then
		collision_entries_by_token_lo = {}
		rom.collision_entries_by_token_lo = collision_entries_by_token_lo
	end
	local collision_entries = collision_entries_by_token_lo[token_lo]
	if collision_entries == nil then
		collision_entries = {}
		collision_entries_by_token_lo[token_lo] = collision_entries
	end
	collision_entries[#collision_entries + 1] = entry_base
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

	local rom<const> = {
		header = header,
		toc_base = toc_base,
		entry_count = entry_count,
		string_table_offset = toc_header_size + entry_count * toc_entry_size,
		entry_base_by_token_lo = {},
		record_by_entry_base = {},
	}
	for index = 0, entry_count - 1 do
		local entry_base<const> = toc_base + toc_header_size + index * toc_entry_size
		local packed_entry<const>: *word = entry_base
		register_entry_base(rom, packed_entry[toc_entry_token_lo_index], entry_base)
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

local entry_matches<const> = function(entry_base, token_hi, kind)
	local entry<const>: *word = entry_base
	return entry[toc_entry_token_hi_index] == token_hi
		and (kind == nil or entry[toc_entry_kind_index] == kind)
end

local find_by_token<const> = function(rom, token_lo, token_hi, kind)
	local entry_base<const> = rom.entry_base_by_token_lo[token_lo]
	local found
	if entry_base ~= nil and entry_matches(entry_base, token_hi, kind) then
		found = entry_base
	end
	local collision_entries_by_token_lo<const> = rom.collision_entries_by_token_lo
	if collision_entries_by_token_lo ~= nil then
		local collision_entries<const> = collision_entries_by_token_lo[token_lo]
		if collision_entries ~= nil then
			for index = 1, #collision_entries do
				local collision_entry_base<const> = collision_entries[index]
				if entry_matches(collision_entry_base, token_hi, kind) then
					if found ~= nil and kind == nil then
						error('ROM lookup is ambiguous; pass a TOC kind.')
					end
					found = collision_entry_base
				end
			end
		end
	end
	return found
end

local find_in_roms<const> = function(roms, id, kind)
	local token_lo<const>, token_hi<const> = hash_id(id)
	for index = 1, #roms do
		local rom<const> = roms[index]
		local entry_base<const> = find_by_token(rom, token_lo, token_hi, kind)
		if entry_base ~= nil then
			local entry<const>: *word = entry_base
			if entry[toc_entry_op_index] == op_delete then
				return nil
			end
			return rom, entry_base
		end
	end
	return nil
end

local decode_payload<const> = function(record)
	if record.payload_loaded then
		return record.payload_value
	end
	record.payload_loaded = true
	record.payload_value = bin.decode(record.addr, record.resid)
	return record.payload_value
end

local decode_meta<const> = function(rom, id, meta_addr, meta_len, meta_start, meta_finish)
	if meta_len == 0 then
		return nil
	end
	local header<const> = rom.header
	if header.metadata_prop_names ~= nil
	and meta_start >= header.metadata_payload_off
	and meta_finish <= header.metadata_off + header.metadata_len then
		return bin.decode_with_props(
			meta_addr,
			header.metadata_prop_names,
			id .. ' metadata'
		)
	end
	return bin.decode(meta_addr, id .. ' metadata')
end

local record_for_entry<const> = function(rom, entry_base, id)
	local cached<const> = rom.record_by_entry_base[entry_base]
	if cached ~= nil then
		return cached
	end
	local entry<const>: *word = entry_base
	local addr<const>, len<const> = entry_span(
		rom.header.rom_base,
		entry[toc_entry_data_start_index],
		entry[toc_entry_data_end_index]
	)
	local meta_addr<const>, meta_len<const>, meta_start<const>, meta_finish<const> = entry_span(
		rom.header.rom_base,
		entry[toc_entry_metadata_start_index],
		entry[toc_entry_metadata_end_index]
	)
	local kind<const> = entry[toc_entry_kind_index]
	local record<const> = {
		resid = id,
		type = kind_name_by_id[kind],
		addr = addr,
		len = len,
	}
	rom.record_by_entry_base[entry_base] = record
	local meta<const> = decode_meta(rom, id, meta_addr, meta_len, meta_start, meta_finish)
	if meta ~= nil then
		record.meta = meta
	end
	if kind == kind_image then
		record.imgmeta = meta
		record.collision_addr = entry_span(
			rom.header.rom_base,
			entry[toc_entry_collision_start_index],
			entry[toc_entry_collision_end_index]
		)
	elseif kind == kind_texture then
		record.texturemeta = meta
	elseif kind == kind_audio then
		record.audiometa = meta
	end
	return record
end

local list_entries<const> = function(roms, kind)
	local out<const> = {}
	local blocked<const> = {}
	for rom_index = 1, #roms do
		local rom<const> = roms[rom_index]
		for entry_index = 0, rom.entry_count - 1 do
			local entry_base<const> = rom.toc_base + toc_header_size + entry_index * toc_entry_size
			local entry<const>: *word = entry_base
			if kind == nil or entry[toc_entry_kind_index] == kind then
				local id<const> = read_toc_string(
					rom.toc_base,
					rom.string_table_offset,
					entry[toc_entry_resid_index],
					entry[toc_entry_resid_length_index]
				)
				if not blocked[id] then
					blocked[id] = true
					if entry[toc_entry_op_index] ~= op_delete then
						out[#out + 1] = record_for_entry(rom, entry_base, id)
					end
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

function rom_dir.reload_cartridge_directory()
	local cart_rom<const> = parse_rom(read_header(cart_rom_base))
	active_roms[1] = cart_rom
	active_plus_system_roms[1] = cart_rom
end

function rom_dir.resource(id)
	local rom<const>, entry_base<const> = find_in_roms(active_plus_system_roms, id)
	if rom == nil then
		error('ROM resource "' .. tostring(id) .. '" was not found.')
	end
	return record_for_entry(rom, entry_base, id)
end

function rom_dir.lookup(id)
	local rom<const>, entry_base<const> = find_in_roms(active_plus_system_roms, id)
	if rom == nil then
		return nil
	end
	return record_for_entry(rom, entry_base, id)
end

function rom_dir.image(id)
	local rom<const>, entry_base<const> = find_in_roms(active_plus_system_roms, id, kind_image)
	if rom == nil then
		return nil
	end
	return record_for_entry(rom, entry_base, id)
end

function rom_dir.texture(id)
	local rom<const>, entry_base<const> = find_in_roms(active_plus_system_roms, id, kind_texture)
	if rom == nil then
		return nil
	end
	return record_for_entry(rom, entry_base, id)
end

function rom_dir.system_image(id)
	local rom<const>, entry_base<const> = find_in_roms(system_roms, id, kind_image)
	if rom == nil then
		return nil
	end
	return record_for_entry(rom, entry_base, id)
end

function rom_dir.audio(id)
	local rom<const>, entry_base<const> = find_in_roms(active_roms, id, kind_audio)
	if rom == nil then
		return nil
	end
	return record_for_entry(rom, entry_base, id)
end


function rom_dir.aem_event_maps()
	local entries<const> = list_entries(active_roms, kind_aem)
	local out<const> = {}
	for index = 1, #entries do
		out[index] = decode_payload(entries[index])
	end
	return out
end

return rom_dir
