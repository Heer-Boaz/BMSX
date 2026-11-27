module<const>

-- Source basis: 45025f5cd2063d4c4b2315b9de8ea19f1956b4ae.
-- T/C: Table records, P/Q: CPU parked Table write, H/N: LuaHeap,
-- G/K: GcHeap; X/Y: CPU projection; S/J: StringPool.
-- The initial attempt already resolved __newindex and found
-- an absent canonical key which cannot fit the existing backing.
local layout<const> = require('kernel/gc_runtime_layout') -- P:4047-4052,5245 Q:102 X:170-176
local root_inputs<const> = require('kernel/gc_root_inputs') -- P:4043-4058 X:165-182 S:452-458 J:442-448
local table_create<const> = require('kernel/table_create') -- T:98,852 H:139
local table_plan<const> = require('kernel/table_plan') -- T:675-756,763-784 C:155-246,313-337
local table_resize<const> = require('kernel/table_resize') -- T:795,840-873 C:249-285
local hash_slots<const> = require('kernel/table_reinsert') -- T:530-562 P:853 C:787-838
local existing<const> = require('kernel/table_insert_existing') -- T:553,805-809 C:636-645,835
local assignment<const> = require('kernel/table_assignment') -- T:524-526,571-574 C:775-784
local weak_entries<const> = require('kernel/gc_weak_table')
local word_arithmetic<const> = require('kernel/word_arithmetic')
local allocator<const> = require('kernel/dlmalloc') -- T:101-104 C:834; Integer bands
local admission<const> = require('kernel/heap_admission') -- T:785-793 C:252-256,349-356
local collection<const> = require('kernel/gc_step') -- P:828-837 Q:207-223
local ram_base<const> = layout.ram_base -- P:4047-4049,5245 X:170-172 Y:3252; BLua private address view
local ram_word_mask<const> = 0x003ffffc -- H:55; raw RAM address view
local nil_tag<const>, true_tag<const>, float_tag<const> = 0, 2, 4
local index_nil<const>, index_nan<const>, invalid_argument<const> = 4, 12, 10
local integer_tag<const> = 3 -- T:764 C:314
local table_tag<const> = 6 -- T:655 C:700
local closure_tag<const> = 7 -- T:655 C:700
local thread_tag<const> = 9 -- T:655 C:700
local dead_key<const> = 10 -- T:546,657 C:822,703
local array_census_threshold<const> = 1024 -- T:769 C:323
local hash_census_threshold<const> = 64 -- T:96 C:834
local hash_band_threshold<const> = 1024 -- T:97 C:834
local general_mode<const> = 1
local scheduled_mode<const> = 0 -- P:669-679,852-856 Q:301-314; General covers Direct and RAWSET
local current_or_fresh<const> = 0 -- P:806-808 Q:198
local out_of_memory<const> = 9 -- P:867 Q:267; tag-result gate reserves zero for success
local cpp_policy<const> = 1 -- K:95-102; use the existing C++ color-write policy

struct growth_receiver
	before_hash_storage: u32[3] -- T:35-36 C:309 H:55
	hash_storage: addr -- T:138,806 C:370 H:55
	array: u32 -- T:133,762 C:309 H:55
	hash: u32 -- T:134,762 C:309 H:55
	length: u32 -- T:135,1104 C:784 H:55
	before_array_storage: u32
	array_storage: addr
end

struct growth_operands
	receiver: addr -- P:806-809,853 Q:197-198,248-249
	key_tag: u32 -- P:806-809,853 Q:197-198,248-249
	key_word: u32 -- P:806-809,853 Q:197-198,248-249
	value_tag: u32 -- P:806-809,853 Q:197-198,248-249
	value_word: u32 -- P:806-809,853 Q:197-198,248-249
end

struct growth_density
	cursor: u32 -- T:40,685 C:166,326
	live: u32 -- T:40,681 C:160
	slots: u32 -- T:40,682 C:162
	kept: u32 -- T:40,682 C:162
end

struct growth_request
	reserved_hash: addr -- T:852 C:266; output written in reserve
	reserved_array: addr -- T:855-863 C:269-277; output written in reserve
	key_tag: u32 -- T:840,906 C:415,457
	key_word: u32 -- T:840,906 C:415,457
	value_tag: u32 -- T:840,906 C:415,457
	value_word: u32 -- T:840,906 C:415,457
	previous: u32 -- T:763,908 C:310,459
	requested: u32 -- T:784,908 C:337,459
	keep_hash: u32 -- T:756,842 C:244-245,252
	hash_bytes: u32 -- T:98,852 C:252,266
