module<const>

-- Source basis: 027fe97a6495926028a4cea6ef8cd15af8f5d191.
-- T/C: the original timed record continuations; L: native LuaHeap;
-- A: scheduled recovery; G: native collector recovery; S: raw operation
-- selectors. The pinned BLua frame replaces the host's intermediate stages.
-- Operands are unrounded NEWT sizes or a canonical ROM binding.
-- I: NEWT sizes use the decoded 15-bit ABC operands, so their rounded
-- capacity, physical extent and logical charge all fit a signed Integer.
local layout<const> = require('kernel/gc_runtime_layout') -- C:71-74 T:843,855-865
local admission<const> = require('kernel/heap_admission') -- C:9-14,36,43,54-63,174,210-217 T:805-811,827-833,844-849,933,970-976 L:146
local collector<const> = require('kernel/gc_step') -- C:154-159,181-186 A:238-251 G:1225-1229
local records<const> = require('kernel/dlmalloc_record') -- C:55-57 L:119-139,145
local tables<const> = require('kernel/table_create') -- C:7-8,78-83 T:803-804,855-861
local closures<const> = require('kernel/closure_create') -- C:8,84-86 T:804,863-866

local table_kind<const> = 0 -- S:49 C:6 T:802
local direct<const> = 1 -- S:41 C:118 T:903
local retry_current<const> = 3 -- S:41 C:5,138-140 T:801,912
local retry_fresh<const> = 4 -- S:41 C:5,141-142 T:801,909
local current_or_fresh<const> = 0 -- C:26 G:1217
local fresh<const> = 1 -- G:1222 A:313-314
local exhausted<const> = 2 -- G:1216,1222 C:141-142

