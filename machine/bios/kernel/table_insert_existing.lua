module<const>

-- Source basis: 45025f5cd2063d4c4b2315b9de8ea19f1956b4ae.
-- T/C/H: mirrored Tables; V/W: Value; M: RAM. General recovery retries
-- the absent canonical key in its old backing before planning again.
-- A nonnegative result is the inserted node; -1 leaves the backing alone.
local reinsert<const> = require('kernel/table_reinsert') -- T:598-599,608-635 C:559-597; packed slots, links and free search are shared
local tables<const> = require('kernel/table_create') -- T:98,108,612 C:638,644 H:47,270
local allocator<const> = require('kernel/dlmalloc') -- T:102 H:275; nonzero highest bit
local barrier<const> = require('kernel/gc_barrier') -- T:619 C:643; existing-table cursor and rescan side effects
local layout<const> = require('kernel/gc_runtime_layout') -- M:6
local ram_base<const> = layout.ram_base -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9
local nil_tag<const> = 0 -- V:9-11 W:21-22
local integer_tag<const> = 3 -- V:9-11 W:21-22
local census_limit<const> = 64 -- T:96 H:45
local band_capacity<const> = 1024 -- T:97 H:46
local next_end<const> = -1 -- T:17 C:17,590
local full<const> = -1 -- T:612,614,809 C:573,638

struct existing_hash_table
	before_hash_storage: u32[3] -- T:35-36 H:26-28
	hash_storage: addr -- T:36,138,806 H:27,55
	array: u32 -- T:36 H:27
	hash: u32 -- T:36,134,805 C:370 H:27,58
	length: u32 -- T:36 H:27
	free: i32 -- T:36,136,615 C:639-640 H:27,60
end

local insert_hash_without_growth<const> = function(control, record, kt, kw, vt, vw, replace_color_byte) -- T:602-636,805-809 C:369-373,636-645
	local header<const>: *existing_hash_table = ram_base + (record & ram_word_mask) -- T:121,136,138 C:370 H:240-241
	local hash<const> = header.hash -- T:761-762,805 C:309,369-370 H:58; the rooted Table's layout did not change in collection
	if hash == 0 then return full end -- T:805 C:369; unlike an existing home, zero buckets have no candidate
	local words<const> = ram_base + (header.hash_storage & ram_word_mask) -- T:138,806 C:370 H:55,247
	local tag_base<const> = words + 8 * hash -- T:806 H:267,280
	local tags<const>: *u8 = tag_base -- T:604,606 H:254
	local main<const> = reinsert.internal.hash_canonical_table_key(kt, kw) & (hash - 1) -- T:807 C:371
	local value_slot<const> = main + hash -- T:605 C:564
	local key_tag<const> = tags[main] -- T:606 C:565
	local live_address = 0 -- T:98,108,612 C:638,644 H:270; only larger tables have this word
	if hash > census_limit then live_address = words + tables.internal.hash_node_bytes(hash) end -- T:98,107-109,612 C:638,644 H:270
	local slot -- T:609,631,635 C:569,591,597,636
	if key_tag == nil_tag or tags[value_slot] == nil_tag then -- T:608 C:566; both tombstone forms are reusable at home
		reinsert.internal.write_slot(words, tag_base, main, kt, kw) -- T:609 C:567
		reinsert.internal.write_slot(words, tag_base, value_slot, vt, vw) -- T:609 C:568
		slot = main -- T:609 C:569; keep the existing chain and free cursor
	else -- T:611 C:571
		local payloads<const>: *u32 = words -- T:611 C:571 H:255
		local key_word<const> = payloads[main] -- T:611 C:571
		if hash > census_limit then -- T:612 C:638
			local live<const>: *u32 = live_address -- T:612 C:638 H:270-271
			if *live == hash then return full end -- T:612 C:638
		end
		local free<const> = reinsert.internal.find_free_index(tag_base, hash, header.free) -- T:594-600,613 C:639; only both Nil-tag lanes are free off-home
		if free < 0 then return full end -- T:614 C:573,640-641
		header.free = free - 1 -- T:615 C:640; publish BEFORE any move or chain write
		local free_value<const> = free + hash -- T:616 C:574,579
		local occupied_main<const> = reinsert.internal.hash_canonical_table_key(key_tag, key_word) & (hash - 1) -- T:617 C:575
		local links<const> = tag_base + 2 * hash -- T:604 H:280
		if occupied_main ~= main then -- T:618 C:576
			barrier.table_entries_moved(control, record, replace_color_byte) -- T:619 C:577,643; drop collector Trace/Mode cursor before relocation
			reinsert.internal.write_slot(words, tag_base, free, key_tag, key_word) -- T:620 C:578
			reinsert.internal.write_slot(words, tag_base, free_value, tags[value_slot], payloads[value_slot]) -- T:621 C:579
			local next<const> = reinsert.internal.hash_next(links, hash, main) -- T:622 C:580
			reinsert.internal.set_hash_next(links, hash, free, next) -- T:622 C:580
			local previous = occupied_main -- T:623 C:581
			for remaining = hash, 1, -1 do -- T:624 C:582
				local next<const> = reinsert.internal.hash_next(links, hash, previous) -- T:625 C:583
				if next == main or next < 0 then break end -- T:626 C:584
				previous = next -- T:627 C:585
			end
			reinsert.internal.set_hash_next(links, hash, previous, free) -- T:629 C:587
			reinsert.internal.write_slot(words, tag_base, main, kt, kw) -- T:630 C:588
			reinsert.internal.write_slot(words, tag_base, value_slot, vt, vw) -- T:630 C:589
			reinsert.internal.set_hash_next(links, hash, main, next_end) -- T:631 C:590
			slot = main -- T:631 C:591
		else -- T:633 C:593
			reinsert.internal.write_slot(words, tag_base, free, kt, kw) -- T:633 C:593
			reinsert.internal.write_slot(words, tag_base, free_value, vt, vw) -- T:633 C:594
			local next<const> = reinsert.internal.hash_next(links, hash, main) -- T:634 C:595
			reinsert.internal.set_hash_next(links, hash, free, next) -- T:634 C:595
			reinsert.internal.set_hash_next(links, hash, main, free) -- T:635 C:596
			slot = free -- T:635 C:597
		end
	end
	if hash > census_limit then -- T:107,809 C:644
		local live<const>: *u32 = live_address -- T:108 C:644 H:270-272
		*live = *live + 1 -- T:109,809 C:644
		if hash >= band_capacity and kt == integer_tag and kw > 0 then -- T:101,809 C:644 H:274
			local index<const> = kw - 1 -- T:102 H:275
			local bin<const> = index == 0 and 0 or allocator.internal.highest_bit(index) + 1 -- T:102 H:275
			local band<const>: *u32 = live_address + 4 * (bin + 1) -- T:103 H:276
			*band = *band + 1 -- T:104,809 H:277
		end
	end
	return slot -- T:809 C:373,645; caller owns successful insertion's barrier and length
end

return { insert_hash_without_growth = insert_hash_without_growth }