end

-- GC root banks remain stationary until RET. Its old split-path String
-- transport is borrowed alongside their initial projection, and refilled
-- from the canonical latch only if a later GC fork follows a reserve.
local borrow_collection_roots<const> = function(management, projected) -- P:4043-4053 X:165-177
	if not projected then -- P:4044 X:167
		root_inputs.publish(management) -- P:4043-4053 X:165-177
	else -- P:4049 X:172; the banks are already projected
		root_inputs.borrow_string_work(management) -- S:452-455 J:442-445 G:751 K:777
	end
end

-- General reads probe the canonical key. Only insertion matches the
-- identity tag and payload retained by a tombstone.
local find_hash_node<const> = function(words, tags, hash, kt, kw, match_dead)
	local payloads<const>: *u32 = words
	local tag_bytes<const>: *u8 = tags
	local links<const> = tags + 2 * hash
	local home<const> = hash_slots.internal.hash_canonical_table_key(kt, kw) & (hash - 1)
	local identity<const> = match_dead and (kt == table_tag or kt == closure_tag or kt == thread_tag)
	local slot = home -- T:208,228 C:98,129
	for remaining = hash, 1, -1 do -- T:208,228 C:99,117
		if slot < 0 then break end -- T:208,228 C:99,117
		local tag<const> = tag_bytes[slot] -- T:209,229 C:102
		if tag == kt then -- T:210,230 C:103
			if payloads[slot] == kw then return slot end -- T:210,230 C:104
		elseif identity and tag == 0 and payloads[slot] == kt then -- T:211-213 C:105
			local value_slot<const> = slot + hash -- T:212 C:106
			if tag_bytes[value_slot] == dead_key and payloads[value_slot] == kw then return slot end -- T:212-213 C:107
		end
		slot = hash_slots.internal.hash_next(links, hash, slot) -- T:216,231 C:109
	end
	return -1
end

-- Retry begins at setOwn on the already-resolved receiver, not the
-- initial-absence shortcut used by General physical recovery.
local retry_old_hash<const> = function(management, record, hash, kt, kw, vt, vw) -- P:850-855 Q:246-250 T:509-568 C:740-761,787-845
	if hash == 0 then return false end -- T:542,552 C:793,829; no hash probe without backing
	local header<const>: *growth_receiver = ram_base + (record & ram_word_mask) -- T:138 C:793
	local words<const> = ram_base + (header.hash_storage & ram_word_mask) -- T:536 C:792
	local tags<const> = words + 8 * hash -- T:536 C:791
	local tag_bytes<const>: *u8 = tags
	local slot<const> = find_hash_node(words, tags, hash, kt, kw, true)
	if slot < 0 then -- T:552-562 C:829-838
		local found<const> = existing.insert_hash_without_growth(management + layout.control_offset, record, kt, kw, vt, vw, cpp_policy) -- T:555 C:835
		if found < 0 then return false end -- T:556,564 C:836,844
		assignment.finish_table_insertion(management, record, kt, kw, vt, vw, cpp_policy) -- T:559,526 C:837,761
		return true -- T:560 C:838
	end
	local value_slot<const> = slot + hash -- T:545 C:820
	local prior<const> = tag_bytes[value_slot] -- T:545 C:821
	if prior ~= 0 and prior ~= dead_key then -- T:546 C:822
		assignment.overwrite_table_value(management, record, words, tags, value_slot, vt, vw) -- T:547-548 C:825-826
		if kt == integer_tag and kw > 0 and kw - 1 == header.length then header.length = kw end -- T:526,1105 C:761,784
		return true -- T:549 C:827
	end
	-- Live resurrection occupies the matched node, not a free search.
	if hash > hash_census_threshold then -- T:107,557 C:833-834
		local live<const>: *u32 = words + table_create.internal.hash_node_bytes(hash) -- T:108 C:834
		*live = *live + 1 -- T:109,557 C:834; C++ publishes before the slot lanes
		if hash >= hash_band_threshold and kt == integer_tag and kw > 0 then -- T:101,558 C:834
			local index<const> = kw - 1 -- T:102 C:834
			local bin<const> = index == 0 and 0 or allocator.internal.highest_bit(index) + 1 -- T:102 C:834
			local band<const>: *u32 = live + 4 * (bin + 1) -- T:103 C:834
			*band = *band + 1 -- T:104,558 C:834
		end
	end
	hash_slots.internal.write_slot(words, tags, slot, kt, kw) -- T:553 C:835
	hash_slots.internal.write_slot(words, tags, value_slot, vt, vw) -- T:554 C:836
	assignment.finish_table_insertion(management, record, kt, kw, vt, vw, cpp_policy) -- T:559,526 C:837,761
	return true -- T:560 C:838
