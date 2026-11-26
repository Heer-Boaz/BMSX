module<const>

-- Source basis: c36fafd44eea29507af392041fda24f433709f18.
-- T/C/H: Table; V/W: Value; I/J: String layout.
-- This is the insertion used by immediate resize after its move barrier.
-- Normal stores still own their additional checks and write barriers.
local allocator<const> = require('kernel/dlmalloc') -- T:101 H:267; existing nonzero bit scan
local nil_tag<const> = 0 -- V:9-11 W:21-23
local false_tag<const> = 1 -- V:9-11 W:21-23
local true_tag<const> = 2 -- V:9-11 W:21-23
local integer_tag<const> = 3 -- V:9-11 W:21-23
local string_tag<const> = 5 -- V:9-11 W:21-23
local builtin_tag<const> = 8 -- V:9-11 W:21-23
local string_id_shift<const> = 3 -- I:54 J:60
local byte_link_capacity<const> = 128 -- T:94,110-116 H:44,272-282
local band_capacity<const> = 1024 -- T:96,100 H:46,266
local header_free<const> = 28 -- T:34,135 H:27,60
local next_end<const> = -1 -- T:625 C:555

local hash_canonical_table_key<const> = function(tag, word) -- V:90-104 W:109-126
	if tag == string_tag then return word >> string_id_shift end -- V:102 W:124
	if tag == nil_tag then return 0x27d4eb2d end -- V:98 W:120
	if tag == false_tag then return 0x85ebca6b end -- V:99 W:121
	if tag == true_tag then return 0x9e3779b9 end -- V:100 W:122
	if tag == builtin_tag then return (word + 1) * 0x27d4eb2d end -- V:103 W:125
	-- The remaining canonical key tags mix their payload: Integer, Float,
	-- Table, Closure, Thread. DeadKey belongs only to the retired value lane.
	local bits<const> = (word ~ ((word << 14) | (word >> 18))) * 0x85ebca6b -- V:92-95 W:109-110,113-117
	return bits ~ (bits >> 13) -- V:96 W:117-118; retain the exact low word
end

local write_slot<const> = function(words, tags, slot, tag, word) -- T:180-182 H:251-256
	local payloads<const>: *u32 = words -- T:181 H:252-253
	local tag_bytes<const>: *u8 = tags -- T:182 H:254
	payloads[slot] = word -- T:181 H:253,255; private stores participate in write watching
	tag_bytes[slot] = tag -- T:182 H:254-255
end

local hash_next<const> = function(links, count, slot) -- T:110-112 H:271-275
	if count <= byte_link_capacity then -- T:111 H:273
		local bytes<const>: *u8 = links -- T:111 H:272-273
		return (bytes[slot] ~ 0x80) - 0x80 -- T:111 H:273; sign extension of the byte
	end
	local words<const>: *u32 = links -- T:112 H:272,274
	return words[slot] -- T:112 H:274; u32 load is the signed Integer bit pattern
end

local set_hash_next<const> = function(links, count, slot, next) -- T:114-116 H:276-284
	if count <= byte_link_capacity then -- T:115 H:277
		local bytes<const>: *u8 = links -- T:115 H:278-279
		bytes[slot] = next -- T:115 H:278-279
	else -- T:116 H:280
		local words<const>: *u32 = links -- T:116 H:281-282
		words[slot] = next -- T:116 H:281-282
	end
end

local find_free_index<const> = function(tags, count, first) -- T:588-594 C:143-150
	local bytes<const>: *u8 = tags -- T:589,591 C:146 H:246
	for slot = first, 0, -1 do -- T:590 C:144-145
		if bytes[slot] == nil_tag and bytes[slot + count] == nil_tag then return slot end -- T:591-592 C:146-147
	end
	return -1 -- T:594 C:150
end

