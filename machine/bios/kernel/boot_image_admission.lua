module<const>

-- Source basis: 57945b22121ef1e697fd04ef3246da06903921c5.
-- L/N: LuaHeap; T/C: CPU; G/H: GcHeap; B/D: GlobalBank; F: C++ root publication.
-- Raw reset runs without a source grant. Managed image binding preserves its
-- old admission allowance separately from the real cycles paid by this code.
local layout<const> = require('kernel/gc_runtime_layout') -- L:27-30 N:22-25
local arena<const> = require('kernel/dlmalloc') -- L:164 N:177
local record<const> = require('kernel/dlmalloc_record') -- L:113-129,148-155 N:119-139,151-154
local policy<const> = require('kernel/heap_admission') -- L:42-106 N:41-116
local gc<const> = require('kernel/gc_control').internal -- G:912,1022 H:981,1112
local collector<const> = require('kernel/gc_step') -- G:909-927,1018-1025 H:978-998,1109-1114
local stopped<const> = require('kernel/gc_stopped_roots') -- T:928-941,5350-5396 C:219-239,3273-3302 F:327-343
local root_inputs<const> = require('kernel/gc_root_inputs') -- T:4160-4163 F:340-343
local operands<const> = require('kernel/gc_operand_roots') -- L:74-98,160-168 N:81-109,173-178
local atomic<const> = 3 -- G:70 H:20
local current_or_fresh<const> = 0 -- L:18 N:14
local string_tag<const> = 5 -- B:111,116 D:99,104; key is the original first temporary root
-- Names already committed by this operation are read at their owning
-- namespace descriptors by gc_root_banks; no stopped namespace copy.
local publish_roots<const> = function(management, root, key, pending_tag, pending_word) -- T:5383-5396 C:3274-3293 B:111,116 D:99,104
	if root == 0 then -- T:5312 C:2737-2744; the ordinary System CALL has a suspended mutator
		root_inputs.publish(management) -- T:4148-4159,5383-5396 C:3217-3234,3274-3293 F:327-337
	else -- T:5383-5396 C:3274-3293; reset owns the stopped context without a suspended caller
		stopped.publish(management, root) -- T:4148-4159,5383-5396 C:3217-3234,3274-3293 F:327-337
	end
	if pending_tag ~= 0 then return (operands.global_write_scope(management, key, pending_tag, pending_word)) end -- B:111,116 D:99,104; caller supplies the remaining root
	if key ~= 0 then return (operands.single_value_scope(management, string_tag, key)) end -- B:111,116 D:99,104
	return 0 -- L:132-138 N:147-155; record reservation has no explicit operands
end

local step<const> = function(management, control, allowance, scope) -- G:909-917 H:978-985
	if gc.phase(control) == atomic then -- G:912 H:981
		return (collector.finish_atomic(management, scope, false)) -- G:646-672,912 H:689-707,981
	end
	return (collector.step(management, allowance, 0, 0, scope)) -- G:910-917 H:978-985; no compacting Threads in admission
end

local recover<const> = function(management, root, key, state, next, source_cycles, pending_tag, pending_word) -- G:1009-1025 H:1099-1114
	local recovery<const> = policy.begin_allocation_recovery(state, next) -- G:1009-1015,1019-1021 H:1099-1106,1110-1112
	if recovery < 0 then return -1, source_cycles end -- G:1010 H:1100
	local scope<const> = publish_roots(management, root, key, pending_tag, pending_word) -- G:1022 H:1113
	local control<const> = management + layout.control_offset -- G:1022 H:1113
	repeat -- G:1022 H:1113
		local work<const> = step(management, control, collector.step_words, scope) -- T:5302-5304 C:2733-2735
		if root == 0 then source_cycles = policy.spend_assist_allowance(source_cycles, work) end -- T:5302-5304 C:2733-2735
	until not gc.active(control) -- G:1022 H:1113
	root_inputs.release_string_work(management) -- T:4160-4163 F:340-343; return unspent mark credit
	return recovery, source_cycles -- G:1023-1024 H:1114
