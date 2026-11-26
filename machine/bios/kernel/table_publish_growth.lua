module<const>

-- Source basis: f2aac88e703a8d8fe40beb96163224142d11e98a.
-- T/C/H = mirrored Table owners; U/V/W = collector; M = RAM.
-- Immediate resize only, after successful reservation. The caller still
-- owns the old backing views, tag movement, reinsertions, and charge.
local barrier<const> = require('kernel/gc_barrier') -- T:830 C:383 U:252-260 V:155-163
local table_create<const> = require('kernel/table_create') -- T:152-164,834 C:390,493-506
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9 T:121 H:241

struct growth_publication_header
	before_hash: u32[3] -- T:33-34 H:26-27
	hash_storage: addr -- T:34,140 H:27,55 C:478
	array_slots: u32 -- T:34,831 H:27 C:387
	hash_slots: u32 -- T:34,141 H:27 C:479
	length: u32 -- T:34 H:27
	free: i32 -- T:34,142 H:27 C:480
	array_storage: addr -- T:34,52,833 H:27,43 C:389
end

struct growth_publication_reservation
	hash_storage: addr -- T:806,832,834 C:255,380,388,390; hash address from reserve_table_growth
	array_storage: addr -- T:809,811-812,833 C:258,262-263,380,389; array address from reserve_table_growth
end

local publish_table_growth<const> = function(control, table_address, array_slots, hash_slots, hash_bytes, keep_hash, reservation_offset, replace_color_byte) -- T:801-802,830-834 C:380-381,383,387-390
	local record<const>: *growth_publication_header = ram_base + (table_address & ram_word_mask) -- T:121,831,833 H:241 M:9
	local reservation<const>: *growth_publication_reservation = ram_base + reservation_offset -- T:806,809,832-834 C:255,258,380,388-390; carry the admitted native locals
	local storage<const> = reservation.hash_storage -- T:806,832,834 C:255,380,388,390
	barrier.table_entries_moved(control, table_address, replace_color_byte) -- T:830 U:188-190,198-203,252-260 C:383 V:95-101,155-163 W:159-161; native color byte policy
	record.array_slots = array_slots -- T:831 C:387
	if keep_hash == 0 then -- T:832,139 C:388,477
		record.hash_storage = storage -- T:140 C:478
		record.hash_slots = hash_slots -- T:141 C:479
		record.free = hash_slots - 1 -- T:142 C:480
	end
	record.array_storage = reservation.array_storage -- T:833 C:389
	if keep_hash == 0 then -- T:834 C:390
		table_create.internal.initialize_hash(storage, hash_slots, hash_bytes) -- T:152-164,834 C:390,493-506 H:44-48
	end
end

return { publish_table_growth = publish_table_growth }
