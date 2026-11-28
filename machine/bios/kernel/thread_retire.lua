module<const>

-- Source basis: 91ce105cf4d9649c20b9e04205dede1df9f8b297.
-- T/C: CPU; I/J: Thread view; R/S: Thread record; F/G: Frame words;
-- U/V/W: Upvalue; H/K: GC handle admission; P: object words; M: RAM.
-- A/B: arena and GC lane offsets.
-- The processor has already stopped the old execution bank. This code owns
-- its guest RAM, not the stopped CPU latches or discarded host frame views.
local layout<const> = require('kernel/gc_runtime_layout') -- A:8,11 B:13 K:21
local allocator<const> = require('kernel/dlmalloc') -- H:140-143 K:253-256
local captures<const> = require('kernel/gc_capture_trace') -- T:4303,4307 C:2982,2986 H:154-156 K:292-294 U:39-60 V:42-62
local barrier<const> = require('kernel/gc_barrier') -- U:50 V:53
local values<const> = require('kernel/gc_thread_trace') -- T:869 C:3204
local ram_base<const> = layout.ram_base -- M:6
local word_mask<const> = 0x003ffffc -- M:9
local record_mask<const> = 0x003ffff8 -- P:5-7
local object_prefix<const> = 8 -- P:9 H:140-143 K:253-256
local frame_window_mask<const> = 0x000fffff -- F:28 G:50
local frame_count_mask<const> = 0x0003ffff -- I:14 J:287 R:34 S:27
local chain_limit<const> = 0x00400000 // 16 -- W:11,20 U:9,18 M:7
local open<const> = 1 -- U:13 W:15
local change_link<const> = 12 -- U:17 W:19
local thread_kind<const> = 4 -- R:33 S:18
local dead<const> = 4 -- R:27 S:12 T:872 C:3207
local running<const> = 1 -- R:27 S:12 T:880 C:3215
local sign_bit<const> = 0x80000000 -- C:2984; raw unsigned slot comparison

struct stopped_thread
	header: u32 -- R:21-22 S:20-21
	gray: u32 -- R:22 S:21
	status: u32 -- R:22 S:21
	resumer: addr -- R:22 S:21
	entry: addr -- R:22 S:21
	stack_top: u32 -- R:22 S:21
	stack_block: addr -- R:22 S:21
	stack_capacity: u32 -- R:22 S:21
	frame_capacity: u32 -- R:23 S:22
	_before_error: u32 -- R:23 S:22
	error_word: u32 -- R:23 S:22 I:60-61 J:48-49
	error_kind: u32 -- R:23 S:22 I:60-61 J:48-49
	call_base: u32 -- R:23 S:22
	return_count: u32 -- R:23 S:22
	frame_depth: u32 -- R:24 S:23
	_before_frames: u32 -- R:24 S:23
	frame_block: addr -- R:24 S:23
end

struct stopped_frame
	fn: addr -- F:19 G:41
	call_site: addr -- F:19 G:41
	head: addr -- F:19 G:41
	register_base: u32 -- F:19 G:41
	flags: u32 -- F:19 G:41
	pc: u32 -- F:19 G:41
	vararg_base: u32 -- F:19 G:41
	argument_count: u32 -- F:19 G:41
	return_base: u32 -- F:19 G:41
	return_count: u32 -- F:19 G:41
	top: u32 -- F:19 G:41
	closure: addr -- F:19 G:41
	stack_base: u32 -- F:19,97 G:41,147
	stack_capacity: u32 -- F:19,98 G:41,147
end

struct closing_cell
	kind: u8 -- U:11 W:13
	color: u8 -- P:3
	flags: u8 -- U:12 W:14
	tag: u8 -- U:14 W:16
	word: u32 -- U:15 W:17
	owner: addr -- U:16 W:18
	next: addr -- U:17 W:19
end

local retire_open_cells<const> = function(control, arena, frame_address, first_slot) -- T:4298 C:2977
	local frame<const>: *stopped_frame = frame_address -- T:4299 C:2978
	local head<const> = frame.head -- T:4299 C:2978
	local address = head -- T:4300 C:2979
	local closed = 0 -- T:4301 C:2980
	while address ~= 0 and closed < chain_limit do -- T:4302 C:2981
		local cell_address<const> = captures.internal.cell_record_address(arena, address) -- T:4303 H:140-144,148-149,154-155 C:2982 K:253-256,288-293
		if cell_address == 0 then break end -- T:4303-4304 H:156 C:2982-2983 K:294
		local cell<const>: *closing_cell = cell_address -- T:4303 H:155-156 C:2982 K:293-294
		if (cell.flags & open) == 0 then break end -- T:4303-4304 H:156 U:25-26 C:2982-2983 K:294 V:27-28
		if first_slot ~= 0 and (cell.word ~ sign_bit) < (first_slot ~ sign_bit) then break end -- T:4305 C:2984
		address = cell.next -- T:4306 C:2985
		local tag<const>, word<const> = captures.internal.load_upvalue(cell_address) -- T:4307 U:39-43,53-60 C:2986 V:42-46,56-62
		cell.flags = cell.flags & ~open -- T:4307 U:44 C:2986 V:47
		cell.tag = tag -- T:4307 U:45 C:2986 V:48
		cell.word = word -- T:4307 U:46 C:2986 V:49
		cell.owner = 0 -- T:4307 U:47 C:2986 V:50
		cell.next = 0 -- T:4307 U:48-49 C:2986 V:51-52; ordinary stores own RAM history
		if barrier.internal.has_edge(tag) then barrier.write_barrier(control, cell_address & record_mask, change_link, 1) end -- T:4307 U:50 C:2986 V:53; canonical C++ color store
		closed = closed + 1 -- T:4308 C:2987
	end
	local remaining<const> = first_slot == 0 and 0 or address -- T:4310 C:2989
	if head ~= remaining then frame.head = remaining end -- T:4311 C:2990
	return closed -- T:4312 C:2991