end

-- requested == 0 is a namespace insertion into existing backing.
-- The bare binding block commits its charge on reservation; namespace
-- backing cannot do so before the owning name write.
local reserve<const> = function(management, root, key, charged, requested, charge_record, source_cycles, pending_tag, pending_word) -- L:73-98,132-168 N:81-116,142-179
	local state<const> = management + layout.arena_offset -- L:113,164 N:119,177
	local control<const> = management + layout.control_offset -- L:30,47 N:25,46
	local next = current_or_fresh -- L:92,160 N:103,173
	if root ~= 0 then source_cycles = collector.step_words * policy.internal.work_word_cycles end -- G:892,898 H:963,969 T:5302-5314 C:2733-2744; permit an entire Idle allowance without debiting it
	local debt<const> = policy.allocation_debt(state, charged) -- L:75 N:85
	if debt < 0 then -- L:76,85-96 N:86,97-107
		if charged > policy.heap_capacity(state) then return false, 0, source_cycles end -- L:86 N:98
		repeat -- L:93-96 N:104-107
			next, source_cycles = recover(management, root, key, state, next, source_cycles, pending_tag, pending_word) -- L:95 N:106
			if next < 0 then return false, 0, source_cycles end -- G:1010 H:1100
		until policy.logical_fits(state, charged) ~= 0 -- L:96 N:107
	elseif debt > 0 and source_cycles >= policy.internal.work_word_cycles then -- L:77-82 N:87-93
		local pressure<const> = policy.logical_assist_pressure(state, charged) -- L:79 N:88
		local allowance<const> = policy.limit_assist_allowance(policy.logical_assist_allowance(debt, pressure), source_cycles) -- L:80 N:89-90
		local scope<const> = publish_roots(management, root, key, pending_tag, pending_word) -- T:5312 C:2737-2744
		local work<const> = step(management, control, allowance, scope) -- T:5312 C:2737-2744
		root_inputs.release_string_work(management) -- T:4160-4163
		policy.credit_logical_assist(state, charged, debt, pressure, work) -- L:81 N:91
		if root == 0 then source_cycles = policy.spend_assist_allowance(source_cycles, work) end -- T:5302-5304 C:2733-2735
	end
	if requested == 0 then return true, 0, source_cycles end -- B:116 D:104
	local allowance<const> = policy.reservation_assist_allowance(state, requested, source_cycles) -- L:101-106 N:112-116 G:887-907 H:958-976 T:5306-5314 C:2737-2744
	if allowance >= 0 then -- G:906 H:974-975; zero is a real collector step
		local scope<const> = publish_roots(management, root, key, pending_tag, pending_word) -- T:5312 C:2737-2744
		local work<const> = step(management, control, allowance, scope) -- G:906 H:974-975
		root_inputs.release_string_work(management) -- T:4160-4163 F:340-343
		if root == 0 then source_cycles = policy.spend_assist_allowance(source_cycles, work) end -- T:5302-5304 C:2733-2735
	end
	while true do -- L:151-155,163-167 N:151-154,176-179
		local base -- L:152,164 N:152,177
		if charge_record then -- L:150-152 N:150-152
			base = record.bmsx_dlmalloc_reserve_record(state, requested, 0, 0, 0, charged, 0, 0, management + layout.occupied_offset) -- L:113-129,152 N:119-139,152
		else -- L:163-168 N:176-179
			base = arena.bmsx_dlmalloc_allocate(state, requested, 0) -- L:164 N:177
		end
		if base ~= 0 then return true, base, source_cycles end -- L:153,165 N:153,178
		next, source_cycles = recover(management, root, key, state, next, source_cycles, pending_tag, pending_word) -- L:154,166 N:154,179
		if next < 0 then return false, 0, source_cycles end -- G:1010 H:1100
	end
end

return { internal = { publish_roots = publish_roots, step = step, recover = recover }, reserve = reserve }