local insert_absent_hash_key<const> = function(record, count, words, tags, main, kt, kw, vt, vw, next_free, cpp_mirror) -- T:596-601,643 C:523-530,594-598
	local links<const> = tags + count * 2 -- T:598 H:272,306
	local value_slot<const> = main + count -- T:599 C:529
	local tag_bytes<const>: *u8 = tags -- T:600 C:530 H:246
	local tag<const> = tag_bytes[main] -- T:600 C:530
	if tag == nil_tag or tag_bytes[value_slot] == nil_tag then -- T:602 C:531
		write_slot(words, tags, main, kt, kw) -- T:603 C:532
		write_slot(words, tags, value_slot, vt, vw) -- T:603 C:533
		return main, next_free -- T:603 C:534,594-598; no free candidate was consumed
	end
	local payloads<const>: *u32 = words -- T:605 C:536 H:247
	local word<const> = payloads[main] -- T:605 C:536
	local free_field<const>: *i32 = record + header_free -- T:135,590,609 H:60,241
	if cpp_mirror == 0 then next_free = *free_field end -- T:590 C:595; TS reads the published cursor, C++ carries the local
	local free<const> = find_free_index(tags, count, next_free) -- T:607 C:537,595
	if free < 0 then -- T:608 C:538,596
		if cpp_mirror ~= 0 then next_free = free end -- C:596; C++ latches the failed search before returning
		return -1, next_free -- T:608 C:538
	end
	next_free = free - 1 -- T:609 C:596
	if cpp_mirror == 0 then *free_field = next_free end -- T:609 C:422,596; C++ publishes only in resize's epilogue
	local free_value<const> = free + count -- T:610 C:539,544
	local occupied_main<const> = hash_canonical_table_key(tag, word) & (count - 1) -- T:611 C:540
	if occupied_main ~= main then -- T:612-613 C:541-542; C++ move is empty and TS rebuilding skips the redundant barrier
		write_slot(words, tags, free, tag, word) -- T:614 C:543
		write_slot(words, tags, free_value, tag_bytes[value_slot], payloads[value_slot]) -- T:615 C:544 H:248-249
		local main_next<const> = hash_next(links, count, main) -- T:616 C:545
		set_hash_next(links, count, free, main_next) -- T:616 C:545
		local previous = occupied_main -- T:617 C:546
		for remaining = count, 1, -1 do -- T:618 C:547
			local next<const> = hash_next(links, count, previous) -- T:619 C:548
			if next == main or next < 0 then break end -- T:620 C:549
			previous = next -- T:621 C:550
		end
		set_hash_next(links, count, previous, free) -- T:623 C:552
		write_slot(words, tags, main, kt, kw) -- T:624 C:553
		write_slot(words, tags, value_slot, vt, vw) -- T:624 C:554
		set_hash_next(links, count, main, next_end) -- T:625 C:555
		return main, next_free -- T:625 C:556
	end
	write_slot(words, tags, free, kt, kw) -- T:627 C:558
	write_slot(words, tags, free_value, vt, vw) -- T:627 C:559
	local main_next<const> = hash_next(links, count, main) -- T:628 C:560
	set_hash_next(links, count, free, main_next) -- T:628 C:560
	set_hash_next(links, count, main, free) -- T:629 C:561
	return free, next_free -- T:629 C:562
end

local reinsert_mapping<const> = function(record, array_base, array, words, tags, hash, kt, kw, vt, vw, next_free, cpp_mirror) -- T:632 C:584 H:304-306
	if kt == integer_tag then -- T:633 C:585
		local slot<const> = kw - 1 -- T:634 C:586 H:200
		if kw > 0 and slot < array then -- T:635 C:587 H:200; native signed key is positive before subtracting
			write_slot(array_base, array_base + array * 4, slot, vt, vw) -- T:636-637 C:588
			return -1, next_free -- T:638 C:589
		end
		if hash >= band_capacity and kw > 0 then -- T:99-100,640 C:591 H:265-266
			local bin<const> = slot == 0 and 0 or allocator.internal.highest_bit(slot) + 1 -- T:101 H:267
			local band<const>: *u32 = words + 14 * hash + 4 * (1 + bin) -- T:97,102 H:47,262,268; bands only exist with word links
			*band = *band + 1 -- T:103 H:269
		end
	end
	local home<const> = hash_canonical_table_key(kt, kw) & (hash - 1) -- T:642 C:593
	local slot<const>, free<const> = insert_absent_hash_key(record, hash, words, tags, home, kt, kw, vt, vw, next_free, cpp_mirror) -- T:643 C:594-598
	return slot, free -- T:643 C:594-598; fixed result and local cursor transport
end

return { internal = { write_slot = write_slot, hash_canonical_table_key = hash_canonical_table_key,
	hash_next = hash_next, set_hash_next = set_hash_next, find_free_index = find_free_index,
	insert_absent_hash_key = insert_absent_hash_key, reinsert_mapping = reinsert_mapping } }
