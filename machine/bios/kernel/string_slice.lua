module<const>

-- Source basis: e3774a03a44e94be4d9d8be73c7ce2de80a336c2.
-- T/C: native StringPool; H/F: native FNV; I: String record layout;
-- M: RAM decode; A/B: native allocator adapters. Both mirrors are
-- unchanged. The exact mounted bank extents are ordinary scalar inputs,
-- not invented firmware memory ports. A ROM read failure is returned
-- to the owner, never rewritten as a miss or an allocation failure.
local strings<const> = require('kernel/gc_strings') -- T:379-388,431-436 C:369-377,418-425
local records<const> = require('kernel/dlmalloc_record') -- T:393 C:383
local allocator<const> = require('kernel/dlmalloc') -- T:384 C:374 A:57-59 B:54-56
local ram_base<const> = 0x08000000 -- M:6
local ram_size<const> = 0x00400000 -- M:7
local byte_mask<const> = ram_size - 1 -- T:27 M:7
local word_mask<const> = ram_size - 4 -- M:9
local header_bytes<const> = 16 -- I:57
local kind<const> = 5 -- I:58
local intern_rehash_work<const> = 64 -- T:26 C:27
local sign_bit<const> = 0x80000000 -- T:166,381 C:179,371; unsigned metadata extent and raw cursors
local bucket_extent<const> = strings.internal.ram_bucket_extent_mask -- T:29 C:30
local growing<const> = strings.internal.ram_bucket_rehash -- T:30 C:31
local shrinking<const> = strings.internal.ram_bucket_shrink -- T:31 C:32
local max_records<const> = strings.internal.max_ram_records -- T:28 C:28
local rom_flag_kind<const> = 0x10005 -- I:58-59 C:159
local cart_base<const> = 0x10000000 -- M:12
local cart_extent<const> = 0x20000000 -- M:13
local alignment_mask<const> = 7 -- I:55-56
local socket_bit<const> = 0x80000000 -- I:64
local invalid_chain<const> = 1 -- T:217 C:227; broken chain, not OOM
local invalid_header<const> = 2 -- T:146 C:161
local truncated_payload<const> = 3 -- T:154 C:171

struct mutable_string_record
	header: u32 -- I:58-59
	hash: u32 -- I:60
	length: u32 -- I:61
	next: addr -- I:62
end

-- Keep source byte addresses in their owning bank. Returning a length
-- for the first span avoids remapping any byte in that span. The only
-- possible second span is the first byte of the installed RAM bank.
local slice_head<const> = function(source, first, count) -- T:352-355 C:347-348,72-82
	local start<const> = source + header_bytes + first -- T:353 C:74,80
	if strings.internal.is_ram_string_id(source) then -- T:352,354 C:73
		local offset<const> = start & byte_mask -- T:354 C:74-75
		local until_wrap<const> = ram_size - offset -- T:355 C:76
		return ram_base + offset, (count < until_wrap and count or until_wrap) -- T:354-355 C:76-77
	end
	return start, count -- T:353-355 C:79-81; the private read port retains the ROM socket bit
end

local fnv_segment<const> = function(hash, base, count) -- H:39-45 F:9-11
	local source<const>: *u8 = base -- H:39-42 F:9-10
	for i = 0, count - 1 do -- H:40-44 F:10
		hash = (hash ~ source[i]) * 16777619 -- H:42,44 F:8,10; BLua Integer multiplication wraps
	end
	return hash -- H:45 F:11
end

local hash_span<const> = function(start, head, length) -- T:351-356 C:347-349
	local hash<const> = fnv_segment(0x811c9dc5, start, head) -- T:356 C:349 H:27,39-42 F:7,9-11
	if head == length then return hash end -- T:356 H:44-45 C:349 F:9-11; empty tail is the identity
	local result<const> = fnv_segment(hash, ram_base, length - head) -- T:356 C:349 H:44-45 F:9-11
	return result -- T:356 C:349 H:45 F:11
end

