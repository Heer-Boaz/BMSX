module<const>

-- Source basis: 3c4f901cbd0343dfcce3e0c3c0ea78486a56a481.
-- T/C: Tables; H/J: Table and density layouts; V/W: Value; N: native
-- nonzero-byte count; M: RAM. Canonical raw key, after absent-own Hash
-- insertion could not proceed. This unit owns no reservation or object write.
local table_create<const> = require('kernel/table_create') -- T:678,671,746 C:16,19,185,243,252 H:47-48
local allocator<const> = require('kernel/dlmalloc') -- T:677,706,723,749 C:159,197,199,231; nonzero highest bit
local ram_base<const> = 0x08000000 -- M:6
local ram_mask<const> = 0x003fffff -- M:7
local nil_tag<const> = 0 -- V:9 W:21
local integer_tag<const> = 3 -- V:9 W:21
local hash_census_limit<const> = 64 -- T:95 H:45
local hash_band_capacity<const> = 1024 -- T:96 H:46
local no_array_slot<const> = 0xffffffff -- C:176,195 H:200-202; signed view of the native unsigned sentinel
local bin_count<const> = 32 -- T:50 C:196,205
local included_slots<const> = 64 -- T:686,764-767 C:167,313
local staged_array_threshold<const> = 1024 -- T:846-847 C:258-259

struct table_plan_header
	before_hash: u32[3] -- T:34 H:27
	hash_storage: addr -- T:34,137,694 H:27,55
	array: u32 -- T:34,132,694 H:27,57
	hash: u32 -- T:34,137,694 H:27,58
	before_array_storage: u32[2] -- T:34,132,693 H:27
	array_storage: addr -- T:34,133,693 H:27,56
end

struct table_plan_scratch
	cursor: u32 -- T:40 J:6; ArrayDensity.scanned in TS
	live: u32 -- T:40 J:6
	slots: u32 -- T:40 J:6
	kept: u32 -- T:40 J:6
	counts: u32[32] -- T:50,715 C:196,205; fixed scratch instead of native array
end

local bit_width<const> = function(word) -- T:671,678,746 C:159,197,231
	if word == 0 then return 0 end -- T:671,678,746 C:159,197,231; bit_width(0)
	local top<const> = allocator.internal.highest_bit(word) -- T:671,678,746 C:159,197,231
	return top + 1 -- T:671,678,746 C:159,197,231
end

-- The aligned body counts four byte tags at a time, the BLua word-lane
-- equivalent of the native helper's bounded vector body, with the same
-- scalar edges. The byte-lane addition cannot carry (0x7f+0x7f ≤ 0xfe).
local count_nonzero_bytes<const> = function(first, stop) -- T:679-680 C:160 N:12-28
	local live = 0 -- T:679 N:13
	while first < stop and (first & 3) ~= 0 do -- T:680 N:27; prefix to align private word loads
		local tag<const>: *u8 = first -- T:680 N:27
		if *tag ~= nil_tag then live = live + 1 end -- T:680 N:27
		first = first + 1 -- T:680 N:27
	end
	while first + 4 <= stop do -- T:680 N:17-24; no read beyond stop
		local tags<const>: *u32 = first -- T:680 N:21
		local bits<const> = *tags -- T:680 N:21
		local lanes<const> = ((bits | ((bits & 0x7f7f7f7f) + 0x7f7f7f7f)) & 0x80808080) >> 7 -- T:680 N:20-21
		live = live + ((lanes * 0x01010101) >> 24) -- T:680 N:22-23
		first = first + 4 -- T:680 N:20,24
	end
	while first < stop do -- T:680 N:27
		local tag<const>: *u8 = first -- T:680 N:27
		if *tag ~= nil_tag then live = live + 1 end -- T:680 N:27
		first = first + 1 -- T:680 N:27
	end
	return live -- T:681 N:28
end

local count_array_range<const> = function(record, capacity, scratch_offset, last) -- T:675-683 C:155-164
	local header<const>: *table_plan_header = ram_base + (record & ram_mask) -- T:675 C:156 H:56-57
	local d<const>: *table_plan_scratch = ram_base + scratch_offset -- T:675 C:155 J:6
	local tags<const> = ram_base + (header.array_storage & ram_mask) + 4 * capacity -- T:676 C:156 H:56-57
	local cursor = d.cursor -- T:677 C:158
	while cursor < last do -- T:677 C:158
		local power<const> = 1 << bit_width(cursor) -- T:678 C:159
		local stop<const> = last < power and last or power -- T:678 C:159
		local live<const> = d.live + count_nonzero_bytes(tags + cursor, tags + stop) -- T:679-681 C:160
		d.live = live -- T:681 C:160
		d.cursor = stop -- T:681 C:161
		cursor = stop -- T:681 C:161; preserve the current scalar across the boundary
		if stop == power and live > (power >> 1) then -- T:682 C:162
			d.slots = power -- T:682 C:162
			d.kept = live -- T:682 C:162
		end
	end
