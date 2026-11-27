module<const>

-- Source basis: 61e40427ed56ea18e7fad271ef3afa1735b9ba9e.
-- T/C/H: GcHeap; O/P: GC object layout; V/W: tags; B/D: Table;
-- U/J/N: Upvalue; I/K: Thread; S: RAM. L/R/A pin the later RAM-backed
-- String work latch at 59fb80ee550356ff2fa39e57ba4944ae808b4742.
-- Moved-entry pairs are ordered
-- stores; the mutator may not re-enter until this operation returns.
local control_layout<const> = require('kernel/gc_control') -- T:198,203,222,233 C:107,111,126,137,147
local layout<const> = require('kernel/gc_runtime_layout') -- L:67-70 R:41-43 A:8,10
local mark<const> = require('kernel/gc_mark') -- T:192,213-214,223-224,226,234,236,246 C:122,127-130,138-142,148-151,163 H:127

local ram_base<const> = 0x08000000 -- S:6
local ram_word_mask<const> = 0x003ffffc -- S:7-9
local ram_byte_mask<const> = 0x003fffff -- S:7
local color_offset<const> = 1 -- O:3 P:6
local color_mask<const> = 3 -- O:4 P:7
local black<const> = 3 -- T:192,221,229,246 C:135,163 H:127,130,135
local record_link<const> = 4 -- O:8 P:15
local upvalue_next<const> = 12 -- U:17 J:19
local upvalue_value_tag<const> = 3 -- U:14 J:16
local upvalue_value_word<const> = 4 -- U:15 J:17
local gray_index_bits<const> = 19 -- O:12 P:17
local trace_head<const> = 4 -- T:25 H:23
local changed_head<const> = 8 -- T:26 H:24
local trace_record<const> = 0x34 -- T:33 H:32
local remark_visit_state<const> = 0x48 -- T:35-39 H:34-38
local mode_meta<const> = 0x4c -- T:40 H:39
local table_metatable<const> = 8 -- B:34 D:27
local phase_mark<const> = 1 -- T:68 H:19
local phase_mark_again<const> = 2 -- T:68 H:19
local phase_atomic<const> = 3 -- T:68 H:19
local remark_none<const> = 0 -- T:62 H:144
local remark_weak<const> = 2 -- T:62 H:144
local remark_roots<const> = 3 -- T:62 H:144
local nil_tag<const> = 0 -- V:9 W:21
local table_tag<const> = 6 -- V:9-11 W:21-22
local string_tag<const> = 5 -- V:9-11 W:21-22
local builtin_tag<const> = 8 -- V:9-11 W:21-22
local thread_tag<const> = 9 -- V:9-11 W:21-22
local thread_kind<const> = 4 -- I:33 K:18 T:213

local has_edge<const> = function(tag) -- V:20 W:48
	return tag >= string_tag and tag <= thread_tag and tag ~= builtin_tag -- V:21 W:49
end

local mark_color<const> = function(address) -- T:172 H:145
	local color<const>: *u8 = ram_base + ((address + color_offset) & ram_byte_mask) -- T:172 H:145
	return *color & color_mask -- T:172 H:145
end

local write_barrier<const> = function(control, address, link, cpp_mirror) -- T:191 H:126
	if mark_color(address) == black then mark.enqueue(control, address, link, changed_head, cpp_mirror) end -- T:192 H:127
end

-- Pending String work is passed and returned explicitly. Only the old
-- credit sites consume it; rescan-only gates leave the pending work alone.
local credit_barrier_marks<const> = function(control, pending) -- T:195,197 C:104,107
	if pending ~= 0 then control_layout.account_epoch_work(control, pending) end -- T:198 C:107
end

local mark_global_write<const> = function(control, arena, metadata, tag, payload, cpp_mirror, pending) -- T:202 C:110 H:124
	local phase<const> = control_layout.internal.phase(control) -- T:203 C:111
	if phase < phase_mark or phase > phase_atomic then return pending end -- T:204 C:112
	if tag == string_tag then -- T:205 C:113
		local _<const>, work<const> = mark.mark_value(control, arena, metadata, tag, payload, trace_head, cpp_mirror) -- T:206 C:114
		credit_barrier_marks(control, pending + work) -- T:207 C:115
		return 0 -- T:208 C:116; return the drained work latch
	end
	-- Changed replaces Trace at detach, so owners visited before that must
	-- publish to Changed. MarkAgain explicitly selects the Roots lane.
	local state<const>: *u32 = ram_base + control + remark_visit_state -- T:211,611-612 C:118 H:186-187
	local stage<const> = phase == phase_mark_again and remark_roots or (*state >> gray_index_bits) -- T:211,612 C:118 H:187
	local before_detach<const> = stage <= remark_weak and (stage ~= remark_none or phase == phase_atomic) -- T:212 C:121
	local queue<const> = before_detach and changed_head or trace_head -- T:214 C:122
	if cpp_mirror ~= 0 then -- T:213-214 C:122; preserve the native entry-point dispatch
		mark.mark_value(control, arena, metadata, tag, payload, queue, cpp_mirror) -- C:122
	else -- T:213-214; TS caller already admitted an edge
		mark.mark_record(control, arena, payload, tag == thread_tag and thread_kind or tag, queue, cpp_mirror) -- T:213-214
	end
	return pending -- T:215 C:123; no credit on an object edge