local matches_slice<const> = function(bank, offset, mask, start, head, length) -- T:45-47,52-56 C:84-101
	local bytes<const>: *u8 = start -- T:162-163,172 C:74-81,98-101,183
	local tail<const>: *u8 = ram_base -- T:55,355 C:77,90-96
	local i = 0 -- T:47,52 C:84-85,95
	while i < head do -- T:53 C:84-87,98-100
		local candidate<const>: *u8 = bank + ((offset + i) & mask) -- T:53 C:74-77,84-87,183
		if *candidate ~= bytes[i] then break end -- T:53 C:87,99
		i = i + 1 -- T:53 C:88-89
	end
	if i == head then -- T:54 C:90-91,99
		while i < length do -- T:55 C:91-96
			local candidate<const>: *u8 = bank + ((offset + i) & mask) -- T:55 C:74-77,91-92,183
			if *candidate ~= tail[i - head] then break end -- T:55 C:92,100
			i = i + 1 -- T:55 C:93-94
		end
		if i == length then return true end -- T:56,172 C:95-101,183
	end
	return false -- T:54,56 C:87,92
end

local lookup_ram_chain<const> = function(metadata, bucket, hash, start, head, length) -- T:161 C:176
	local state<const>: *string_metadata = ram_base + metadata -- T:166 C:179
	local link<const>: *u32 = ram_base + (bucket & word_mask) -- T:164 C:177 M:9
	local id = *link -- T:164 C:177
	if id == 0 then return 0 end -- T:165 C:178
	local remaining = state.used -- T:166 C:179
	if (remaining ~ sign_bit) > (max_records ~ sign_bit) then remaining = max_records end -- T:166 C:179; unsigned min
	while id ~= 0 and remaining ~= 0 do -- T:167 C:180
		remaining = remaining - 1 -- T:167 C:180; dead final postdecrement has no owner or consumer
		local hash_word<const>: *u32 = ram_base + ((id + offsetof(mutable_string_record.hash)) & word_mask) -- T:168 C:181 M:9 I:60
		if *hash_word == hash then -- T:168 C:181
			local length_word<const>: *u32 = ram_base + ((id + offsetof(mutable_string_record.length)) & word_mask) -- T:169 C:182 M:9 I:61
			if (*length_word & byte_mask) == length then -- T:169 C:182
				local offset<const> = (id + header_bytes) & byte_mask -- T:170 C:74,183
				local mask<const> = length > ram_size - offset and byte_mask or -1 -- T:171 C:74-77,183
				if matches_slice(ram_base, offset, mask, start, head, length) then return id end -- T:172 C:183
			end
		end
		local next_word<const>: *u32 = ram_base + ((id + offsetof(mutable_string_record.next)) & word_mask) -- T:174 C:185 M:9 I:62
		id = *next_word -- T:174 C:185
	end
	return 0 -- T:176 C:187
end

local lookup_ram<const> = function(metadata, start, head, length, hash) -- T:179,233,351-356 C:190,239,347-350
	local state<const>: *string_metadata = ram_base + metadata -- T:180 C:191
	local control<const> = state.capacity -- T:180 C:191
	local count<const> = control & bucket_extent -- T:180 C:191
	if count == 0 then return 0 end -- T:181 C:192
	local index<const> = hash & (count - 1) -- T:182 C:193
	if (control & (growing | shrinking)) ~= 0 then -- T:183 C:194
		local ready<const> = state.rehash_ready -- T:184 C:195
		if (control & growing) ~= 0 then -- T:185 C:196
			if (index ~ sign_bit) < (ready ~ sign_bit) then -- T:186 C:197
				local bucket<const> = state.rehash_base + 4 * (hash & (2 * count - 1)) -- T:187 C:198
				local found<const> = lookup_ram_chain(metadata, bucket, hash, start, head, length) -- T:188 C:199
				if found ~= 0 then return found end -- T:189 C:199
				if ((index + 1) ~ sign_bit) < (ready ~ sign_bit) then return 0 end -- T:190 C:200
			end
		else -- T:192 C:202
			local lower<const> = index - (count >> 1) -- T:193 C:203
			if lower >= 0 and (lower ~ sign_bit) <= (ready ~ sign_bit) then -- T:194 C:204; count cannot exceed bucket_extent
				local base<const> = state.buckets -- T:195 C:205
				local found<const> = lookup_ram_chain(metadata, base + 4 * lower, hash, start, head, length) -- T:196 C:206
				if found ~= 0 or (lower ~ sign_bit) < (ready ~ sign_bit) then return found end -- T:197 C:207
				local upper<const> = lookup_ram_chain(metadata, base + 4 * index, hash, start, head, length) -- T:198 C:208
				return upper -- T:198 C:208
			end
		end
	end
	local found<const> = lookup_ram_chain(metadata, state.buckets + 4 * index, hash, start, head, length) -- T:202 C:212
	return found -- T:202 C:212
