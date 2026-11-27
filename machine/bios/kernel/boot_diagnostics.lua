module<const>

-- Source basis: b8fd922892acf5a776f4a69164d779d6f9b6bec9.
-- T/C: CPU construction; G: native collector construction; F: image-format
-- records; S/R: StringPool; P/Q: existing root fields and Lua fault ordinals.
local layout<const> = require('kernel/gc_runtime_layout') -- T:469,471-475 C:114-120
local strings<const> = require('kernel/string_record') -- S:86-88 R:60-63
local intern<const> = require('kernel/string_slice') -- S:331-332 R:327-329

-- These .rodata words are linked constant ordinals, not bound Lua Values.
-- The bytes are borrowed directly from the immutable linked String records.
rodata source_text: string[17] = { -- T:445-448,455-467 C:96,101-112 G:20
	'__index',
	'__newindex',
	'__len',
	'__mode',
	'error in error handling',
	'Attempted to get length of an unsupported value.',
	'Attempted to call a non-function value.',
	'Attempted to index field on a non-table value.',
	'Attempted to assign to a non-table value.',
	'Table index is nil.',
	'Metatable index chain too long.',
	'Attempted to iterate a non-table value.',
	'xpcall error handler must be a function.',
	'Out of memory.',
	'Invalid argument.',
	"invalid key to 'next'",
	'Table index is NaN.',
}

local faults_offset<const> = 0x6c8 -- T:471 C:116 P:105
local storage_refused<const> = 10 -- Q:43; code is LuaFault+1, like other boot producers
local header_bytes<const> = 16 -- F:57 S:90 R:69

struct constant_record
	tag: u32 -- F:49
	word: u32 -- F:50
	reserved: u32 -- F:48
end

struct startup_root_head
	pending_string_work: u32 -- P:107
	mode: addr -- T:472 C:117 P:107
	index: addr -- T:473 C:118 P:107
	new_index: addr -- T:473 C:118 P:107
	length: addr -- T:474 C:119 P:107
	error: addr -- T:474 C:119 P:107
	fault_ids: addr -- T:475 C:120 P:107
end

-- The caller initialized the arena, not the System String directory.
-- Collect the original constructor's local results in private workspace.
-- The cold boot cannot own a table plan yet; this prefix stays unobservable
-- as a root until all seventeen Names exist.
local initialize_diagnostics<const> = function(management, constants) -- T:444-448,455-479 C:96,100-123 G:20
	local ordinals<const>: *u32 = &source_text[0] -- F:48-50; read the existing ordinal relocation
	local table<const>: *constant_record = constants -- F:10,48-50
	local stage<const>: *u32 = layout.ram_base + management + layout.table_plan_offset -- T:445-448,455-467 C:96,101-112 G:20; constructor locals in private cold work storage
	local metadata<const>, arena<const> = management + layout.metadata_offset, management + layout.arena_offset -- S:65,370 R:42,361
	local occupied<const> = management + layout.occupied_offset -- S:393 R:383
	for slot = 0, 16 do -- T:445-448,455-467 C:96,101-112 G:20; declaration order is allocation order
		local source<const> = table[ordinals[slot]].word -- F:50 S:331-332 R:327-329
		local size<const> = strings.byte_length(source) -- S:331-332 R:327-329; immutable linked bytes replace host literal storage
		local id<const> = intern.intern_cold_span(metadata, arena, occupied, source + header_bytes, size) -- S:331-332 R:327-329; ROM directories unpublished
		if id == 0 then return storage_refused end -- S:373,393 R:363,383; first refused record
		stage[slot] = id -- T:445-448,455-467 C:96,101-112 G:20
	end

	local state<const>: *startup_root_head = layout.ram_base + management + layout.remark_head_offset -- T:471 C:116 P:104
	local faults<const>: *u32 = layout.ram_base + management + faults_offset -- T:471 C:116 P:105
	state.mode = stage[3] -- T:448,472 C:117 G:20
	state.index, state.new_index = stage[0], stage[1] -- T:445-446,473 C:118 G:20
	state.length, state.error = stage[2], stage[4] -- T:447,455,474 C:96,119 G:20
	state.fault_ids = layout.ram_base + management + faults_offset -- T:475 C:120
	for reason = 0, 12 do -- T:476 C:121 Q:34-46
		local id = 0 -- T:477 C:100 Q:42
		if reason ~= 8 then -- T:477 Q:42
			local slot<const> = reason < 8 and reason + 5 or reason + 4 -- T:456-467 C:101-112; the source list omits ExplicitError
			id = stage[slot] -- T:477 C:122
		end
		faults[reason] = id -- T:478 C:122 Q:34-46
	end
	return 0 -- T:479 C:123
end

return { initialize_diagnostics = initialize_diagnostics }