end

local spend_census_grant<const> = function(record, scratch_offset, cycles) -- T:685-689 C:166-171
	local header<const>: *table_plan_header = ram_base + (record & ram_mask) -- T:685 C:166 H:57
	local d<const>: *table_plan_scratch = ram_base + scratch_offset -- T:685 C:166 J:6
	local capacity<const> = header.array -- T:685 C:166 H:57
	local cursor<const> = d.cursor -- T:686 C:167
	local paid_start<const> = cursor > included_slots and cursor or included_slots -- T:686 C:167
	local largest<const> = (capacity + 3) >> 2 -- T:686 C:168; C++ caps before multiplying
	local available<const> = cycles > 0 and (cycles < largest and cycles or largest) or 0 -- T:686 C:168
	local grant<const>, left<const> = 4 * available, capacity - paid_start -- T:686 C:168
	local n<const> = left < grant and left or grant -- T:686 C:168
	count_array_range(record, capacity, scratch_offset, paid_start + n) -- T:687 C:169
	return cycles - ((n + 3) >> 2) -- T:688 C:170
end

local census_cycles<const> = function(array, hash, key_tag, key_word) -- T:762-767 C:313-316
	local positive<const> = key_tag == integer_tag and key_word > 0 -- T:764,766 C:314,316
	local array_cycles<const> = array > included_slots and positive and ((array - included_slots + 3) >> 2) or 0 -- T:764-765 C:313-314
	local hash_cycles<const> = hash > included_slots and hash < hash_band_capacity and positive and ((hash - included_slots) >> 1) or 0 -- T:766-767 C:315-316
	return array_cycles, hash_cycles -- T:781 C:318,334; policy input, not charged by the planner
end

local count_integer_key<const> = function(scratch_offset, count_bins, index) -- T:670-674 C:198-202
	local d<const>: *table_plan_scratch = ram_base + scratch_offset -- T:671,674 C:196,198
	local log<const> = bit_width(index - 1) -- T:671 C:199; ceilLog2(index) = bit_width(index-1)
	if count_bins <= log then count_bins = log + 1 end -- T:672 C:200
	d.counts[log] = d.counts[log] + 1 -- T:673 C:201
	return count_bins -- T:673 C:200
end

