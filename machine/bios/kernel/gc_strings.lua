module<const>

-- Source basis: 0e7097869e82c2129fd4f5babfd4cecadba76d5d.
-- T/C/H name the TS/C++ StringPool and its header; L/B and A/E
-- name the two LuaHeap and HeapAllocator owners. S/I are the numeric
-- memory map and String record specification. Ports consume aligned
-- physical offsets; stored String identities and links remain raw words.
local allocator<const> = require('kernel/dlmalloc') -- T:291 C:285 L:281-284 B:288-291 A:61 E:59
local ram_base<const> = 0x08000000 -- S:6
local cart_rom_base<const> = 0x10000000 -- S:10,12
local ram_size<const> = 0x00400000 -- S:7
local ram_byte_mask<const> = ram_size - 1 -- T:27 S:7
local ram_word_mask<const> = ram_size - 4 -- S:9
local string_gc_epoch_mask<const> = 1 -- T:17 H:18
local string_header_bytes<const> = 16 -- I:56
local string_record_kind<const> = 5 -- I:57
local string_hash_offset<const> = 4 -- I:59
local string_length_offset<const> = 8 -- I:60
local string_next_offset<const> = 12 -- I:61
local max_ram_records<const> = ram_size >> 4 -- T:28 C:28 I:56; divide by 16-byte String header
local ram_bucket_extent_mask<const> = 2 * max_ram_records - 1 -- T:29 C:30
local ram_bucket_rehash<const> = 0x80000000 -- T:30 C:31
local ram_bucket_shrink<const> = 0x40000000 -- T:31 C:32
local sweep_rehash<const> = 0x80000000 -- T:22 C:23
local sweep_shrink<const> = 0xc0000000 -- T:23 C:24
local sign_bit<const> = 0x80000000 -- C:26,302,480,517; BLua32 unsigned order of a RAM word
local min_shrink_buckets<const> = (2 * 4096) >> 2 -- T:25 C:26 S:32

struct string_metadata
	buckets: addr -- T:19 C:20
	capacity: u32 -- T:19 C:20
	used: u32 -- T:19 C:20
	epoch: u32 -- T:19 C:20
	sweep: u32 -- T:19 C:20
	first_cart: u32 -- T:20 C:21
	rom_tables: u32[6] -- T:20-21 C:21-22
	sweep_link: addr -- T:21 C:22
	sweep_left: u32 -- T:21 C:22
	rehash_base: addr -- T:21 C:22
	rehash_ready: u32 -- T:21 C:22
end

local is_ram_string_id<const> = function(id) -- T:34 H:17
	-- Both RAM selector endpoints are positive Integers. A String with
	-- the cartridge-slot high bit set fails the lower bound as well.
	return id >= ram_base and id < cart_rom_base -- T:34 H:17
end

local mark<const> = function(metadata, id) -- T:430 C:419
	if not is_ram_string_id(id) then return 0 end -- T:431 C:420
	local mark_byte<const>: *u8 = ram_base + ((id + 1) & ram_byte_mask) -- T:432 C:421
	local state<const>: *string_metadata = ram_base + metadata -- T:432 C:422
	local epoch<const> = state.epoch & string_gc_epoch_mask -- T:432 C:422
	if (*mark_byte & string_gc_epoch_mask) == epoch then return 0 end -- T:433 C:423
	*mark_byte = epoch -- T:434 C:424
	return 1 -- T:435 C:425
end

local begin_reachability_epoch<const> = function(metadata) -- T:445 C:438
	local state<const>: *string_metadata = ram_base + metadata -- T:445 C:438
	state.epoch = state.epoch ~ 1 -- T:445 C:438
end

local begin_sweep<const> = function(metadata) -- T:454 C:443
	local state<const>: *string_metadata = ram_base + metadata -- T:455 C:444
	local ready<const> = state.rehash_ready -- T:455 C:444
	state.sweep = ready ~= 0 and ready or 1 -- T:456 C:445; max(1, unsigned ready)
	state.sweep_link = 0 -- T:457 C:446
	state.sweep_left = 0 -- T:457 C:446
end

