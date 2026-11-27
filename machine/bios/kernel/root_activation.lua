module<const>

-- Source basis: 81ad6e973c36256da0c4a3052551be75988cee2f.
-- C/T: direct entry; F: Function format; S/Q: Frame control.
-- E/P: call window extent; I/J/N: Thread; V: packed Values.
-- Boot software publishes a complete bank while it still executes in the
-- reset context. The caller owns Thread creation and backing admission.
struct system_entry_record
	code: addr -- F:31
	code_size: u32 -- F:32
	formals: u32 -- F:33
	maximum: u32 -- F:34
	flags: u32 -- F:35
	captures: addr -- F:36
	capture_count: u32 -- F:37
	reserved: u32 -- F:38
end

struct initial_frame
	fn: addr -- S:118
	call_site: addr -- S:119
	open_head: addr -- S:120
	protected: u32 -- S:121
	flags: u32 -- S:122
	pc: addr -- S:123
	vararg_base: u32 -- S:124
	vararg_count: u32 -- S:125
	return_base: u32 -- S:126
	return_count: u32 -- S:127
	top: u32 -- S:128
	closure: addr -- S:129
	stack_base: u32 -- S:130
	stack_capacity: u32 -- S:131
end

struct activation_thread
	before_status: u32[2] -- I:22
	status: u32 -- I:22
	before_stack_top: u32[2] -- I:22
	stack_top: u32 -- I:22
	stack_block: addr -- I:22
	stack_capacity: u32 -- I:22
	before_depth: u32[6] -- I:23
	frame_depth: u32 -- I:24
	protected_depth: u32 -- I:24
	frame_block: addr -- I:24
end

local sign_bit<const> = 0x80000000 -- E:24 P:41; compare raw unsigned Function words
local running<const> = 1 -- I:27 C:137 T:484

local read_system_entry<const> = function(fn) -- C:1893-1896 T:2224-2229
	local body<const>: *system_entry_record = fn -- C:1893 F:29-38
	local code<const>, formals<const>, maximum<const> = body.code, body.formals, body.maximum -- C:1894 T:2225
	local capacity = (formals ~ sign_bit) > (maximum ~ sign_bit) and formals or maximum -- T:2227 E:24 P:41
	if capacity == 0 then capacity = 1 end -- T:2227 E:24 P:41
	return code, formals, capacity -- C:1894-1897 T:2225-2229
end

local publish_system_root<const> = function(address, fn, code, formals, capacity) -- C:1903-1912 T:2232-2241; inputs were admitted by the caller
	local thread<const>: *activation_thread = address -- I:21-24 C:1903-1910
	thread.status = running -- I:27 C:137 T:484
	local frame<const>: *initial_frame = thread.frame_block -- S:117 C:1904
	frame.fn = fn -- S:118 Q:64 C:1905 T:2234
	frame.call_site = code -- S:119 Q:65 C:1905 T:2234
	frame.open_head = 0 -- S:120 Q:66
	frame.protected = -1 -- S:121 Q:67
	frame.flags = 0 -- S:122 Q:57-58,68-70 C:1905 T:2234; System bank, no result placement or exception
	frame.pc = code -- S:123 Q:71 C:1905 T:2234
	frame.vararg_base = formals -- S:124 Q:72 C:1906 T:2235; empty argument sequence at base zero
	frame.vararg_count = 0 -- S:125 Q:73 C:1906 T:2235
	frame.return_base = 0 -- S:126 Q:74 C:1906 T:2235
	frame.return_count = 0 -- S:127 Q:75 C:1906 T:2235
	frame.top = formals -- S:128 Q:76 C:1906 T:2235
	frame.closure = 0 -- S:129 Q:77 C:1906 T:2235
	frame.stack_base = 0 -- S:130 Q:78 C:1906 T:2235
	frame.stack_capacity = capacity -- S:131 Q:79 C:1906 T:2235
	local words<const>: *u32 = thread.stack_block -- C:1908 T:2236 V:75,83
	for i = 0, formals - 1 do words[i] = 0 end -- C:1908 T:2236 V:79,83
	local tags<const>: *u8 = thread.stack_block + 4 * thread.stack_capacity -- C:1908 T:2236 V:75,83 I:29
	for i = 0, formals - 1 do tags[i] = 0 end -- C:1908 T:2236 V:80,83
	thread.stack_top = capacity -- C:1909 T:2238 N:29 P:52
	thread.frame_depth = 1 -- C:1910 T:2239 J:227-235 N:15-21
end

return { read_system_entry = read_system_entry, publish_system_root = publish_system_root }