end

-- The published ROM bucket table has already been validated at activation.
-- Individual chains remain external records, so check their full header and
-- candidate extent lazily at exactly the old lookup boundary.
local lookup_rom<const> = function(metadata, directory, hash, start, head, length, system, cart) -- T:142-159,205-230 C:156-174,215-235
	local state<const>: *string_metadata = ram_base + metadata -- T:206-207 C:216-217
	local table<const> = 2 * directory -- T:206 C:216; index into 4-byte entries
	local count<const> = state.rom_tables[table + 1] -- T:207 C:217
	if count == 0 then return 0, 0 end -- T:208 C:218
	local bucket<const>: *u32 = state.rom_tables[table] + 4 * (hash & (count - 1)) -- T:209 C:219
	local id = *bucket -- T:209 C:219
	if id == 0 then return 0, 0 end -- T:210 C:220
	local socket<const> = directory == 2 and 1 or 0 -- T:211-213 C:221-224
	local remaining = (system + cart) >> 4 -- T:214-215 C:225-226; divide by sizeof immutable header
	while id ~= 0 do -- T:216 C:227
		if remaining == 0 then return 0, invalid_chain end -- T:217 C:228
		remaining = remaining - 1 -- T:217 C:228
		local offset, extent, address -- T:35-40,143,152,157-158,218,222 C:34-40,157,163,167-168,173,229-232; native borrowed view projected as a bank/address/extent, not persistent host state
		if (id ~ socket_bit) < (ram_base ~ socket_bit) then -- T:35,146,218 C:35,159,229
			offset, extent, address = id, system, id -- T:35,146,218 C:35,159,229
		else -- T:37,40,146 C:35-37,159
			offset, extent = id - cart_base, cart -- T:37,146,218 C:35-36,159,229
			address = id | (socket << 31) -- T:39-40,218 C:37-38,229
		end
		if (id & alignment_mask) ~= 0 or offset < 0 or (offset ~ socket_bit) > ((extent - header_bytes) ~ socket_bit) or extent < header_bytes then -- T:144-146,218 C:157-161,229
			return 0, invalid_header -- T:146 C:161; no candidate was read
		end
		local record<const>: *mutable_string_record = address -- T:145,219-221 C:158-160,229-231
		if record.header ~= rom_flag_kind then return 0, invalid_header end -- T:145-146 C:160-161
		local size<const> = record.length -- T:221 C:230; complete immutable header loads commute
		if record.hash == hash and size == length then -- T:220-221 C:231
			if (size ~ socket_bit) > ((cart_extent - header_bytes) ~ socket_bit) or size > extent - offset - header_bytes then -- T:153-154,222 C:169-171,232
				return 0, truncated_payload -- T:154 C:171
			end
			if matches_slice(0, address + header_bytes, -1, start, head, length) then return address, 0 end -- T:222-224 C:232
		end
		id = record.next -- T:227 C:233
	end
	return 0, 0 -- T:229 C:235
end