end

local grow_table<const> = function(management, source_cycles, preferred_extra, mode) -- T:758-811 C:297-377 P:662-678,803-869 Q:97-271
	local scheduled<const> = mode == scheduled_mode -- T:769-771,802 C:322-325,364-368; admission policy, not the CPU's run-kind
	local state<const> = management + layout.arena_offset -- T:792 C:252
	local head<const> = management + layout.remark_head_offset -- P:5245 Y:3252
	local operands_offset<const> = head + layout.remark_receiver_offset -- P:5254-5256 Y:3260-3262
	local operands<const>: *growth_operands = ram_base + operands_offset -- P:806 Q:197-199
	local parked<const>: *u32 = ram_base + head + layout.remark_parked_assignment_offset -- P:5257-5259 Y:3263-3265
	local record<const>, kt<const>, kw<const> = operands.receiver, operands.key_tag, operands.key_word -- P:845-853 Q:240-249
	local vt<const>, vw<const> = operands.value_tag, operands.value_word -- P:853 Q:249
	local table<const>: *growth_receiver = ram_base + (record & ram_word_mask) -- T:121 Q:248
	local old_array<const>, old_hash<const> = table.array, table.hash -- T:762 C:309
	local scratch<const> = management + layout.table_plan_offset -- T:670-756 C:155-246; raw density/bands, then reservation request
	local density<const>: *growth_density = ram_base + scratch -- T:774-778 C:325-330
	local request<const>: *growth_request = ram_base + scratch -- P:693-704,714-715 Q:105-124,128-129; same phase-disjoint bytes
	local device_cycles<const>: *word = layout.remaining_device_cycles_address -- T:685-688 C:166-170; real source allowance frontier
	local array_cycles<const>, hash_cycles<const> = table_plan.census_cycles(old_array, old_hash, kt, kw) -- T:764-767 C:313-317
	local projected, borrowed = false, false -- P:4043-4058 X:165-182; root publication is lazy
	local recovery = current_or_fresh -- P:806-808 Q:197-199
	local resume = false -- T:769-771 P:851 Q:247
	while true do -- P:827-869 Q:207-269 T:768-811 C:321-375; one retry sequence, two entry policies
		local extra = (scheduled or recovery == current_or_fresh) and preferred_extra or 0 -- P:852-854 Q:249-250 T:798-803 C:360-367; Scheduled restarts from setOwn; General keeps the exhausted preference
		while true do -- T:768-802 C:321-365; preference fallback does not reprobe
			local counted = 0 -- T:768-783 C:321-336
			if old_array >= array_census_threshold and array_cycles ~= 0 and (resume or array_cycles > source_cycles) then -- T:769-778 C:322-330
				density.cursor = 0 -- T:775 C:326-330
				density.live = 0 -- T:775 C:326-330
				density.slots = 0 -- T:775 C:326-330
				density.kept = 0 -- T:775 C:326-330
				if not resume then source_cycles = table_plan.spend_census_grant(record, scratch, source_cycles) end -- T:778 C:330
				while density.cursor ~= old_array do -- T:911-913 C:391-393
					source_cycles = *device_cycles -- T:911 C:392; only at a genuine census resumption
					source_cycles = table_plan.spend_census_grant(record, scratch, source_cycles) -- T:912 C:392
				end
				counted = 1 -- T:920 C:402-405
			end
			source_cycles = source_cycles - (counted == 0 and array_cycles or 0) - hash_cycles -- T:781 C:334
			local array<const>, hash<const>, keep<const> = table_plan.plan_rehash(record, kt, kw, extra, counted, scratch) -- T:782-783 C:335-336
			local previous<const>, requested<const>, bytes<const>, staged_growth<const>, staged<const> = table_plan.plan_reservation(old_array, old_hash, array, hash, keep) -- T:763,784,790,846-847 C:252,258-260,310,337
			local admitted = true -- T:786 C:338
			local charged<const> = requested - previous -- T:786-788 C:349-356
			if charged > 0 then -- T:786 C:349
				if resume or recovery ~= current_or_fresh then -- T:786-788 C:351-352; every post-recovery replan admits only the capacity
					admitted = admission.logical_fits(state, charged) ~= 0 -- T:787 C:352
				else -- T:788 C:353
					local debt<const> = admission.allocation_debt(state, charged) -- H:85-89 N:85-91; Table prepare does not have fixed Record's impossible-size fault
					admitted = debt >= 0 -- H:85-86 N:85-86
					if debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- H:87-89 N:87-89
						local pressure<const> = admission.logical_assist_pressure(state, charged) -- H:88 N:88
						local words<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- H:89 N:89
						if not borrowed then -- P:4043-4053 X:165-177
							borrow_collection_roots(management, projected) -- P:4043-4053 X:165-177
							projected, borrowed = true, true -- P:4043-4053 X:165-177
						end
						local work<const> = collection.step(management, words, 0, 0, operands_offset) -- H:89 N:89; explicit receiver/key/value scope
						source_cycles = admission.spend_assist_allowance(source_cycles, work) -- T:785,792 C:350,355; source policy only
						admission.credit_logical_assist(state, charged, debt, pressure, work) -- H:90 N:90
					end
				end
			end
			if admitted and not resume then -- T:789-793 C:252-256
				local words<const> = admission.reservation_assist_allowance(state, bytes, source_cycles) -- T:792-793 C:255; zero is an admitted quantum
				if words >= 0 then -- G:934-953 K:986-1003
					if not borrowed then -- P:4043-4053 X:165-177
						borrow_collection_roots(management, projected) -- P:4043-4053 X:165-177
						projected, borrowed = true, true -- P:4043-4053 X:165-177
					end
					local work<const> = collection.step(management, words, 0, 0, operands_offset) -- T:793 C:255
					source_cycles = admission.spend_assist_allowance(source_cycles, work) -- P:700,757-759 Q:115-116,178-179; latch budget before any preferred replan
				end
			end
			if borrowed then -- P:4055-4058 X:179-182
				root_inputs.release_string_work(management) -- P:4055-4058 X:179-182; assignment reads its canonical latch
				borrowed = false -- P:4055-4058 X:179-182
			end
			if admitted then -- T:789,795-796 C:356-358
				request.key_tag = kt -- P:695 Q:118
				request.key_word = kw -- P:695 Q:118
				request.value_tag = vt -- P:696 Q:119
				request.value_word = vw -- P:696 Q:119
				request.previous = previous -- P:714 Q:128
				request.requested = requested -- P:714 Q:128
				request.keep_hash = keep -- P:704,715 Q:123,129
				request.hash_bytes = table_create.internal.hash_storage_bytes(hash) -- P:693 Q:105
				local result -- T:795 C:357
				if staged ~= 0 then -- T:847-850 C:258-263
					result = table_resize.execute_staged_table_growth(management, record, array, hash, staged_growth, scratch) -- T:858-865 C:279-282
				else -- T:868 C:285
					result = table_resize.execute_table_resize(management, record, array, hash, scratch) -- T:868-908 C:285,415-459
				end
				if result ~= 0 then return 0, table_tag, record end -- T:796 C:358; operation and epilogue already completed
			end
			if extra == 0 then break end -- T:798-802 C:360-365
			extra = 0 -- T:799 C:361; same attempt and remaining allowance
		end
		recovery = admission.begin_allocation_recovery(state, recovery) -- P:806-808,828-865 Q:197,207-269 G:1110-1115,1121 K:1213-1220,1224; Current if active, then Fresh once
		if recovery < 0 then return out_of_memory + 1, 0, 0 end -- P:861-869 Q:259-268 G:1111 K:1214; terminal OOM at the original issuer
		borrow_collection_roots(management, projected) -- P:4043-4053 X:165-177; no pending borrowed work at this point
		projected = true -- P:4043-4053 X:165-177
		if scheduled then -- T:802 C:364-366; Scheduled owns its stopped, parked recovery
			*parked = 1 -- P:5252-5259 Y:3258-3265; native parked root, not an explicit assist triple
			collection.finish_epoch(management, collection.step_words, 0, 0, 0) -- P:828-838 Q:211-225
			*parked = 0 -- P:853-863 Q:251-268
			root_inputs.release_string_work(management) -- P:4055-4058 X:179-182
			source_cycles = *device_cycles -- P:849-854 Q:245-250; a resumed instruction's allowance
			if retry_old_hash(management, record, old_hash, kt, kw, vt, vw) then return 0, table_tag, record end -- P:852-858 Q:249-257
			resume = true -- T:510,770,786,791 C:740,323,351
		else -- T:803-809 C:367-373; General does not park or repeat the own-key probe
			local work<const> = collection.finish_epoch(management, collection.step_words, 0, 0, operands_offset) -- T:803 C:367 G:1119-1124 K:1223-1227; scoped operands, original fixed epoch quantum
			root_inputs.release_string_work(management) -- P:4055-4058 X:179-182; insertion consumes the owning latch
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- T:781,793,803 C:334,367 G:1123 K:1226; shadow policy credit, not CPU time
			if old_hash ~= 0 then -- T:805 C:369
				local slot<const> = existing.insert_hash_without_growth(management + layout.control_offset, record, kt, kw, vt, vw, cpp_policy) -- T:806-809 C:370-372; weak clearing may have opened the old backing
				if slot >= 0 then -- T:809 C:373
					assignment.finish_table_insertion(management, record, kt, kw, vt, vw, cpp_policy) -- T:524-526,565-566 C:761,847-848; continue the original successful insertion epilogue
					return 0, table_tag, record -- T:809 C:373
				end
			end
		end
	end
