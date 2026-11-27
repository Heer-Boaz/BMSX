module<const>

-- Source basis: 91ce105cf4d9649c20b9e04205dede1df9f8b297.
-- T/C: CPU operation and Thread-close caller; R/J: Thread records/views;
-- G/H: typed handle decode; O: object layout; B: tagged values; F: faults.
local layout<const> = require('kernel/gc_runtime_layout') -- G:108 H:66
local allocator<const> = require('kernel/dlmalloc') -- G:140 H:256
local retire<const> = require('kernel/thread_retire') -- T:4687-4690 C:1427-1430
local values<const> = require('kernel/gc_thread_trace') -- T:4693 C:1432
local ram_base<const> = layout.ram_base -- G:140 H:256
local word_mask<const> = 0x003ffffc -- G:140 H:256
local record_mask<const> = 0x003ffff8 -- O:5-7 G:138 H:254
local object_prefix<const> = 8 -- O:9 G:140 H:256
local thread_kind<const> = 4 -- R:33 J:18
local thread_tag<const> = 9 -- B:11 T:4534
local running<const>, normal<const>, dead<const>, failed<const> = 1, 2, 4, 5 -- R:27 J:12
local invalid_argument<const> = 10 -- F:44 T:4535,4685 C:1279,1426

struct closed_thread
	header: u8 -- R:21-22 J:20-21 G:142 H:255
	before_gray: u8[3] -- R:21-22 J:20-21
	gray: u32 -- R:22 J:21
	status: u32 -- R:22 J:21
	resumer: addr -- R:22 J:21
	entry: addr -- R:22 J:21
	top: u32 -- R:22 J:21
	stack_block: addr -- R:22 J:21
	stack_capacity: u32 -- R:22 J:21
	before_error: u32[2] -- R:23 J:22
	error_word: u32 -- T:4543,4545 C:1288,1291 R:23 J:22
	error_kind: u8 -- T:4543,4545 C:1288,1291 R:23 J:22
	after_error: u8[3] -- R:23 J:22
	return_range: u32[2] -- R:23 J:22
	frame_depth: u32 -- R:24 J:23
	_before_frames: u32 -- R:24 J:23
end

local close_value<const> = function(target, tag) -- T:4532-4545,4682-4696 C:1276-1291,1424-1435
	local management<const> = layout.management_offset -- G:108 H:66
	local arena<const> = management + layout.arena_offset -- G:140 H:256
	if tag ~= thread_tag then -- T:4534-4536 C:1278-1280
		return false, 0, 0, invalid_argument -- T:4536 C:1280
	end
	local offset<const> = target & record_mask -- T:4534 C:1278 G:140-144 H:253-256
	local thread<const>: *closed_thread = ram_base + offset -- T:4683 C:1425 G:140 H:256
	if thread.header ~= thread_kind or allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then -- T:4534-4536 C:1278-1280 G:141-143,158-159 H:255-256,267-269
		return false, 0, 0, invalid_argument -- T:4536 C:1280
	end
	local status<const> = thread.status -- T:4541,4683 C:1282,1425
	if status == running or status == normal then -- T:4684 C:1426
		return false, 0, 0, invalid_argument -- T:4685 C:1426
	end
	local error_word, error_tag = 0, 0 -- T:4543 C:1288
	if status == failed then -- T:4541-4543 C:1286-1288
		error_word, error_tag = thread.error_word, thread.error_kind -- T:4543 C:1288
	end
	retire.retire_thread_frames(management + layout.control_offset, arena, thread, 0) -- T:4687-4690 C:1427-1430; guest instructions now pay for closing captures
	local capacity<const> = thread.stack_capacity -- T:4693 C:1432
	values.internal.clear_stack_range(thread.stack_block & word_mask, capacity, 0, capacity) -- T:4693 C:1432
	thread.top = 0 -- T:4694 C:1433
	thread.entry = 0 -- T:4695 C:1434
	thread.status = dead -- T:4696 C:1435
	thread.error_word = 0 -- T:4545 C:1291
	local error_kind<const>: *u32 = ram_base + offset + offsetof(closed_thread.error_kind) -- T:4545 C:1291 R:23 J:22
	*error_kind = 0 -- T:4545 C:1291
	return status ~= failed, error_word, error_tag, nil -- T:4541-4543 C:1286-1288
end

return { close_value = close_value }
