module<const>

-- Source basis: 9b002adf22c0a496d45fac0bca5cab2030cda3b9.
-- T/C/H = mirrored Tables and native header, N/P = CPU allocation paths,
-- U/V/W = GC control owners, J/K = Value tags, and M = RAM decode.
-- Capacity planning and mutator register publication belong to the caller.
local reserve<const> = require('kernel/dlmalloc_record') -- N:465-466 P:87-89
local collector<const> = require('kernel/gc_control') -- N:474 P:97 U:133-141 V:235-244
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- T:147,154 C:485,495 M:9
local table_kind<const> = 6 -- T:60 C:23 J:9-11 K:21-23
local new_index_absent_byte<const> = 2 -- T:34,60 C:24 H:31
local byte_link_capacity<const> = 128 -- T:94,97 H:44,47
local hash_census_limit<const> = 64 -- T:95,159 H:45 C:501

struct table_creation_header
	kind: u32 -- T:34,61 C:25 H:27
	gray: u32 -- T:34,61 C:25 H:27
	metatable: addr -- T:34,62 C:26 H:27
	hash_storage: addr -- T:34,137 N:466 C:30 H:27,55 P:89
	array_capacity: u32 -- T:34,63 C:27 H:27
	hash_capacity: u32 -- T:34,63 C:27 H:27
	length: u32 -- T:34,64 C:28 H:27
	free: i32 -- T:34,64 C:28 H:27
	array_storage: addr -- T:34,136 N:466 C:29 H:27,56 P:88
end

-- Each native byte fill is one range. Keep its boundaries; use word
-- stores inside them and byte stores only for the unaligned edges.
local fill_backing<const> = function(first, finish, word) -- T:148-150,157-163 C:487-490,498-505
	local byte<const> = word & 0xff -- T:148-149,157-161 C:487-488,498-503
	while first < finish and (first & 3) ~= 0 do -- T:148-149,157-161 C:487-488,498-503
		local cell<const>: *u8 = ram_base + first -- T:148-149,157-161 C:487-488,498-503
		*cell = byte -- T:148-150,157-163 C:487-490,498-505; ordinary private writes track the touched bytes
		first = first + 1 -- T:148-149,157-161 C:487-488,498-503
	end
	local last_word<const> = finish & ~3 -- T:148-149,157-161 C:487-488,498-503
	while first < last_word do -- T:148-149,157-161 C:487-488,498-503
		local cell<const>: *u32 = ram_base + first -- T:148-149,157-161 C:487-488,498-503
		*cell = word -- T:148-150,157-163 C:487-490,498-505; ordinary private writes track the touched bytes
		first = first + 4 -- T:148-149,157-161 C:487-488,498-503
	end
	while first < finish do -- T:148-149,157-161 C:487-488,498-503
		local cell<const>: *u8 = ram_base + first -- T:148-149,157-161 C:487-488,498-503
		*cell = byte -- T:148-150,157-163 C:487-490,498-505
		first = first + 1 -- T:148-149,157-161 C:487-488,498-503
	end
end

local initialize_array<const> = function(address, capacity) -- T:65,144 C:29,483; fresh Table has no retained slots
	if capacity == 0 then return end -- T:145 C:484
	local base<const> = address & ram_word_mask -- T:146-147 C:485-486
	local tags<const> = base + capacity * 4 -- T:147-149 C:485,487-488
	fill_backing(base, tags, 0) -- T:148,150 C:487,490
	fill_backing(tags, base + capacity * 5, 0) -- T:149-150 C:488,490
end

local initialize_hash<const> = function(address, count, storage_bytes) -- T:66,152 C:30,493
	if count == 0 then return end -- T:153 C:494
	local base<const> = address & ram_word_mask -- T:154 C:495-496
	local bytes<const> = count * (count <= byte_link_capacity and 11 or 14) -- T:97,155 C:497 H:47
	local links<const>, nodes_end<const> = base + count * 10, base + bytes -- T:156-158 C:497-500
	fill_backing(base, links, 0) -- T:157,163 C:498,505
	fill_backing(links, nodes_end, 0xffffffff) -- T:158,163 C:499,505; byte or word link lane uses all-one bits
	if count > hash_census_limit then -- T:159 C:501
		fill_backing(nodes_end, base + storage_bytes, 0) -- T:98,160-161,163 N:466 C:502-503,505 H:48 P:89; producer supplied the storage extent
	end
end

local create_table<const> = function(state, control, occupied, array, hash, array_bytes, hash_bytes, charged) -- N:463-466,682-689 P:85-89,120-128
	local offset<const> = reserve.bmsx_dlmalloc_reserve_record(state, sizeof(table_creation_header), 1, array_bytes, offsetof(table_creation_header.array_storage), charged, hash_bytes, offsetof(table_creation_header.hash_storage), occupied) -- T:52-53,98,119 H:43,48 N:465-466 P:87-89
	if offset == 0 then return 0 end -- N:467 P:90
	local address<const> = ram_base + offset -- N:468 P:91
	local header<const>: *table_creation_header = address -- N:472-473 P:95-96 T:58-59 C:22
	local white<const>: *u8 = ram_base + control + collector.internal.white_offset -- T:60 C:23 U:94 W:92
	header.kind = table_kind | ((*white & 1) << 8) | (1 << (8 * new_index_absent_byte)) -- T:60-61 C:23-25
	header.gray = 0 -- T:61 C:25
	header.metatable = 0 -- T:62,121 C:26 H:241
	header.array_capacity = array -- T:63 C:27
	header.hash_capacity = hash -- T:63 C:27
	header.length = 0 -- T:64 C:28
	header.free = hash - 1 -- T:64 C:28
	initialize_array(header.array_storage, array) -- T:65,136 C:29 H:56
	initialize_hash(header.hash_storage, hash, hash_bytes) -- T:66,137 C:30 H:55
	collector.publish_object(control, address) -- N:474 P:97 U:133-141 V:235-244
	return offset -- N:469 P:92; caller owns the local root and destination register
end

return {
	internal = { fill_backing = fill_backing, initialize_array = initialize_array, initialize_hash = initialize_hash },
	create_table = create_table,
}