local lookup_rom_directories<const> = function(metadata, start, head, length, hash, system, cart0, cart1) -- T:235-241 C:240-244
	local match, fault = lookup_rom(metadata, 0, hash, start, head, length, system, cart0) -- T:235 C:240
	if fault ~= 0 or match ~= 0 then return match, fault end -- T:236 C:240; preserve external fault, not a miss
	local state<const>: *string_metadata = ram_base + metadata -- T:237 C:241
	local directory<const> = state.first_cart -- T:237 C:241
	if directory == 0 then return 0, 0 end -- T:238 C:242
	match, fault = lookup_rom(metadata, directory, hash, start, head, length, system, directory == 2 and cart1 or cart0) -- T:239 C:243
	if fault ~= 0 or match ~= 0 then return match, fault end -- T:240 C:243
	match, fault = lookup_rom(metadata, 3 - directory, hash, start, head, length, system, directory == 1 and cart1 or cart0) -- T:241 C:244
	return match, fault -- T:241 C:244
end

-- This branch follows a full lookup miss with an already initialized
-- directory. Initial directory reservation has a different allocation
-- contract and is not part of this function.
local prepare_existing_directory<const> = function(metadata, arena) -- T:370,378-391 C:361,368-380
	local state<const>: *string_metadata = ram_base + metadata -- T:370 C:361
	local control<const> = state.capacity -- T:370 C:361
	local count<const> = control & bucket_extent -- T:370 C:361
	if state.sweep == 0 then -- T:378,459 C:368,448
		if (control & growing) ~= 0 then -- T:379 C:369
			strings.rehash_step(metadata, arena, count, state.rehash_base, intern_rehash_work) -- T:380 C:370
		elseif (state.used ~ sign_bit) >= (count ~ sign_bit) then -- T:381 C:371
			local offset<const> = allocator.bmsx_dlmalloc_allocate(arena, 8 * count, 0) -- T:384 C:374 A:57-59 B:54-56; optional growth never invokes the collector
			if offset ~= 0 then -- T:385 C:374
				local next_base<const> = ram_base + offset -- T:384 C:374 A:59 B:56
				state.rehash_base = next_base -- T:386 C:375
				state.capacity = count | growing -- T:387 C:376
				strings.rehash_step(metadata, arena, count, next_base, intern_rehash_work) -- T:388 C:377
			end
		end
	end
	return 0 -- T:391,393 C:380,383; no result record exists yet
end

-- The logical charge and record reservation have already succeeded. A
-- collector may have replaced the directory, so do not reuse any of the
-- pre-admission cursor/base values. id is the absolute issued address.
local publish<const> = function(metadata, id, start, head, length, hash) -- T:393-428 C:383-415
	local state<const>: *string_metadata = ram_base + metadata -- T:394 C:384
	local control<const> = state.capacity -- T:394 C:384
	local count<const> = control & bucket_extent -- T:394 C:384
	local index, base = hash & (count - 1), state.buckets -- T:395 C:385-386
	if (control & (growing | shrinking)) ~= 0 then -- T:396 C:387
		local ready<const> = state.rehash_ready -- T:397 C:388
		if (control & growing) ~= 0 then -- T:398 C:389
			if (index ~ sign_bit) < (ready ~ sign_bit) then -- T:399 C:390
				base = state.rehash_base -- T:401 C:391; C++ read order, changing the local index has no dependent read
				index = hash & (2 * count - 1) -- T:400 C:392
			end
		else -- T:403 C:394
			local lower<const> = index - (count >> 1) -- T:404 C:395,398
			if lower >= 0 and (lower ~ sign_bit) <= (ready ~ sign_bit) then index = lower end -- T:405 C:398
		end
	end
	local bucket<const>: *u32 = ram_base + ((base + 4 * index) & word_mask) -- T:408 C:401 M:9
	local record<const>: *mutable_string_record = id -- T:409-412 C:402-405 I:57-62
	record.header = kind | ((state.epoch & 1) << 8) -- T:409 C:402
	record.hash = hash -- T:410 C:403
	record.length = length -- T:411 C:404; successful admission precludes the clamp changing this length
	record.next = *bucket -- T:412 C:405
	if length ~= 0 then -- T:413 C:406
		local prefix<const>: *u8 = start -- T:419,422 C:409
		local tail<const>: *u8 = ram_base -- T:420 C:410
		local target<const>: *u8 = ram_base + ((id + header_bytes) & byte_mask) -- T:414 C:407-408
		for i = 0, head - 1 do target[i] = prefix[i] end -- T:419,422,424 C:409,411; per-store decode invalidation accompanies copied bytes
		for i = head, length - 1 do target[i] = tail[i - head] end -- T:420,424 C:410-411
	end
	*bucket = id -- T:426 C:413
	state.used = state.used + 1 -- T:427 C:414
	strings.mark(metadata, id) -- T:428,440 C:415,428; local-root host-call scopes are excluded from this firmware leaf
	return id -- T:428,442 C:415,430
