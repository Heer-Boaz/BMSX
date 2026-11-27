module<const>

-- Source basis: 9b002adf22c0a496d45fac0bca5cab2030cda3b9.
-- T/C/H = mirrored Tables and native header, N/P = CPU allocation paths,
-- U/V/W = GC control owners, J/K = Value tags, M = RAM decode,
-- A/B = mirrored integer capacity arithmetic.
local reserve<const> = require('kernel/dlmalloc_record') -- N:465-466 P:87-89
local collector<const> = require('kernel/gc_control') -- N:474 P:97 U:133-141 V:235-244
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- T:147,154 C:485,495 M:9
local table_kind<const> = 6 -- T:60 C:23 J:9-11 K:21-23
local new_index_absent_byte<const> = 2 -- T:34,60 C:24 H:31
local byte_link_capacity<const> = 128 -- T:94,97 H:44,47
local hash_census_limit<const> = 64 -- T:95,159 H:45 C:501
local hash_band_capacity<const> = 1024 -- T:96,98 H:46,48
local header_charge<const> = 32 -- T:53 H:43
local hash_slot_charge<const> = 10 -- T:19,119 C:19,73-74

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

local hash_capacity<const> = function(size) -- T:92 C:77 A:45 B:48
	if size <= 0 then return 0 end -- T:92 C:78-80 A:46-47 B:49-50
	local power = 1 -- A:49 B:52
	while power < size do -- A:50 B:53; the source capacity request fits a signed Integer
		power = power << 1 -- A:51 B:54
	end
	return power -- A:53 B:56
end

local hash_node_bytes<const> = function(hash) -- T:97 H:47
	return hash * (hash <= byte_link_capacity and 11 or 14) -- T:97 H:47
end

local hash_storage_bytes<const> = function(hash) -- T:98 H:48
	local nodes<const> = hash_node_bytes(hash) -- T:98 H:48
	return nodes + (hash > hash_census_limit and 4 or 0) + (hash >= hash_band_capacity and 32 * 4 or 0) -- T:98 H:48
end

local plan_capacity<const> = function(array, hash) -- N:463-466 P:85-89; BMSX copy source C:34-37 T:70-73
	local array_bytes<const> = 5 * array -- N:465 T:118-119 P:87 C:69-74
	local hash_bytes<const> = hash_storage_bytes(hash) -- N:466 T:98 P:89 H:48
	local charge<const> = header_charge + array_bytes + hash_slot_charge * hash -- N:465 T:119 P:88 C:73-75
	local payload<const> = sizeof(table_creation_header) + array_bytes + hash_bytes -- T:52 H:43
	return array_bytes, hash_bytes, charge, payload -- N:465-466 P:87-89; all quantities are latched before admission
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
	local bytes<const> = hash_node_bytes(count) -- T:97,155 C:497 H:47
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

-- Own-Table copy basis: 8cf6e61b2b8207a31ae7be9c7acb095910ff2793.
-- C/T: TableRecord::copyOwn / TableRecords.copyOwn. The C++ order copies
-- array then hash before the header; TS published the header first. Neither
-- exposes the record before linking. Use the C++ store order on both CPUs.
local copy_capacities<const> = function(source) -- C:34 T:70
	local header<const>: *table_creation_header = source -- C:34 T:70
	return header.array_capacity, header.hash_capacity -- C:34 T:70
end

local copy_backing<const> = function(dst, src, bytes) -- C:39-44 T:87-91
	if bytes == 0 then return end -- C:40 T:88
	-- Both allocator pointers are word-aligned. Private stores invalidate
	-- written RAM through the same memory owner that native range copies did.
	local finish<const> = bytes & ~3 -- C:40-43 T:88-90
	local dst_words<const>: *u32 = dst -- C:41 T:89
	local src_words<const>: *u32 = src -- C:41 T:89
	for slot = 0, (finish >> 2) - 1 do -- C:42 T:90
		dst_words[slot] = src_words[slot] -- C:42-43 T:90-91
	end
	local dst_bytes<const>: *u8 = dst_words -- C:42 T:90; trailing byte lanes
	local src_bytes<const>: *u8 = src_words -- C:42 T:90
	for byte = finish, bytes - 1 do -- C:42 T:90
		dst_bytes[byte] = src_bytes[byte] -- C:42-43 T:90-91
	end
end

local copy_table<const> = function(state, control, occupied, source, array, hash, array_bytes, hash_bytes, charged) -- C:33-56 T:69-85
	local offset<const> = reserve.bmsx_dlmalloc_reserve_record(state, sizeof(table_creation_header), 1, array_bytes, offsetof(table_creation_header.array_storage), charged, hash_bytes, offsetof(table_creation_header.hash_storage), occupied) -- C:35-37 T:71-73 L:119-139,152-154 A:109-129,153-155
	if offset == 0 then return 0 end -- L:152-154 A:153-155; refusal precedes the copy.
	local address<const> = ram_base + offset -- C:38 T:71
	local target<const>: *table_creation_header = address -- C:38 T:74-84
	local original<const>: *table_creation_header = source -- C:45-52 T:76-83; admission can clear weak entries
	copy_backing(target.array_storage, original.array_storage, array_bytes) -- C:45 T:82
	copy_backing(target.hash_storage, original.hash_storage, hash_bytes) -- C:46 T:83
	local absent<const>: *u8 = source + new_index_absent_byte -- C:47 T:76
	local white<const>: *u8 = ram_base + control + collector.internal.white_offset -- C:48 T:77
	target.kind = table_kind | ((*white & 1) << 8) | (*absent << (8 * new_index_absent_byte)) -- C:48-50 T:77-78
	target.gray = 0 -- C:50 T:78
	target.metatable = 0 -- C:51 T:79
	target.array_capacity = array -- C:52 T:80
	target.hash_capacity = hash -- C:52 T:80
	target.length = original.length -- C:53 T:81
	target.free = original.free -- C:53 T:81
	collector.publish_object(control, address) -- C:54 T:84
	return offset -- C:55 T:85
end

return {
	internal = {
		fill_backing = fill_backing, initialize_array = initialize_array, initialize_hash = initialize_hash,
		hash_capacity = hash_capacity, hash_storage_bytes = hash_storage_bytes, hash_node_bytes = hash_node_bytes,
		copy_backing = copy_backing,
	},
	plan_capacity = plan_capacity,
	create_table = create_table,
	copy_capacities = copy_capacities,
	copy_table = copy_table,
}