end

-- No re-admission here: generated stores have a black-owner gate. Only
-- insertion supplies a key; overwrites trace just the new value.
local write_black_table_assignment<const> = function(control, arena, metadata, table, tag, payload, inserted_key, key_tag, key_payload, cpp_mirror, pending) -- T:219,222 C:125,134,137 H:139
	local meta<const>: *u32 = ram_base + ((table + table_metatable) & ram_word_mask) -- T:222 C:126,137 B:120,122 D:195
	if control_layout.internal.phase(control) == phase_mark_again and *meta == 0 then -- T:222 C:126,137
		if inserted_key ~= 0 then -- T:223 C:138; C++ Entry takes the key unconditionally
			local _<const>, work<const> = mark.mark_value(control, arena, metadata, key_tag, key_payload, trace_head, cpp_mirror) -- T:223 C:138
			pending = pending + work -- T:223,225 C:138,140; explicit String work latch
		end
		local _<const>, work<const> = mark.mark_value(control, arena, metadata, tag, payload, trace_head, cpp_mirror) -- T:224 C:127,139
		credit_barrier_marks(control, pending + work) -- T:225 C:128,140
		return 0 -- T:225 C:128,140; return the drained work latch
	end
	mark.enqueue(control, table, record_link, changed_head, cpp_mirror) -- T:226 C:129-130,141-142
	return pending -- T:227 C:132,144; no credit on rescan
end

local write_table_assignment<const> = function(control, arena, metadata, table, tag, payload, inserted_key, key_tag, key_payload, cpp_mirror, pending) -- T:219 C:134 H:129,133
	if not has_edge(tag) and (inserted_key == 0 or not has_edge(key_tag)) then return pending end -- T:220 C:135-136 H:130; disjoint edge predicates are pure
	if mark_color(table) ~= black then return pending end -- T:221 C:135-136 H:130
	local remaining<const> = write_black_table_assignment(control, arena, metadata, table, tag, payload, inserted_key, key_tag, key_payload, cpp_mirror, pending) -- T:222-226 C:137-142 H:131
	return remaining -- T:227 C:144; fixed scalar result
end

local write_black_closed_value<const> = function(control, arena, metadata, cell, tag, payload, cpp_mirror) -- T:232 C:146 H:140
	if control_layout.internal.phase(control) == phase_mark_again then -- T:233 C:147
		local _<const>, marked<const> = mark.mark_value(control, arena, metadata, tag, payload, trace_head, cpp_mirror) -- T:234 C:148 L:447-449 R:438-439
		local latch<const>: *u32 = ram_base + control - layout.control_offset + layout.string_mark_work_offset -- L:67-70 R:41-43 A:8,10
		if marked ~= 0 then *latch = *latch + marked end -- L:449 R:439
		local work<const> = *latch -- L:452-455 R:442-445
		if work ~= 0 then -- T:195,197 C:104,107 L:454 R:444
			*latch = 0 -- L:454 R:444
			control_layout.account_epoch_work(control, work) -- T:197-198,235 C:107,149
		end
	else -- T:236 C:150
		mark.enqueue(control, cell, upvalue_next, changed_head, cpp_mirror) -- T:236 C:151
	end
end

local write_closed_value<const> = function(control, arena, metadata, cell, tag, payload, cpp_mirror) -- T:228 H:134
	if not has_edge(tag) or mark_color(cell) ~= black then return end -- T:229 H:135
	write_black_closed_value(control, arena, metadata, cell, tag, payload, cpp_mirror) -- T:230-231 H:136-137
end

-- The SETUP caller already admitted a closed black cell and an edge.
-- The cell is its canonical RAM offset, not a public raw address.
local store_black_closed_value<const> = function(control, arena, metadata, cell_offset, tag, payload, cpp_mirror) -- U:63-67 N:65-72
	write_black_closed_value(control, arena, metadata, cell_offset, tag, payload, cpp_mirror) -- U:67 N:72
	local value<const>: *u32 = ram_base + cell_offset + upvalue_value_word -- U:68 N:68,74
	*value = payload -- U:68 N:74
	local tag_lane<const>: *u8 = ram_base + cell_offset + upvalue_value_tag -- U:69 N:68,75
	*tag_lane = tag -- U:69-70 N:75
