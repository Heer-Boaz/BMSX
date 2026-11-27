module<const>

-- Source basis: 04c10f896545d453bd50fe27ccb619b269966607.
-- T/C/H: LuaHeap; G/K/J: GC; A/B/D: allocator; X/Y: CPU; M: RAM.
-- Only the packer's coherent private arena enters these operations. The
-- allowance is source policy input, not a virtual cycle charge.
local arena<const> = require('kernel/dlmalloc') -- T:324 C:320-321 A:49-51 D:48-50
local collector<const> = require('kernel/gc_control') -- T:47,61,104 G:75-81,1114 C:46,61,115
local pace<const> = require('kernel/gc_pace') -- G:53-57 K:990,994-997 J:52-56
local wide<const> = require('kernel/word_arithmetic') -- G:941-945 K:993-998; native word products and quotient
local ram_base<const> = 0x08000000 -- M:6 A:50 D:49
local allocator_offset<const> = 0x400 -- A:10,25 D:20
local target_offset<const> = 0x340 -- A:7 B:12 T:28 C:23
local control_offset<const> = 0x344 -- A:8 B:13 T:30 C:25
local control_delta<const> = control_offset - allocator_offset -- A:8,10,25 B:13 D:20; the two owners share the management base
local occupied_offset<const> = 0x3f0 -- A:9 B:14 T:29 C:24
local min_collection_bytes<const> = 1024 * 1024 -- T:13,318 H:75 C:328
local reserve_shift<const> = 3 -- T:14 C:12
local min_assist_words<const> = 512 -- T:15 C:13
local step_words<const> = 4096 -- T:16 J:18
local assist_bytes<const> = 256 -- T:17 J:19
local work_word_cycles<const> = 3 -- G:26 Y:2728-2729
local pause<const> = 0 -- G:70,80-81 J:20
local atomic<const> = 3 -- G:70,80-81 J:20
local recovery_current_or_fresh<const> = 0 -- T:18 H:14
local recovery_fresh<const> = 1 -- T:18 H:14
local recovery_exhausted<const> = 2 -- T:18 H:14
local sign_bit<const> = 0x80000000 -- C:41-48 K:993-998; order unsigned word lanes

local heap_capacity<const> = function(state) -- T:324 C:320-321 A:49-50 D:48-49
	local floor<const> = arena.bmsx_dlmalloc_floor(state) -- A:28,41-50 D:31,40-49; raw floor and bus end agree before allocation can run
	return state - allocator_offset - floor -- T:324 C:321 A:50 D:49; arena's limit is management
end

local admitted_total<const> = function(state, charged) -- T:43-44,96,135 C:42-43,107,162
	local occupied<const>: *u32 = ram_base + state - allocator_offset + occupied_offset -- T:322 C:37-38
	local used<const> = *occupied -- T:43,322 C:38,42
	local total<const> = used + charged -- T:43 C:42
	local capacity<const> = heap_capacity(state) -- T:44 C:43
	if (total ~ sign_bit) < (used ~ sign_bit) or (total ~ sign_bit) > (capacity ~ sign_bit) then return -1 end -- T:44 C:43; carry retains the widened sum
	return total -- T:43-44 C:42-43; admitted totals fit installed RAM
end

local allocation_debt<const> = function(state, charged) -- T:42-49 C:41-49
	local total<const> = admitted_total(state, charged) -- T:43-44 C:42-43
	if total < 0 then return -1 end -- T:44 C:43
	local management<const> = state - allocator_offset -- T:27-30 C:23-25
	local target<const>: *u32 = ram_base + management + target_offset -- T:35,45 C:29-30,44
	local next<const> = *target -- T:45 C:44
	if (total ~ sign_bit) <= (next ~ sign_bit) then return 0 end -- T:46 C:45,47
	if collector.internal.phase(management + control_offset) >= atomic then return 0 end -- T:47 C:46-47
	return total - next -- T:48 C:48
end

local logical_fits<const> = function(state, charged) -- T:96,135 C:107,162
	return admitted_total(state, charged) >= 0 and 1 or 0 -- T:96,135 C:107,162; Retry deliberately bypasses debt and GC
end

local logical_assist_pressure<const> = function(state, charged) -- T:51-54 C:51-54
	local capacity<const> = heap_capacity(state) -- T:52 C:52
	local occupied<const>: *u32 = ram_base + state - allocator_offset + occupied_offset -- T:53,322 C:38,53
	local used<const> = *occupied -- T:53 C:53
	local total<const> = used + charged -- T:53 C:53
	local reserve_edge<const> = capacity - (capacity >> reserve_shift) -- T:53 C:53
	return ((total ~ sign_bit) < (used ~ sign_bit) or (total ~ sign_bit) > (reserve_edge ~ sign_bit)) and 1 or 0 -- T:53 C:53
end