local sweeping<const> = function(metadata) -- T:459 C:448
	local state<const>: *string_metadata = ram_base + metadata -- T:459 C:448
	return state.sweep ~= 0 -- T:459 C:448
end

local estimate_sweep_work<const> = function(metadata) -- T:460 C:450
	local state<const>: *string_metadata = ram_base + metadata -- T:461 C:451
	local control<const> = state.capacity -- T:461 C:451
	local count<const> = control & ram_bucket_extent_mask -- T:462 C:452
	local records<const> = state.used -- T:463 C:453
	if (control & ram_bucket_rehash) ~= 0 then return 3 * count + 2 * records end -- T:465 C:455
	if count >= min_shrink_buckets then return count + (count >> 1) + 2 * records + 1 end -- T:466 C:456
	return count + records -- T:466 C:456
end

local rehash_step<const> = function(metadata, arena, old_count, next_base, allowance) -- T:267 C:262
	local state<const>: *string_metadata = ram_base + metadata -- T:268-270 C:263-265
	local old_base<const>, count<const> = state.buckets, 2 * old_count -- T:268 C:263
	local ready, work = state.rehash_ready, 0 -- T:269 C:264-265
	-- Only the last prepared pair can still have records in its old bucket.
	while work < allowance do -- T:272 C:267
		if ready ~= 0 then -- T:273 C:268
			local head<const>: *u32 = ram_base + ((old_base + 4 * (ready - 1)) & ram_word_mask) -- T:274-275 C:269-270
			local record<const> = *head -- T:275 C:270
			if record ~= 0 then -- T:276 C:270
				local link<const>: *u32 = ram_base + ((record + string_next_offset) & ram_word_mask) -- T:277 C:271
				local hash_word<const>: *u32 = ram_base + ((record + string_hash_offset) & ram_word_mask) -- T:278 C:272
				local hash<const> = *hash_word -- T:278 C:272
				local bucket<const>: *u32 = ram_base + ((next_base + 4 * (hash & (count - 1))) & ram_word_mask) -- T:279 C:273
				*head = *link -- T:280 C:274
				*link = *bucket -- T:281 C:275
				*bucket = record -- T:282 C:276
				work = work + 1 -- T:283 C:277
				goto next_step -- T:284 C:278
			end
		end
		if ready == old_count then -- T:287 C:281
			state.buckets = next_base -- T:288 C:282
			state.capacity = count -- T:289 C:283
			state.rehash_base = 0 -- T:290 C:284
			state.rehash_ready = 0 -- T:290 C:284
			if old_base ~= 0 then allocator.bmsx_dlmalloc_free(arena, old_base - ram_base) end -- T:291 C:285 L:281-287 B:288-296 A:61 E:59; no logical charge change
			return work -- T:292 C:286
		end
		do -- T:294-297 C:288-291; scope for continue target
			local low<const>: *u32 = ram_base + ((next_base + 4 * ready) & ram_word_mask) -- T:294 C:288
			local high<const>: *u32 = ram_base + ((next_base + 4 * (ready + old_count)) & ram_word_mask) -- T:295 C:289
			*low = 0 -- T:294 C:288
			*high = 0 -- T:295 C:289
			ready = ready + 1 -- T:296 C:290
			work = work + 1 -- T:297 C:291
		end
		::next_step:: -- T:272,284 C:267,278
	end
	state.rehash_ready = ready -- T:299 C:293
	return work -- T:300 C:294
end