end

local retire_thread_frames<const> = function(control, arena, address, retained_depth) -- T:864-867 C:3199-3202
	local thread<const>: *stopped_thread = address -- T:864 I:42-43 C:3199 J:31
	local depth = thread.frame_depth & frame_count_mask -- T:864 I:14 C:3199 S:27
	local frames<const> = thread.frame_block & word_mask -- T:865 I:69-70,203 C:3200 S:41,57-59
	while depth > retained_depth do -- T:2781 C:2759; full retirement retains zero frames
		local frame<const> = ram_base + ((frames + (depth - 1) * sizeof(stopped_frame)) & word_mask) -- T:865 I:69-70,203 F:21 C:3200 S:41 G:42
		retire_open_cells(control, arena, frame, 0) -- T:866 C:3201
		depth = depth - 1 -- T:867 I:265 C:3202 J:287
		local top = 0 -- T:867 I:264 C:3202 J:286
		if depth ~= 0 then -- T:867 I:263-264 C:3202 J:285-286
			local previous<const>: *stopped_frame = ram_base + ((frames + (depth - 1) * sizeof(stopped_frame)) & word_mask) -- T:867 I:263 F:97-98 C:3202 J:285 G:147
			top = (previous.stack_base & frame_window_mask) + (previous.stack_capacity & frame_window_mask) -- T:867 I:264 F:97-98 C:3202 J:286 G:147
		end
		thread.stack_top = top -- T:867 I:264 C:3202 J:286
		thread.frame_depth = depth -- T:867 I:232-235,265 C:3202 J:277-280,287; host view retirement is not guest work
	end
end

-- Before EXEC, release the software state of the outgoing bank. Its windows
-- remain live through RFE so the launcher can issue the machine transfer.
-- The dropped register slots cease to be roots and the atomic trace clears
-- them as usual; the transfer does not have to scrub their entire backing.
local prepare_exec<const> = function(management, address) -- T:860 C:3195; ordinary System launcher retains this selected bank
	local control<const> = management + layout.control_offset -- U:50 V:53
	local arena<const> = management + layout.arena_offset -- H:140-143 K:253-256
	local thread<const>: *stopped_thread = address -- T:871 I:42-43 C:3206 J:31
	local frames<const> = thread.frame_block & word_mask -- T:865 I:69-70,203 C:3200 S:41,57-59
	for index = (thread.frame_depth & frame_count_mask) - 1, 0, -1 do -- T:864-867 I:265 C:3199-3202 J:287; EXEC later publishes the dropped depth
		local frame<const> = ram_base + ((frames + index * sizeof(stopped_frame)) & word_mask) -- T:865 F:21 C:3200 G:42
		retire_open_cells(control, arena, frame, 0) -- T:866 C:3201
	end
	thread.entry = 0 -- T:873 I:53 C:3208
	thread.error_word = 0 -- T:874 I:60-61 C:3209 J:48-49
	thread.error_kind = 0 -- T:874 I:60-61 C:3209 J:48-49
end

local retire_threads<const> = function(management, root, active) -- T:860-862 C:3195-3197; the stopped bank supplies raw root and active addresses
	local control<const> = management + layout.control_offset -- U:50 V:53
	local arena<const> = management + layout.arena_offset -- H:140-143 K:253-256
	while true do -- T:862 C:3197
		local thread<const>: *stopped_thread = active -- T:863,871 I:42-43 C:3198,3206 J:31
		retire_thread_frames(control, arena, active, 0) -- T:864-867 C:3199-3202
		local capacity<const> = thread.stack_capacity -- T:869 I:141 C:3204 J:141 S:63-64
		values.internal.clear_stack_range(thread.stack_block & word_mask, capacity, 0, capacity) -- T:869 I:141 C:3204 J:135-150 S:37,43-46
		thread.stack_top = 0 -- T:870 I:17 C:3205
		thread.status = dead -- T:872 I:46 C:3207 J:34
		thread.entry = 0 -- T:873 I:53 C:3208
		thread.error_word = 0 -- T:874 I:60-61 C:3209 J:48-49; Nil payload before kind
		thread.error_kind = 0 -- T:874 I:60-61 C:3209 J:48-49
		if active == root then break end -- T:875 C:3210
		local resumer = thread.resumer -- T:876 I:47-49 C:3211 J:35-37
		if resumer ~= 0 then -- T:876 I:49 C:3211 J:37
			local offset<const> = resumer & record_mask -- T:876 H:140-141 C:3211 K:253-256,267-269
			local kind<const>: *u8 = ram_base + offset -- T:876 H:140 C:3211 K:255
			if *kind == thread_kind and allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) ~= 0 then -- T:876 H:140-143,158-159 C:3211 K:255-256,267-269
				resumer = ram_base + offset -- T:876 H:140 C:3211 K:256
			else -- T:876 H:140 C:3211 K:256
				resumer = 0 -- T:876 H:140 C:3211 K:256
			end
		end
		thread.resumer = 0 -- T:877 I:51 C:3212 J:39
		active = resumer == 0 and root or resumer -- T:878 C:3213
	end
	local root_thread<const>: *stopped_thread = root -- T:880 I:42-46 C:3215 J:31-34
	root_thread.status = running -- T:880 I:46 C:3215 J:34
end

return { retire_threads = retire_threads, retire_thread_frames = retire_thread_frames, retire_open_cells = retire_open_cells,
	prepare_exec = prepare_exec }