local allocate_record<const> = function(management, kind, operand0, operand1, mode, source_cycles) -- C:3-4 T:799-800; destination, fault PC and cache publication stay with CPU retirement
	local state<const>, control<const>, occupied<const> = management + layout.arena_offset, management + layout.control_offset, management + layout.occupied_offset -- C:71-74
	local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset -- C:154-158 G:1228; raw root inputs are published without selecting a collector phase
	local table<const> = kind == table_kind -- C:6 T:802
	local binding, array_bytes, hash_bytes, charged, bytes -- C:7-8,55-57,78-86
	if table then -- C:6-8 T:802-804
		binding, array_bytes, hash_bytes, charged, bytes = tables.plan_creation(operand0, operand1) -- C:7-8,56,80-81 T:803-804,843,845
	else -- C:6-8,57,84
		binding = operand1 -- C:7,85 T:864-865
		charged = closures.canonical_bytes -- C:8,57 T:804,845
		bytes = charged -- C:57 T:845
	end

	local roots_published = false -- C:154-158 G:1228; publication is lazy and held across firmware calls
	local recovery = current_or_fresh -- C:26 G:1217
	local admitted -- C:9-14 A:299-300
	if mode == retry_current or mode == retry_fresh then -- C:5,9,11-12,30-31 T:801,805-807
		recovery = mode == retry_current and fresh or exhausted -- C:138-142 A:313-314 T:909,912-917
		admitted = admission.logical_fits(state, charged) ~= 0 -- C:9,12 T:807 L:161-163
	else -- S:41 C:9-14,32-46; Direct or Scheduled initial admission
		local debt<const> = admission.allocation_debt(state, charged) -- C:10 T:805 L:85
		admitted = debt >= 0 -- C:11-14 T:808-811 L:86
		if debt < 0 then -- C:11,32 T:808,823
			if charged > admission.heap_capacity(state) then return 0 end -- C:13 T:809 L:98 I:6,10-11,14-15,32-34; terminal logical OOM
			if mode == direct then -- C:14,32-34 T:810,823-825 L:103-107
				repeat -- L:105-107 C:218-220 T:977-980
					recovery = admission.begin_allocation_recovery(state, recovery) -- C:174-175 T:933-934 G:1215-1222
					if recovery < 0 then break end -- C:168-174 T:927-933 G:1216
					if not roots_published then -- C:154-158 G:1228
						*effects = layout.publish_roots -- C:154-158 G:1228; first GC call borrows the already paused mutator
						roots_published = true -- C:154-158 G:1228
					end
					local work<const> = collector.finish_epoch(management, collector.step_words, 0, 0) -- C:181-186 G:1228-1229; exactly one current or fresh epoch
					source_cycles = admission.spend_assist_allowance(source_cycles, work) -- C:210-214 T:970-973; policy cycles, not machine time
					admitted = admission.logical_fits(state, charged) ~= 0 -- C:218 T:977 L:107
				until admitted -- L:105-107 C:218-220
			end
		elseif debt > 0 and source_cycles >= admission.internal.work_word_cycles then -- C:35 T:826
			local pressure<const> = admission.logical_assist_pressure(state, charged) -- C:36 T:827 L:88
			local words<const> = admission.limit_assist_allowance(admission.logical_assist_allowance(debt, pressure), source_cycles) -- C:43 T:832 L:89
			*effects = layout.publish_roots -- C:154-158 G:1228; first GC call in the assist branch
			roots_published = true -- C:154-158 G:1228
			local work<const> = collector.step(management, words, 0, 0) -- C:43,154-158 T:873-874
			source_cycles = admission.spend_assist_allowance(source_cycles, work) -- C:210-214 T:970-973
			admission.credit_logical_assist(state, charged, debt, pressure, work) -- C:215-217 T:974-976 L:91
		end
		if admitted then -- C:30-46,223 T:835,983 L:164-169; retries do not return to physical admission
			local words<const> = admission.reservation_assist_allowance(state, bytes + records.internal.object_prefix, source_cycles) -- C:54-59 T:843-848 L:164-169
			if words >= 0 then -- C:59 T:847; zero is a present allowance
				if not roots_published then -- C:154-158 G:1228
					*effects = layout.publish_roots -- C:154-158 G:1228
					roots_published = true -- C:154-158 G:1228
				end
				collector.step(management, words, 0, 0) -- C:63,154-159 T:848,873-874
			end
		end
	end

	local offset = 0 -- C:102,118 T:889-890 L:147-153
	while recovery >= 0 do -- C:118-142 A:225-251,313-314 G:1215-1222 L:150-154; one raw recovery token across both kinds of refusal
		if admitted then -- C:9-14 T:805-811 L:147
			if table then -- C:78 T:854
				offset = tables.create_table(state, control, occupied, operand0, binding, array_bytes, hash_bytes, charged) -- C:79-83 T:855-861 L:148-152
			else -- C:84 T:862
				offset = closures.create_closure(state, control, occupied, operand0, binding) -- C:85-86 T:863-866 L:148-152
			end
			if offset ~= 0 then break end -- C:102,116 T:890,901 L:152
		end
		recovery = admission.begin_allocation_recovery(state, recovery) -- C:118-125,134-142 A:225-251,313-314 T:903-920 G:1215-1222
		if recovery < 0 then break end -- C:141-142 T:909 G:1216; both epochs or the permitted retry have been used
		if not roots_published then -- C:154-158 G:1228
			*effects = layout.publish_roots -- C:154-158 G:1228
			roots_published = true -- C:154-158 G:1228
		end
		collector.finish_epoch(management, collector.step_words, 0, 0) -- C:181-186 A:238-251 G:1228; the epoch always runs at least one quantum
		admitted = mode == direct or admission.logical_fits(state, charged) ~= 0 -- C:9-14,206-208 A:299-300 T:807 L:152-153,162; direct physical retries never re-admit
	end
	if roots_published then *effects = layout.release_string_work end -- C:154-158 G:1228; return only the work left in the borrowed String latch
	return offset -- C:102-142 T:889-920; 0 is the original terminal OOM signal before CPU fault delivery
end

return { allocate_record = allocate_record }