local shrink_step<const> = function(metadata, arena, count, allowance, exact_shrink_boundary) -- T:303 C:297
	local state<const>: *string_metadata = ram_base + metadata -- T:304-305 C:298-299
	local base<const>, half<const> = state.buckets, count >> 1 -- T:304 C:298
	local start<const> = state.rehash_ready -- T:305 C:299
	local ready, work = start, 0 -- T:306 C:300-301
	-- Only the current upper bucket may have live links in both halves.
	while work < allowance and (ready ~ sign_bit) < (half ~ sign_bit) do -- T:308 C:302
		local upper<const>: *u32 = ram_base + ((base + 4 * (half + ready)) & ram_word_mask) -- T:309 C:303
		local record<const> = *upper -- T:310 C:304
		if record ~= 0 then -- T:311 C:304
			local link<const>: *u32 = ram_base + ((record + string_next_offset) & ram_word_mask) -- T:312 C:306
			local lower<const>: *u32 = ram_base + ((base + 4 * ready) & ram_word_mask) -- T:312 C:305
			*upper = *link -- T:313 C:307
			*link = *lower -- T:314 C:308
			*lower = record -- T:315 C:309
		else ready = ready + 1 end -- T:316 C:310
		work = work + 1 -- T:317 C:311
	end
	-- TS also publishes if the raw cursor is beyond half; C++ publishes
	-- only at equality. The produced cursor never advances past half.
	if work < allowance and (exact_shrink_boundary == 0 or ready == half) then -- T:319-322 C:313
		allocator.bmsx_dlmalloc_shrink(arena, base - ram_base, 4 * half) -- T:323 C:314 A:70-72 E:68-70
		state.capacity = half -- T:324 C:315
		state.rehash_ready = 0 -- T:325 C:316
		state.sweep = 0 -- T:326 C:317
		return work + 1 -- T:327 C:318
	end
	if ready ~= start then state.rehash_ready = ready end -- T:320 C:320
	return work -- T:321 C:321
end

-- The contiguous bucket-walk branch of sweepStep. The driver owns the
-- handoff to rehash/shrink or the end of the cycle.
local sweep_buckets<const> = function(metadata, arena, occupied, cursor, count, next_base, allowance) -- T:468-474 C:459-464
	local work = 0 -- T:472 C:463
	local state<const>: *string_metadata = ram_base + metadata -- T:475-478 C:465-468
	local charged<const>: *u32 = ram_base + occupied -- T:495 C:492; address of the logical word in LuaHeap.releaseRecord
	local base<const>, epoch<const> = state.buckets, state.epoch & string_gc_epoch_mask -- T:475 C:465
	local ready<const> = state.rehash_ready -- T:476 C:466
	local low_end<const> = count + ready -- T:476 C:466
	local finish<const> = low_end + ready -- T:476 C:466
	local index, used = cursor - 1, state.used -- T:477 C:467
	local link, remaining = state.sweep_link, state.sweep_left -- T:478 C:468
	-- The next-directory prefixes are stable until the scan finishes.
	while index < finish and allowance ~= 0 do -- T:481 C:471
		local bucket -- T:482 C:472
		if index < count then -- T:482 C:472
			bucket = base + 4 * index -- T:482 C:472
		elseif index < low_end then -- T:483 C:473
			bucket = next_base + 4 * (index - count) -- T:483 C:473
		else -- T:483 C:473
			bucket = next_base + 4 * (index - ready) -- T:483 C:473
		end
		if link == 0 then -- T:484 C:474
			link = bucket -- T:484 C:475
			work = work + 1 -- T:484 C:476
			allowance = allowance - 1 -- T:484 C:477
		end
		if link == bucket then -- T:486 C:480
			if (used ~ sign_bit) < (max_ram_records ~ sign_bit) then -- T:486 C:480; unsigned min
				remaining = used -- T:486 C:480
			else -- T:486 C:480
				remaining = max_ram_records -- T:486 C:480
			end
		end
		local link_word: *u32 = ram_base + (link & ram_word_mask) -- T:487 C:481
		local record = *link_word -- T:487 C:481
		while record ~= 0 and remaining ~= 0 and allowance ~= 0 do -- T:488 C:482
			local kind<const>: *u8 = ram_base + (record & ram_byte_mask) -- T:489 C:483
			if *kind ~= string_record_kind then break end -- T:489 C:483
			local next_link<const> = record + string_next_offset -- T:490,497 C:484,494
			local next_word<const>: *u32 = ram_base + (next_link & ram_word_mask) -- T:490 C:484
			local next_record<const> = *next_word -- T:490 C:484
			remaining = remaining - 1 -- T:491 C:485
			allowance = allowance - 1 -- T:491 C:486
			work = work + 1 -- T:491 C:487
			local mark_byte<const>: *u8 = ram_base + ((record + 1) & ram_byte_mask) -- T:492 C:488
			if (*mark_byte & string_gc_epoch_mask) ~= epoch then -- T:492 C:488
				*link_word = next_record -- T:493 C:489
				*kind = 0 -- T:494 C:491
				-- Every bucket in this scan is from the RAM directory.
				local length_word<const>: *u32 = ram_base + ((record + string_length_offset) & ram_word_mask) -- T:80-87,495 C:54-62,492
				local bytes<const> = string_header_bytes + (*length_word & ram_byte_mask) -- T:85-87,495 C:60-62,492
				allocator.bmsx_dlmalloc_free(arena, record - ram_base) -- T:495 C:492 A:61 E:59; TS LuaHeap 270-271 / C++ LuaHeap 277-278
				*charged = *charged - bytes -- T:495 C:492; TS LuaHeap 272-273 / C++ LuaHeap 279-280
				used = used - 1 -- T:496 C:493
			else -- T:497 C:494
				link = next_link -- T:497 C:494
				link_word = next_word -- T:493,497,501 C:489,494,498
			end
			record = next_record -- T:498 C:495
		end
		if record ~= 0 then -- T:500-501 C:497-498
			if remaining ~= 0 and allowance == 0 then break end -- T:500 C:497
			*link_word = 0 -- T:501 C:498
		end
		link = 0 -- T:502 C:499
		remaining = 0 -- T:502 C:499
		index = index + 1 -- T:502 C:500
	end
	state.used = used -- T:504 C:502
	state.sweep_link = link -- T:505 C:503
	state.sweep_left = remaining -- T:505 C:503
	if index < finish then -- T:506 C:504
		state.sweep = index + 1 -- T:507 C:505
		return work, allowance, false -- T:508 C:506; this quantum has not reached the handoff
	end
	return work, allowance, true -- T:510-514 C:508-512; preserve locals needed by the handoff