local logical_assist_allowance<const> = function(debt, pressure) -- T:56-58 C:56-58
	if pressure ~= 0 then return step_words end -- T:57 C:57
	local halves<const> = (debt + 1) >> 1 -- T:57 C:57; debt is an admitted logical extent
	if halves < min_assist_words then return min_assist_words end -- T:57 C:57
	return halves > step_words and step_words or halves -- T:57 C:57
end

local limit_assist_allowance<const> = function(words, source_cycles) -- X:5320-5325 Y:2725-2729
	if source_cycles < work_word_cycles then return 0 end -- X:5323 Y:2728
	local grant<const> = source_cycles // work_word_cycles -- X:5324 Y:2729
	return words < grant and words or grant -- X:5324 Y:2729
end

local spend_assist_allowance<const> = function(source_cycles, work) -- X:967-971,5316-5317 Y:2721-2722; policy only
	if source_cycles <= 0 or (work ~ sign_bit) > ((source_cycles // work_word_cycles) ~ sign_bit) then return 0 end -- X:971
	return source_cycles - work_word_cycles * work -- X:971,5317 Y:2722
end

local credit_logical_assist<const> = function(state, charged, debt, pressure, work) -- T:60-71 C:60-70
	local management<const> = state - allocator_offset -- T:27-30 C:23-25
	if work == 0 or not collector.internal.active(management + control_offset) then return end -- T:61 C:61
	local occupied<const>: *u32 = ram_base + management + occupied_offset -- T:63,69,322 C:38,63,67
	local target<const>: *u32 = ram_base + management + target_offset -- T:38-39,63,69 C:33-34,63,68
	local used<const> = *occupied -- T:63,69 C:63,67
	if pressure ~= 0 then -- T:62 C:62
		local capped<const> = (work ~ sign_bit) < (step_words ~ sign_bit) and work or step_words -- T:63 C:63
		*target = used + (assist_bytes * capped) // step_words -- T:63 C:63
	else -- T:64 C:64
		local capacity<const> = heap_capacity(state) -- T:67 C:66
		local reserve_edge<const> = capacity - (capacity >> reserve_shift) -- T:68 C:66
		local total<const> = used + charged -- T:69 C:67
		local sum_carry<const> = (total ~ sign_bit) < (used ~ sign_bit) and 1 or 0 -- T:69 C:67; size_t intermediate
		local credited<const> = total + (work << 1) -- T:69 C:67
		local credit_carry<const> = (credited ~ sign_bit) < (total ~ sign_bit) and 1 or 0 -- T:69 C:67
		local borrow<const> = (credited ~ sign_bit) < (debt ~ sign_bit) and 1 or 0 -- T:69 C:68
		local high<const> = sum_carry + (work >> 31) + credit_carry - borrow -- T:69 C:67-68
		local low<const> = credited - debt -- T:69 C:68
		if high < 0 then -- T:69 C:68
			*target = 0 -- T:69 C:68
		elseif high ~= 0 or (low ~ sign_bit) > (reserve_edge ~ sign_bit) then -- T:69 C:68
			*target = reserve_edge -- T:69 C:68
		else -- T:69 C:68
			*target = low -- T:69 C:68
		end
	end
end

local finish_collection<const> = function(state) -- T:314-319 C:324-329
	local management<const> = state - allocator_offset -- T:27-30 C:23-25
	local occupied<const>: *u32 = ram_base + management + occupied_offset -- T:315,322 C:38,325
	local live<const> = *occupied -- T:315 C:325
	local capacity<const> = heap_capacity(state) -- T:316 C:326
	local reserve_edge<const> = capacity - (capacity >> reserve_shift) -- T:318 C:328
	local twice_live<const> = live << 1 -- T:318 C:328
	local threshold<const> = (twice_live ~ sign_bit) < (min_collection_bytes ~ sign_bit) and min_collection_bytes or twice_live -- T:318 C:328
	local next<const> = (live < 0 or (threshold ~ sign_bit) > (reserve_edge ~ sign_bit)) and reserve_edge or threshold -- T:318 C:328; high word of doubled size_t dominates the reserve edge
	local live_with_assist<const> = live + assist_bytes -- T:317 C:327
	local target<const>: *u32 = ram_base + management + target_offset -- T:38-39,317 C:33-34,327
	if (live_with_assist ~ sign_bit) < (live ~ sign_bit) or (live_with_assist ~ sign_bit) > (next ~ sign_bit) then -- T:317 C:327; compare the full addition before publishing its low word
		*target = live_with_assist -- T:317 C:327
	else -- T:317 C:327
		*target = next -- T:317-318 C:327-328
	end
end

local reservation_assist_allowance<const> = function(state, requested, source_cycles) -- T:101-106 G:934-953 C:112-116 K:986-1003
	if source_cycles < work_word_cycles then return -1 end -- X:842,5323 Y:2728; absent assist, not a zero-work assist
	local control<const> = state - allocator_offset + control_offset -- T:27,30 C:23,25
	local phase<const> = collector.internal.phase(control) -- T:104 C:115
	if phase == pause or phase == atomic then return -1 end -- G:80-81 C:115 K:980
	local occupied<const> = arena.bmsx_dlmalloc_occupied_bytes(state) -- G:935 K:988 A:51 D:50
	local after<const> = occupied + requested -- G:935 K:988
	local capacity<const> = heap_capacity(state) -- G:936 K:989
	local pace_address<const> = ram_base + control -- G:937,941-944 K:990,994-997
	local pay_at<const>: *u32 = pace_address + pace.internal.pay_at_offset -- G:57,937 K:990 J:56
	local carry<const> = (after ~ sign_bit) < (occupied ~ sign_bit) -- G:935 K:988; size_t intermediate
	local below_capacity<const> = not carry and (after ~ sign_bit) < (capacity ~ sign_bit) -- G:938,940 K:991-992
	if (after ~ sign_bit) < (*pay_at ~ sign_bit) and below_capacity then return -1 end -- G:937-938 K:990-991
	local allowance = step_words -- G:939 K:992
	if below_capacity then -- G:940 K:992
		local basis_word<const>: *i32 = pace_address + pace.internal.basis_offset -- G:53,941 K:994 J:52
		local basis<const> = *basis_word -- G:941 K:994
		local growth<const> = after - basis -- G:941 K:993-994; low word of the i64 difference
		local estimate_word<const>: *u32 = pace_address + pace.internal.estimate_offset -- G:54,942 K:995 J:53
		local estimate<const> = *estimate_word -- G:942 K:995
		-- The C++ policy casts signed growth to u64 before multiplication.
		-- TS uses signed floating arithmetic; negative growth and subtraction
		-- underflow therefore take the native u64 path, not the TS path.
		local hi<const>, lo<const> = wide.multiply_add_words(growth, estimate, 0) -- G:942 K:995
		local work_high<const> = basis > after and hi - estimate or hi -- G:941-942 K:993-995; sign extension of the widened growth
		local paid<const>: *u32 = pace_address + pace.internal.paid_offset -- G:56,943 K:996 J:55
		local runway<const>: *u32 = pace_address + pace.internal.runway_offset -- G:55,944 K:997 J:54
		local credit<const> = *paid -- G:943 K:996
		local qh<const>, ql<const> = wide.divide_words_by_word(work_high, lo, *runway) -- G:944-945 K:997-998
		local low<const> = ql - credit -- G:945 K:998
		local borrow<const> = (ql ~ sign_bit) < (credit ~ sign_bit) and 1 or 0 -- G:945 K:998
		local high<const> = qh - borrow -- G:945 K:998; u64 subtraction wraps, including a negative high word
		if high == 0 and (low ~ sign_bit) < (step_words ~ sign_bit) then allowance = low end -- G:945 K:998
	end
	local limited<const> = limit_assist_allowance(allowance, source_cycles) -- X:846,5323-5324 Y:2728-2729
	return limited -- G:947,953 K:998,1003
end

local begin_allocation_recovery<const> = function(state, next) -- G:1111-1117 K:1215-1223
	if next == recovery_exhausted then return -1 end -- G:1112 K:1216; caller raises the original allocation fault
	local first<const> = next == recovery_current_or_fresh -- G:1113 K:1217
	local continue_current<const> = first and collector.internal.active(state - allocator_offset + control_offset) -- G:1114 K:1218
	-- The source increments diagnostic counters in host instrumentation
	-- only (G:1115 K:1219-1221). Neither counter is a heap decision.
	return continue_current and recovery_fresh or recovery_exhausted -- G:1116,1122-1125 K:1222,1226-1229; caller completes one epoch before retry
end

local finish_explicit_step<const> = function(state) -- T:283-286 C:286-289
	local management<const> = state - allocator_offset -- T:27-30 C:23-25
	if not collector.internal.active(management + control_offset) then return true end -- T:285-286 C:288-289
	local occupied<const>: *u32 = ram_base + management + occupied_offset -- T:322 C:38
	local target<const>: *u32 = ram_base + management + target_offset -- T:38-39 C:33-34
	*target = *occupied + assist_bytes -- T:285 C:288
	return false -- T:286 C:289
end

return {
	internal = { admitted_total = admitted_total, control_delta = control_delta, work_word_cycles = work_word_cycles,
		target_offset = target_offset, min_collection_bytes = min_collection_bytes }, -- A:7 B:12 T:13,28,31 C:23,26 H:75
	heap_capacity = heap_capacity,
	finish_explicit_step = finish_explicit_step, allocation_debt = allocation_debt, logical_fits = logical_fits,
	logical_assist_pressure = logical_assist_pressure, logical_assist_allowance = logical_assist_allowance,
	limit_assist_allowance = limit_assist_allowance, spend_assist_allowance = spend_assist_allowance,
	credit_logical_assist = credit_logical_assist, finish_collection = finish_collection, reservation_assist_allowance = reservation_assist_allowance,
	begin_allocation_recovery = begin_allocation_recovery,
}