end

-- RawSet uses the existing normal tagged CALL transport. No metamethod
-- lookup precedes setOwn, and the bound receiver remains the return value.
local raw_set<const> = function(target, key, value, supplied)
	local management_port<const>: *u32 = layout.management_address
	local fault<const>: *u32 = layout.call_fault_address
	local management<const> = *management_port
	local cell<const> = ram_base + management + layout.value_cell_offset
	local argument<const>: *value = cell
	local tag<const>: *u8 = cell + layout.value_cell_tag_offset
	local payload<const>: *u32 = cell
	*argument = target
	if *tag ~= table_tag or supplied < 3 then
		*fault = invalid_argument
		return nil
	end
	local record<const> = *payload
	*argument = key
	local kt, kw = *tag, *payload
	if kt == nil_tag then
		*fault = index_nil
		return nil
	elseif kt <= true_tag then
		kw = 0
	elseif kt == float_tag then
		if key ~= key then
			*fault = index_nan
			return nil
		end
		local integer<const> = word_arithmetic.float_to_word(kw)
		if key == integer then kt, kw = integer_tag, integer end
	end
	*argument = value
	local vt<const>, vw<const> = *tag, *payload
	local header<const>: *growth_receiver = record
	local positive_integer<const> = kt == integer_tag and kw > 0
	if positive_integer and kw <= header.array then
		local planes<const> = header.array_storage
		assignment.overwrite_table_value(management, record, planes, planes + 4 * header.array, kw - 1, vt, vw)
	elseif vt == nil_tag then
		local hash<const> = header.hash
		if hash ~= 0 then
			local planes<const> = header.hash_storage
			local tags<const> = planes + 8 * hash
			local slot<const> = find_hash_node(planes, tags, hash, kt, kw, false)
			if slot >= 0 then
				local tags_bytes<const>: *u8 = tags
				if tags_bytes[slot + hash] ~= nil_tag then
					local new_index<const>: *u32 = ram_base + management + layout.remark_head_offset + layout.remark_new_index_offset
					weak_entries.internal.mark_hash_node_dead(record, planes, tags, hash, slot, kt, kw, *new_index)
				end
			end
		end
	elseif not retry_old_hash(management, record, header.hash, kt, kw, vt, vw) then
		local operands<const>: *growth_operands = ram_base + management + layout.remark_head_offset + layout.remark_receiver_offset
		operands.receiver, operands.key_tag, operands.key_word = record, kt, kw
		operands.value_tag, operands.value_word = vt, vw
		local cycles<const>: *u32 = layout.call_cycles_address
		local status<const> = grow_table(management, *cycles, 0, general_mode)
		if status ~= 0 then
			*fault = status - 1
			return nil
		end
	end
	if positive_integer then
		local hint<const> = header.length
		if vt == nil_tag and kw == hint then header.length = kw - 1
		elseif vt ~= nil_tag and kw - 1 == hint then header.length = kw end
	end
	return target
end

return {
	internal = { borrow_collection_roots = borrow_collection_roots, retry_old_hash = retry_old_hash, find_hash_node = find_hash_node },
	grow_table = grow_table, raw_set = raw_set,
}