end

-- The private SETUP transaction receives ordinary tagged fixed-frame
-- inputs. Project the Value once, then preserve the native store sequence.
local store_closed_upvalue<const> = function(cell_offset, value) -- U:63-69 N:65-75; trusted fixed entry
	local management_port<const>: *u32 = layout.management_address -- A:8,10; private management port
	local management<const> = *management_port -- A:8,10
	local address<const> = ram_base + management + layout.value_cell_offset -- U:63,67-69 N:65,72-75; tagged transport
	local tagged_value<const>: *value = address -- U:63 N:65; tagged transport
	*tagged_value = value -- U:63 N:65; tagged transport
	local tag<const>: *u8 = address + layout.value_cell_tag_offset -- U:67,69 N:72,75
	local word<const>: *u32 = address -- U:67-68 N:72,74
	store_black_closed_value(management + layout.control_offset, management + layout.arena_offset, -- T:232-236 N:72; canonical collector association
		management + layout.metadata_offset, cell_offset, *tag, *word, 1) -- N:72-75 C:146-153; canonical C++ color store
end

local table_entries_moved<const> = function(control, address, cpp_mirror) -- T:238 C:155 H:141
	local trace<const>: *u32 = ram_base + control + trace_record -- T:239,243 C:156,160
	local table<const> = trace[0] -- T:239 C:156
	local mode<const>: *u32 = ram_base + control + mode_meta -- T:240,244-245 C:157,161-162
	if table ~= address and mode[0] ~= address then return end -- T:240 C:157
	trace[0] = 0 -- T:243 C:160
	trace[1] = 0 -- T:243 C:160
	mode[0] = 0 -- T:244 C:161
	mode[1] = 0 -- T:244 C:161
	mode[2] = 0 -- T:245 C:162
	if mark_color(table) == black then mark.enqueue(control, table, record_link, changed_head, cpp_mirror) end -- T:246 C:163
end

-- SetMetatable basis: f597677159b0029376458a12c1bd762da46b2361.
-- C/T: builtin entry; B/D: Table owner; E: fault reasons.
-- The C++ color-byte store is the existing common BIOS barrier policy.
local invalid_argument<const> = 10 -- E:44 C:1209 T:4970,4980

local set_metatable<const> = function(target, metatable) -- C:1206-1212 T:4967-4985
	local port<const>: *u32 = layout.management_address -- C:1207 T:4968; existing resident call context
	local fault<const>: *u32 = layout.call_fault_address -- C:1209 T:4970,4980; generic CALL faults
	local management<const> = *port -- C:1207 T:4968; same context
	local cell<const> = ram_base + management + layout.value_cell_offset -- C:1207-1209 T:4968-4979; existing typed exchange
	local value<const>: *value = cell -- C:1207-1208 T:4968-4979
	local word<const>: *u32 = cell -- C:1210 T:4972,4978
	local tag<const>: *u8 = cell + layout.value_cell_tag_offset -- C:1209 T:4969,4976
	*value = target -- C:1207 T:4968
	if *tag ~= table_tag then -- C:1208-1209 T:4969
		*fault = invalid_argument -- C:1209 T:4970
		return nil -- C:1209 T:4970; no mutation on invalid argument
	end
	local address<const> = *word -- C:1210 T:4972
	*value = metatable -- C:1208 T:4974-4976; an absent argument is Nil
	local kind<const> = *tag -- C:1209-1210 T:4976
	local replacement = 0 -- C:1210 T:4973
	if kind == table_tag then -- C:1209-1210 T:4977
		replacement = *word -- C:1210 T:4978
	elseif kind ~= nil_tag then -- C:1209 T:4979
		*fault = invalid_argument -- C:1209 T:4980
		return nil -- C:1209 T:4980; neither queue nor record has changed
	end
	write_barrier(management + layout.control_offset, address, record_link, 1) -- B:33-34 D:105-106 T:4983
	local field<const>: *u32 = address + table_metatable -- B:35 D:107
	*field = replacement -- B:35 D:107
	return target -- C:1211-1212 T:4983-4984
end

return {
	internal = { has_edge = has_edge, mark_color = mark_color, credit_barrier_marks = credit_barrier_marks },
	write_barrier = write_barrier,
	set_metatable = set_metatable,
	mark_global_write = mark_global_write,
	write_black_table_assignment = write_black_table_assignment,
	write_table_assignment = write_table_assignment,
	write_black_closed_value = write_black_closed_value,
	write_closed_value = write_closed_value,
	store_black_closed_value = store_black_closed_value,
	store_closed_upvalue = store_closed_upvalue,
	table_entries_moved = table_entries_moved,
}
