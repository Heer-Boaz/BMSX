module<const>

-- Source basis: c36fafd44eea29507af392041fda24f433709f18.
-- T/C/H: mirrored Table owners; M: RAM; V/W: Value. An already admitted
-- general immediate resize owns this entire activation. The staged and
-- large hash-only decisions precede it in the caller.
local reserve<const> = require('kernel/table_reserve_growth') -- T:806-817 C:255-268
local publish<const> = require('kernel/table_publish_growth') -- T:830-834 C:383,387-390
local finish<const> = require('kernel/table_finish_resize') -- T:840-869 C:396-424
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- T:120 H:240 M:7-9

struct resize_source_layout
	before_hash: u32[3] -- T:33-34 H:26-27
	hash_storage: addr -- T:34,137,804 H:27,55 C:255,384
	array_slots: u32 -- T:34,132,803 H:27,57 C:257,382
	hash_slots: u32 -- T:34,133,803 H:27,58 C:382
end

struct resize_request
	hash_storage: addr -- T:806,832,834 C:255,388,390; result from reserve
	array_storage: addr -- T:809,833 C:258,389; result from reserve
	key_tag: u32 -- T:801,866 C:380,420 V:23 W:29; start of finish context
	key_word: u32 -- T:801,866 C:380,420 V:24 W:30
	value_tag: u32 -- T:801,866 C:380,420 V:23 W:29
	value_word: u32 -- T:801,866 C:380,420 V:24 W:30
	previous_charge: u32 -- T:801,868 C:380,423
	requested_charge: u32 -- T:801,868 C:380,423
	keep_hash: u32 -- T:802,806,832,834 C:255,381,388,390
	hash_bytes: u32 -- T:98,806,834 C:255,390 H:48; admitted hash extent
end

-- One write order for production on all cores. The C++ reference retains
-- the free cursor locally until its epilogue and writes the whole color byte
-- on collector rescan. The leaves also expose the TS order to reference tests.
local cpp_mirror<const> = 1 -- C:383,396-397,422,596; select the existing C++ policy, not the executing host
local execute_table_resize<const> = function(state, control, occupied, table_address, array, hash, reservation_offset) -- T:801-804 C:249-250,280,380-382
	local table<const>: *resize_source_layout = ram_base + (table_address & ram_word_mask) -- T:120,803-804 H:240 M:9
	-- Reservation can move the backing without changing these header
	-- lanes. Keep the old extents and hash view through publication.
	local old_array<const>, old_hash<const>, old_storage<const> = table.array_slots, table.hash_slots, table.hash_storage -- T:803-804 C:255,257,382,384
	local request<const>: *resize_request = ram_base + reservation_offset -- T:801-802 C:249-250,380-381; admitted request
	local keep_hash<const>, hash_bytes<const> = request.keep_hash, request.hash_bytes -- T:802,806 C:255,381
	local reserved<const> = reserve.reserve_table_growth(state, table_address, array, hash, hash_bytes, keep_hash, 0, reservation_offset) -- T:806-817 C:255-268; no staged backing
	if reserved == 0 then return 0 end -- T:807,813-815 C:256,264-266; preserve the refused attempt, without entering publication
	publish.publish_table_growth(control, table_address, array, hash, hash_bytes, keep_hash, reservation_offset, cpp_mirror) -- T:830-834 C:383,387-390
	finish.finish_table_resize(state, occupied, table_address, old_array, old_hash, old_storage, reservation_offset + offsetof(resize_request.key_tag), cpp_mirror) -- T:840-869 C:396-424
	return 1 -- T:866-869 C:420-424; completed insertion, caller derives any cache slot
end

return { execute_table_resize = execute_table_resize }