local plan_rehash<const> = function(record, key_tag, key_word, extra_hash_slots, counted, scratch_offset) -- T:690-757 C:173-246
	local header<const>: *table_plan_header = ram_base + (record & ram_mask) -- T:693-694 C:174,187 H:55,57-58
	local capacity<const>, hash<const> = header.array, header.hash -- T:693 C:174,187
	local words<const> = ram_base + (header.hash_storage & ram_mask) -- T:694 C:174-175 H:55
	local tags<const>: *u8 = words + 8 * hash -- T:694 C:175 H:264-266
	local added<const> = key_tag == integer_tag and key_word > 0 and key_word - 1 or no_array_slot -- T:692 C:176 H:200-202
	if added == no_array_slot then -- T:696 C:177
		local live = 1 + extra_hash_slots -- T:697 C:179-181
		if hash > hash_census_limit then -- T:698 C:179
			local stored<const>: *u32 = words + table_create.internal.hash_node_bytes(hash) -- T:698 C:180 H:269-270
			live = live + *stored -- T:698 C:180
		else -- T:699 C:182
			for slot = 0, hash - 1 do -- T:699 C:182
				if tags[slot] ~= nil_tag and tags[slot + hash] ~= nil_tag then live = live + 1 end -- T:700-701 C:183
			end
		end
		local new_hash<const> = table_create.internal.hash_capacity(live) -- T:705 C:180,185
		return capacity, new_hash, 0 -- T:703-706 C:180,185
	end
	if capacity == 0 and hash == 0 then -- T:708 C:188
		if added == 0 then return 1, 0, 1 end -- T:710-712 C:190
		return 0, 1, 0 -- T:710-713 C:190
	end
	local d<const>: *table_plan_scratch = ram_base + scratch_offset -- T:715-719 C:192-194
	if counted == 0 then -- T:716 C:193
		d.cursor = 0 -- T:718 C:192
		d.live = 0 -- T:718 C:192
		d.slots = 0 -- T:718 C:192
		d.kept = 0 -- T:718 C:192
		count_array_range(record, capacity, scratch_offset, capacity) -- T:719 C:193
	end
	local total_keys, first_hash_array_slot = d.live, no_array_slot -- T:721 C:194-195
	for bin = 0, bin_count - 1 do d.counts[bin] = 0 end -- T:672,728 C:196; C++ local aggregate zeroes all bins once
	local count_bins = capacity ~= 0 and 1 + bit_width(capacity - 1) or 0 -- T:721,746,748 C:197
	if hash >= hash_band_capacity then -- T:722 C:203
		local census<const>: *u32 = words + table_create.internal.hash_node_bytes(hash) -- T:723,726 C:204,206 H:269-270
		total_keys = total_keys + census[0] -- T:724 C:204
		for bin = 0, bin_count - 1 do -- T:725 C:205
			local n<const> = census[1 + bin] -- T:726 C:206
			if n ~= 0 then -- T:727 C:207
				d.counts[bin] = d.counts[bin] + n -- T:729 C:208
				if count_bins <= bin then count_bins = bin + 1 end -- T:728 C:209
				local lower<const> = bin ~= 0 and (1 << (bin - 1)) or 0 -- T:730 C:211; zero-based native band lower edge
				if first_hash_array_slot == no_array_slot or lower < first_hash_array_slot then first_hash_array_slot = lower end -- T:730 C:211
			end
		end
	else -- T:732 C:213
		for slot = 0, hash - 1 do -- T:732-733 C:213-214
			local tag<const> = tags[slot] -- T:733 C:215
			if tag ~= nil_tag and tags[slot + hash] ~= nil_tag then -- T:734 C:216
				total_keys = total_keys + 1 -- T:735 C:217
				if tag == integer_tag then -- T:736 C:218
					local key<const>: *u32 = words + 4 * slot -- T:737 C:219
					local index<const> = *key -- T:737 C:219; signed Integer payload
					if index > 0 then -- T:738 C:220
						local array_slot<const> = index - 1 -- T:737-739 C:219-221 H:200-202
						if first_hash_array_slot == no_array_slot or array_slot < first_hash_array_slot then first_hash_array_slot = array_slot end -- T:739 C:221
						count_bins = count_integer_key(scratch_offset, count_bins, index) -- T:740 C:222
					end
				end
			end
		end
	end
	total_keys = total_keys + 1 -- T:743 C:227
	count_bins = count_integer_key(scratch_offset, count_bins, added + 1) -- T:744 C:228
	local array, array_keys, total = d.slots, d.kept, d.live -- T:745 C:230
	local first_bin<const> = bit_width(capacity) -- T:746 C:231
	local power = 1 << first_bin -- T:747 C:232
	for bin = first_bin, count_bins - 1 do -- T:748 C:233
		total = total + d.counts[bin] -- T:749 C:234
		if total > (power >> 1) then -- T:750 C:235; quotient of the unsigned power-of-two word
			array = power -- T:750 C:236
			array_keys = total -- T:750 C:237
		end
		power = power << 1 -- T:751 C:239
	end
	local hash_keys<const> = total_keys - array_keys -- T:753 C:242
	local new_hash<const> = table_create.internal.hash_capacity(hash_keys) -- T:755 C:243
	local keep<const> = array > capacity and added < array and new_hash == hash and -- T:756 C:244-245
		(first_hash_array_slot == no_array_slot or first_hash_array_slot >= array) -- T:756 C:245; native unsigned comparison with sentinel
	return array, new_hash, keep and 1 or 0 -- T:754-756 C:244-245
end

local plan_reservation<const> = function(old_array, old_hash, array, hash, keep) -- T:763,784,790,840-848 C:19,252,257-260,308,337
	local previous<const> = 5 * old_array + 10 * old_hash -- T:119,763 C:19,308
	local requested<const> = 5 * array + 10 * hash -- T:119,784 C:19,337
	local bytes<const> = (array > old_array and 5 * array or 0) + -- T:120,790 C:16,252
		table_create.internal.hash_storage_bytes(keep == 0 and hash or 0) -- T:98,120,790 C:252 H:48
	local staged_growth<const> = old_array >= staged_array_threshold and array > old_array -- T:846 C:258; CPU-owned source route
	local staged<const> = staged_growth or (old_array >= staged_array_threshold and array < old_array) -- T:847 C:259
		or (old_hash > hash_census_limit and (array == old_array or old_array == 0) and keep == 0) -- T:847 C:260
	return previous, requested, bytes, staged_growth and 1 or 0, staged and 1 or 0 -- T:846-850 C:259-263
end

return {
	internal = { bit_width = bit_width, count_nonzero_bytes = count_nonzero_bytes, count_array_range = count_array_range,
		count_integer_key = count_integer_key },
	census_cycles = census_cycles,
	spend_census_grant = spend_census_grant,
	plan_rehash = plan_rehash,
	plan_reservation = plan_reservation,
}