end

local sweep_step<const> = function(metadata, arena, occupied, allowance, exact_shrink_boundary) -- T:468 C:459
	local state<const>: *string_metadata = ram_base + metadata -- T:469,473 C:460
	local cursor<const>, control<const> = state.sweep, state.capacity -- T:469 C:460
	local count<const> = control & ram_bucket_extent_mask -- T:469 C:460
	if cursor == sweep_shrink then -- T:470 C:461
		local work<const> = shrink_step(metadata, arena, count, allowance, exact_shrink_boundary) -- T:470 C:461
		return work -- T:470 C:461; fixed one-word result on the System stack
	end
	local next_base<const> = (control & ram_bucket_rehash) ~= 0 and state.rehash_base or 0 -- T:471 C:462
	local work = 0 -- T:472 C:463
	if cursor ~= sweep_rehash then -- T:474 C:464
		local complete -- T:506 C:504
		work, allowance, complete = sweep_buckets(metadata, arena, occupied, cursor, count, next_base, allowance) -- T:474,508,510 C:464,506,508
		if not complete then return work end -- T:508 C:506
	end
	-- Emergency admission can retire the old directory without waiting for
	-- another distinct intern.
	if next_base ~= 0 then -- T:513 C:511
		if allowance ~= 0 then work = work + rehash_step(metadata, arena, count, next_base, allowance) end -- T:514 C:512
		if state.rehash_base ~= 0 then -- T:515 C:513
			state.sweep = sweep_rehash -- T:516 C:514
			return work -- T:517 C:515
		end
	elseif count >= min_shrink_buckets and (state.used ~ sign_bit) <= ((count >> 2) ~ sign_bit) then -- T:519 C:517
		state.capacity = count | ram_bucket_shrink -- T:520 C:518
		state.sweep = sweep_shrink -- T:521 C:519
		return work + shrink_step(metadata, arena, count, allowance, exact_shrink_boundary) -- T:522 C:520
	end
	state.sweep = 0 -- T:524 C:522
	return work -- T:525 C:523
end

return {
	internal = { is_ram_string_id = is_ram_string_id, shrink_step = shrink_step },
	mark = mark,
	begin_reachability_epoch = begin_reachability_epoch,
	begin_sweep = begin_sweep,
	sweeping = sweeping,
	estimate_sweep_work = estimate_sweep_work,
	rehash_step = rehash_step,
	sweep_buckets = sweep_buckets,
	sweep_step = sweep_step,
}
