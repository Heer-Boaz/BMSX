local bin<const> = require('bios/bin')

local romdir<const> = {}

local cart_magic<const> = sys_cart_magic
local cart_metadata_header_size<const> = 72
local toc_magic_value<const> = 0x434f5442
local toc_header_size<const> = 48
local toc_entry_size<const> = 88
local toc_invalid_u32<const> = 0xffffffff
local op_delete<const> = 1
local hash_prime<const> = 0x1b3
local u32_mod<const> = 0x100000000

local kind_image<const> = 1
local kind_audio<const> = 2
local kind_data<const> = 3
local kind_bin<const> = 4
local kind_atlas<const> = 5
local kind_aem<const> = 8
local kind_lua<const> = 9
local kind_code<const> = 10

local rom_system<const> = 1
local rom_cart<const> = 2
local rom_overlay<const> = 3

local rom_name_by_id<const> = {
	[rom_system] = 'system',
	[rom_cart] = 'cart',
	[rom_overlay] = 'overlay',
}

local kind_name_by_id<const> = {
	[kind_image] = 'image',
	[kind_audio] = 'audio',
	[kind_data] = 'data',
	[kind_bin] = 'bin',
	[kind_atlas] = 'atlas',
	[kind_aem] = 'aem',
	[kind_lua] = 'lua',
	[kind_code] = 'code',
}

local assert_range<const> = function(offset, length, limit, label)
	if offset < 0 or length < 0 or offset + length > limit then
		error(label .. ' range is outside ROM data.')
	end
end

