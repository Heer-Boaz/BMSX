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
local kind_atlas<const> = 5

local layer_system<const> = 1
local layer_cart<const> = 2
local layer_overlay<const> = 3

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
	}
end

local layer_insert_token<const> = function(layer, entry)
	local hi_map = layer.tokens[entry.token_hi]
	if hi_map == nil then
		hi_map = {}
		layer.tokens[entry.token_hi] = hi_map
	end
	local kind_map = hi_map[entry.token_lo]
	if kind_map == nil then
		kind_map = {}
		hi_map[entry.token_lo] = kind_map
	end
	if kind_map[entry.kind] ~= nil then
		error(layer.label .. ' ROM TOC has duplicate resource token.')
	end
	kind_map[entry.kind] = entry
end

local entry_span<const> = function(rom_base, payload_limit, start, finish, label)
	if start == toc_invalid_u32 and finish == toc_invalid_u32 then
		return 0, 0
	end
	if start == toc_invalid_u32 or finish == toc_invalid_u32 then
		error(label .. ' has an incomplete ROM span.')
	end
	if finish < start then
		error(label .. ' span ends before it starts.')
	end
	assert_range(start, finish - start, payload_limit, label)
	return rom_base + start, finish - start
end

local parse_layer<const> = function(header, layer_id)
	if header.toc_len < toc_header_size then
		error(header.label .. ' ROM TOC is too small.')
	end
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

	local layer<const> = {
		id = layer_id,
		label = header.label,
		tokens = {},
	}
	local data_limit<const> = header.data_off + header.data_len
	local metadata_limit<const> = header.metadata_off + header.metadata_len
	for index = 0, entry_count - 1 do
		local entry_base<const> = toc_base + entry_offset + index * entry_size
		local token_lo<const> = mem[entry_base]
		local token_hi<const> = mem[entry_base + 4]
		local kind<const> = mem[entry_base + 8]
		local op<const> = mem[entry_base + 12]
		local payload_addr<const>, payload_len<const> = entry_span(header.rom_base, data_limit, mem[entry_base + 40], mem[entry_base + 44], header.label .. ' payload')
		local compiled_addr<const>, compiled_len<const> = entry_span(header.rom_base, data_limit, mem[entry_base + 48], mem[entry_base + 52], header.label .. ' compiled payload')
		local meta_addr<const>, meta_len<const> = entry_span(header.rom_base, metadata_limit, mem[entry_base + 56], mem[entry_base + 60], header.label .. ' metadata')
		local texture_addr<const>, texture_len<const> = entry_span(header.rom_base, data_limit, mem[entry_base + 64], mem[entry_base + 68], header.label .. ' texture')
		local collision_addr<const>, collision_len<const> = entry_span(header.rom_base, data_limit, mem[entry_base + 72], mem[entry_base + 76], header.label .. ' collision')
		layer_insert_token(layer, {
			token_lo = token_lo,
			token_hi = token_hi,
			kind = kind,
			op = op,
			layer = layer_id,
			addr = payload_addr,
			len = payload_len,
			compiled_addr = compiled_addr,
			compiled_len = compiled_len,
			meta_addr = meta_addr,
			meta_len = meta_len,
			texture_addr = texture_addr,
			texture_len = texture_len,
			collision_addr = collision_addr,
			collision_len = collision_len,
		})
	end
	return layer
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

local find_in_layer<const> = function(layer, token_lo, token_hi, kind)
	if layer == nil then
		return nil
	end
	local hi_map<const> = layer.tokens[token_hi]
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
			error('resource lookup is ambiguous; pass a resource kind.')
		end
		found = entry
	end
	return found
end

local find_in_layers<const> = function(layers, id, kind)
	local token_lo<const>, token_hi<const> = hash_id(id)
	for index = #layers, 1, -1 do
		local entry<const> = find_in_layer(layers[index], token_lo, token_hi, kind)
		if entry ~= nil then
			if entry.op == op_delete then
				return nil
			end
			return entry
		end
	end
	return nil
end

local cart_header<const> = read_header(sys_rom_cart_base, 'cart', false)
local overlay_header = nil
if sys_rom_overlay_size > 0 then
	overlay_header = read_header(sys_rom_overlay_base, 'overlay', false)
end

local cart_layer = nil
if cart_header ~= nil then
	cart_layer = parse_layer(cart_header, layer_cart)
end
local overlay_layer = nil
if overlay_header ~= nil then
	overlay_layer = parse_layer(overlay_header, layer_overlay)
end

local system_layer<const> = parse_layer(read_header(sys_rom_system_base, 'system', true), layer_system)
local cart_layers<const> = { cart_layer, overlay_layer }
local system_rom_layers<const> = { system_layer }
local system_layers<const> = { system_layer, cart_layer, overlay_layer }

function romdir.cart(id)
	local entry<const> = find_in_layers(cart_layers, id)
	if entry == nil then
		error('cart resource "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.cart_atlas(id)
	local entry<const> = find_in_layers(cart_layers, id, kind_atlas)
	if entry == nil then
		error('cart atlas resource "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.system(id)
	local entry<const> = find_in_layers(system_layers, id)
	if entry == nil then
		error('system resource "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.system_rom_atlas(id)
	local entry<const> = find_in_layers(system_rom_layers, id, kind_atlas)
	if entry == nil then
		error('system ROM atlas resource "' .. tostring(id) .. '" was not found.')
	end
	return entry
end

function romdir.lookup(id)
	return find_in_layers(system_layers, id)
end

return romdir