end

local initial_buckets<const> = 16 -- T:24 C:25

local publish_initial_directory<const> = function(metadata, offset) -- T:374-377 C:364-367
	local address<const> = ram_base + offset -- T:374 C:364
	local buckets<const>: *u32 = address -- T:375 C:365
	for i = 0, initial_buckets - 1 do buckets[i] = 0 end -- T:375-376 C:365-366
	local state<const>: *string_metadata = ram_base + metadata -- T:370,377 C:361,367
	state.buckets = address -- T:377 C:367
	state.capacity = initial_buckets -- T:377 C:367
end

-- Direct source-free `intern` while boot publishes its original retained
-- diagnostic set. The caller has initialized an empty arena and has not
-- installed any ROM directory. These records, including both bucket
-- extents, fit the first page. There is no earlier object to reclaim.
local intern_cold_span<const> = function(metadata, arena, occupied, start, length) -- T:331-332,358-393 C:327-329,353-383
	local hash<const> = hash_span(start, length, length) -- T:332,351-356 C:325-327
	local prior<const> = lookup_ram(metadata, start, length, length, hash) -- T:233-234,361 C:239,328
	if prior ~= 0 then -- T:362 C:328
		strings.mark(metadata, prior) -- T:362,439-442 C:328,427-430
		return prior -- T:362 C:328
	end
	local state<const>: *string_metadata = ram_base + metadata -- T:370 C:361
	if (state.capacity & bucket_extent) == 0 then -- T:370-372 C:361-362
		local directory<const> = allocator.bmsx_dlmalloc_allocate(arena, 4 * initial_buckets, 0) -- T:373 C:363
		if directory == 0 then return 0 end -- T:373 C:363; no reclaimable input in this producer
		publish_initial_directory(metadata, directory) -- T:374-377 C:364-367
	else -- T:378 C:368
		prepare_existing_directory(metadata, arena) -- T:378-391 C:368-380
	end
	local bytes<const> = header_bytes + length -- T:393 C:382-383; fixed admitted input lengths
	local offset<const> = records.bmsx_dlmalloc_reserve_record(arena, bytes, 0, 0, 0, bytes, 0, 0, occupied) -- T:393 C:383
	if offset == 0 then return 0 end -- T:393 C:383; no earlier reclaimable object
	local id<const> = publish(metadata, ram_base + offset, start, length, length, hash) -- T:393-428 C:383-415
	return id -- T:428 C:415
end

return {
	internal = { fnv_segment = fnv_segment, matches_slice = matches_slice, lookup_ram_chain = lookup_ram_chain, lookup_rom = lookup_rom },
	initial_buckets = initial_buckets, publish_initial_directory = publish_initial_directory, intern_cold_span = intern_cold_span,
	slice_head = slice_head,
	lookup_rom_directories = lookup_rom_directories,
	hash_span = hash_span,
	lookup_ram = lookup_ram,
	prepare_existing_directory = prepare_existing_directory,
	publish = publish,
}