local read_header<const> = function(rom_base, label, required)
	if mem[rom_base] ~= cart_magic then
		if required then
			error(label .. ' ROM header is missing.')
		end
		return nil
	end
	local header_size<const> = mem[rom_base + 4]
	local has_metadata_header<const> = header_size >= cart_metadata_header_size
	return {
		rom_base = rom_base,
		label = label,
		manifest_off = mem[rom_base + 8],
		manifest_len = mem[rom_base + 12],
		toc_off = mem[rom_base + 16],
		toc_len = mem[rom_base + 20],
		data_off = mem[rom_base + 24],
		data_len = mem[rom_base + 28],
		metadata_off = has_metadata_header and mem[rom_base + 64] or 0,
		metadata_len = has_metadata_header and mem[rom_base + 68] or 0,
		metadata_payload_off = 0,
		metadata_prop_names = nil,
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
	if kind_map[entry.kind] ~= nil then
		error(rom.label .. ' ROM TOC has duplicate resource token.')
	end
	kind_map[entry.kind] = entry
end

local entry_span<const> = function(header, section_off, section_len, start, finish, label)
	if start == toc_invalid_u32 and finish == toc_invalid_u32 then
		return nil, nil, 0, 0
	end
	if start == toc_invalid_u32 or finish == toc_invalid_u32 then
		error(label .. ' has an incomplete ROM span.')
	end
	if finish < start then
		error(label .. ' span ends before it starts.')
	end
	if start < section_off or finish > section_off + section_len then
		error(label .. ' span is outside its ROM section.')
	end
	return start, finish, header.rom_base + start, finish - start
end

local read_toc_string<const> = function(toc_base, string_table_offset, string_table_length, offset, length, label)
	if offset == toc_invalid_u32 then
		if length ~= 0 then
			error(label .. ' has an invalid string reference.')
		end
		return nil
	end
	assert_range(offset, length, string_table_length, label)
	if length == 0 then
		return ''
	end
	local source<const> = toc_base + string_table_offset + offset
	local out<const> = {}
	local chunk<const> = {}
	local chunk_len = 0
	for index = 0, length - 1 do
		chunk_len = chunk_len + 1
		chunk[chunk_len] = mem8[source + index]
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

local parse_metadata_header<const> = function(header)
	if header.metadata_len == 0 then
		return
	end
	local names<const>, payload_off<const> = bin.read_metadata_prop_names(header.rom_base + header.metadata_off, header.metadata_len)
	header.metadata_prop_names = names
	header.metadata_payload_off = header.metadata_off + payload_off
end

local parse_rom<const> = function(header, rom_id)
	if header.toc_len < toc_header_size then
		error(header.label .. ' ROM TOC is too small.')
	end
	parse_metadata_header(header)
	local toc_base<const> = header.rom_base + header.toc_off
	if mem[toc_base] ~= toc_magic_value then
		error(header.label .. ' ROM TOC magic is invalid.')
	end
	if mem[toc_base + 4] ~= toc_header_size then
		error(header.label .. ' ROM TOC header size is invalid.')
	end
	local entry_size<const> = mem[toc_base + 8]
	if entry_size ~= toc_entry_size then
		error(header.label .. ' ROM TOC entry size is invalid.')
	end
	local entry_count<const> = mem[toc_base + 12]
	local entry_offset<const> = mem[toc_base + 16]
	if entry_offset ~= toc_header_size then
		error(header.label .. ' ROM TOC entry offset is invalid.')
	end
	local string_table_offset<const> = mem[toc_base + 20]
	local string_table_length<const> = mem[toc_base + 24]
	local entries_bytes<const> = entry_count * entry_size
	if string_table_offset ~= entry_offset + entries_bytes then
		error(header.label .. ' ROM TOC string table offset is invalid.')
	end
	assert_range(entry_offset, entries_bytes, header.toc_len, header.label .. ' TOC entries')
	assert_range(string_table_offset, string_table_length, header.toc_len, header.label .. ' TOC strings')

	local rom<const> = {
		id = rom_id,
		label = header.label,
		header = header,
		tokens = {},
		entries = {},
	}
	for index = 0, entry_count - 1 do
		local entry_base<const> = toc_base + entry_offset + index * entry_size
		local payload_start<const>, payload_end<const>, payload_addr<const>, payload_len<const> = entry_span(header, header.data_off, header.data_len, mem[entry_base + 40], mem[entry_base + 44], header.label .. ' payload')
		local compiled_start<const>, compiled_end<const>, compiled_addr<const>, compiled_len<const> = entry_span(header, header.data_off, header.data_len, mem[entry_base + 48], mem[entry_base + 52], header.label .. ' compiled payload')
		local meta_start<const>, meta_end<const>, meta_addr<const>, meta_len<const> = entry_span(header, header.metadata_off, header.metadata_len, mem[entry_base + 56], mem[entry_base + 60], header.label .. ' metadata')
		local texture_start<const>, texture_end<const>, texture_addr<const>, texture_len<const> = entry_span(header, header.data_off, header.data_len, mem[entry_base + 64], mem[entry_base + 68], header.label .. ' texture')
		local collision_start<const>, collision_end<const>, collision_addr<const>, collision_len<const> = entry_span(header, header.data_off, header.data_len, mem[entry_base + 72], mem[entry_base + 76], header.label .. ' collision')
		local id<const> = read_toc_string(toc_base, string_table_offset, string_table_length, mem[entry_base + 16], mem[entry_base + 20], header.label .. ' resid')
		if not id or #id == 0 then
			error(header.label .. ' ROM TOC entry is missing an id.')
		end
		local source_path<const> = read_toc_string(toc_base, string_table_offset, string_table_length, mem[entry_base + 24], mem[entry_base + 28], header.label .. ' source path')
		local normalized_source_path<const> = read_toc_string(toc_base, string_table_offset, string_table_length, mem[entry_base + 32], mem[entry_base + 36], header.label .. ' normalized source path')
		local entry<const> = {
			id = id,
			token_lo = mem[entry_base],
			token_hi = mem[entry_base + 4],
			kind = mem[entry_base + 8],
			op = mem[entry_base + 12],
			rom = rom,
			rom_id = rom_id,
			type = kind_name_by_id[mem[entry_base + 8]],
			source_path = source_path,
			normalized_source_path = normalized_source_path,
			start = payload_start,
			finish = payload_end,
			addr = payload_addr,
			len = payload_len,
			compiled_start = compiled_start,
			compiled_finish = compiled_end,
			compiled_addr = compiled_addr,
			compiled_len = compiled_len,
			meta_start = meta_start,
			meta_finish = meta_end,
			meta_addr = meta_addr,
			meta_len = meta_len,
			texture_start = texture_start,
			texture_finish = texture_end,
			texture_addr = texture_addr,
			texture_len = texture_len,
			collision_start = collision_start,
			collision_finish = collision_end,
			collision_addr = collision_addr,
			collision_len = collision_len,
			update_timestamp = mem[entry_base + 80] + (mem[entry_base + 84] * u32_mod),
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
		local xored_lo<const> = (lo ~ string.byte(id, index)) % u32_mod
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

local find_image_in_roms<const> = function(roms, id)
	local token_lo<const>, token_hi<const> = hash_id(id)
	for index = 1, #roms do
		local rom<const> = roms[index]
		local entry<const> = find_by_token(rom, token_lo, token_hi, kind_image) or find_by_token(rom, token_lo, token_hi, kind_atlas)
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
	entry.payload_value = bin.decode(entry.addr, entry.len, entry.id)
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
		entry.meta_value = bin.decode_with_props(entry.meta_addr, entry.meta_len, header.metadata_prop_names, entry.id .. ' metadata')
	else
		entry.meta_value = bin.decode(entry.meta_addr, entry.meta_len, entry.id .. ' metadata')
	end
	return entry.meta_value
end

local set_if_present<const> = function(out, key, value)
	if value ~= nil then
		out[key] = value
	end
end

local record_for_entry<const> = function(entry)
	if entry.record ~= nil then
		return entry.record
	end
	local out<const> = {
		resid = entry.id,
		type = entry.type,
		payload_id = rom_name_by_id[entry.rom_id],
		addr = entry.addr,
		len = entry.len,
	}
	set_if_present(out, 'source_path', entry.source_path)
	set_if_present(out, 'normalized_source_path', entry.normalized_source_path)
	set_if_present(out, 'start', entry.start)
	set_if_present(out, 'end', entry.finish)
	set_if_present(out, 'compiled_start', entry.compiled_start)
	set_if_present(out, 'compiled_end', entry.compiled_finish)
	set_if_present(out, 'compiled_addr', entry.compiled_addr)
	set_if_present(out, 'compiled_len', entry.compiled_len)
	set_if_present(out, 'metabuffer_start', entry.meta_start)
	set_if_present(out, 'metabuffer_end', entry.meta_finish)
	set_if_present(out, 'metabuffer_addr', entry.meta_addr)
	set_if_present(out, 'metabuffer_len', entry.meta_len)
	set_if_present(out, 'texture_start', entry.texture_start)
	set_if_present(out, 'texture_end', entry.texture_finish)
	set_if_present(out, 'texture_addr', entry.texture_addr)
	set_if_present(out, 'texture_len', entry.texture_len)
	set_if_present(out, 'collision_bin_start', entry.collision_start)
	set_if_present(out, 'collision_bin_end', entry.collision_finish)
	set_if_present(out, 'collision_addr', entry.collision_addr)
	set_if_present(out, 'collision_len', entry.collision_len)
	if entry.update_timestamp ~= 0 then
		out.update_timestamp = entry.update_timestamp
	end
	local meta<const> = decode_meta(entry)
	if entry.kind == kind_image or entry.kind == kind_atlas then
		out.imgmeta = meta
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

local cart_header<const> = read_header(sys_rom_cart_base, 'cart', false)
local overlay_header = nil
if sys_rom_overlay_size > 0 then
	overlay_header = read_header(sys_rom_overlay_base, 'overlay', false)
end

local system_rom<const> = parse_rom(read_header(sys_rom_system_base, 'system', true), rom_system)
local cart_rom = nil
if cart_header ~= nil then
	cart_rom = parse_rom(cart_header, rom_cart)
end
local overlay_rom = nil
if overlay_header ~= nil then
	overlay_rom = parse_rom(overlay_header, rom_overlay)
end

local active_roms<const> = {}
if overlay_rom ~= nil then
	active_roms[#active_roms + 1] = overlay_rom
end
if cart_rom ~= nil then
	active_roms[#active_roms + 1] = cart_rom
end
if #active_roms == 0 then
	active_roms[#active_roms + 1] = system_rom
end

local active_plus_system_roms<const> = {}
for index = 1, #active_roms do
	active_plus_system_roms[#active_plus_system_roms + 1] = active_roms[index]
end
if cart_rom ~= nil then
	active_plus_system_roms[#active_plus_system_roms + 1] = system_rom
end

local system_roms<const> = { system_rom }

function romdir.cart(id)
	local entry<const> = find_in_roms(active_roms, id)
	if entry == nil then
		error('cart ROM entry "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.cart_atlas(id)
	local entry<const> = find_in_roms(active_roms, id, kind_atlas)
	if entry == nil then
		error('cart atlas ROM entry "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.system(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id)
	if entry == nil then
		error('system ROM entry "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.system_rom_atlas(id)
	local entry<const> = find_in_roms(system_roms, id, kind_atlas)
	if entry == nil then
		error('system ROM atlas entry "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.lookup(id)
	local entry<const> = find_in_roms(active_plus_system_roms, id)
	return entry
end

function romdir.image(id)
	local entry<const> = find_image_in_roms(active_plus_system_roms, id)
	if entry == nil then
		return nil
	end
	return record_for_entry(entry)
end

function romdir.system_image(id)
	local entry<const> = find_image_in_roms(system_roms, id)
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

function romdir.data(id)
	local entry<const> = find_in_roms(active_roms, id, kind_data)
	if entry == nil then
		return nil
	end
	return decode_payload(entry)
end

function romdir.data_entries()
	local entries<const> = list_entries(active_roms, kind_data)
	local out<const> = {}
	for index = 1, #entries do
		local entry<const> = entries[index]
		out[index] = {
			id = entry.id,
			value = decode_payload(entry),
		}
	end
	return out
end

function romdir.audioevents()
	local entries<const> = list_entries(active_roms, kind_aem)
	local out<const> = {}
	for index = 1, #entries do
		local entry<const> = entries[index]
		out[entry.id] = decode_payload(entry)
	end
	return out
end

return romdir
