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
local string_hash_offset<const> = 4 -- I:59
local string_next_offset<const> = 12 -- I:61
local max_ram_records<const> = ram_size >> 4 -- T:28 C:28 I:56; divide by 16-byte String header
local ram_bucket_extent_mask<const> = 2 * max_ram_records - 1 -- T:29 C:30
local ram_bucket_rehash<const> = 0x80000000 -- T:30 C:31
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

return {
	internal = { is_ram_string_id = is_ram_string_id },
	mark = mark,
	begin_reachability_epoch = begin_reachability_epoch,
	begin_sweep = begin_sweep,
	sweeping = sweeping,
	estimate_sweep_work = estimate_sweep_work,
	rehash_step = rehash_step,
}
