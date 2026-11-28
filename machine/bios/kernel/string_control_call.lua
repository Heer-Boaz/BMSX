module<const>

-- The Lua library keeps source-level coercion and bound normalization.
-- Here all input lanes are the stopped SVC window (or char's unchanged
-- variadic suffix), and the single result overwrites the token.
-- Slice: e3774a03a CPU TS:4524–4535 / C++:1254–1261.
-- Index: a7e8a8d53 CPU TS:4534–4539,5317–5318 / C++:1263–1268,3225–3226.
local ids<const> = require('kernel/heap_control_ids')
local layout<const> = require('kernel/gc_runtime_layout')
local tags<const> = require('kernel/value_type')
local frames<const> = require('kernel/thread_frame_storage').internal
local strings<const> = require('kernel/allocate_string_slice')
local slices<const> = require('kernel/string_slice')
local byte_strings<const> = require('kernel/byte_string_input').internal
local records<const> = require('kernel/string_record')

local management<const> = layout.management_offset
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local cartridge_bank<const> = 1 << 3
local previous_user_mode<const> = 1 << 3
local invalid_argument<const> = 10
local out_of_memory<const> = 9

local receive<const> = function(owner, token, destination, count)
	if destination == nil then return invalid_argument end
	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	local stack_base<const> = frame.stack_base & window_mask
	local slot<const> = stack_base + destination

	local id, fault
	if token == ids.string_concat then
		if count < 2 then return invalid_argument end
		id, fault = strings.intern_value_window(management, owner, slot + 1, count, slices.concat_source, cop0.event_cycles)
	elseif token == ids.string_chars then
		if count ~= 0 then return invalid_argument end
		local first<const> = frame.vararg_base & window_mask
		local supplied<const> = stack_base > first and stack_base - first or 0
		id, fault = strings.intern_value_window(management, owner, first, supplied, slices.chars_source, cop0.event_cycles)
	else
		local operands<const>, kinds<const> = frames.value_planes(owner, slot + 1)
		local words<const>: *u32 = operands
		local types<const>: *u8 = kinds
		if token == ids.string_from_bytes then
			if count ~= 2 or types[0] ~= tags.integer_tag or types[1] ~= tags.integer_tag then return invalid_argument end
			local reason
			id, reason = byte_strings.intern(words[0], words[1])
			if reason ~= nil then return reason end
			fault = 0
		elseif token == ids.string_slice then
			if count ~= 3 or types[0] ~= tags.string_tag or types[1] ~= tags.integer_tag or types[2] ~= tags.integer_tag then
				return invalid_argument
			end
			local source<const>, first<const>, last<const> = words[0], words[1], words[2]
			if first < 1 or last < first or last > records.byte_length(source) then return invalid_argument end
			local system<const>: *word = 0x080101f4
			local cart0<const>: *word = 0x080101f8
			local cart1<const>: *word = 0x080101fc
			id, fault = strings.intern_slice(management, source, first - 1, last - first + 1, cop0.event_cycles,
				*system, *cart0, *cart1)
		else
			-- A cartridge cannot replace the library's private root.
			if (frame.flags & cartridge_bank) ~= 0 or (cop0.status & previous_user_mode) ~= 0 then return invalid_argument end
			if count ~= 1 or types[0] ~= tags.table_tag then return invalid_argument end
			local head<const>: *root_head_input = layout.ram_base + management + layout.remark_head_offset
			head.string_index_tag = tags.table_tag
			local index<const> = words[0]
			head.string_index_word = index
			cop0.string_index_table = index
			return nil
		end
	end
	if fault ~= 0 then return invalid_argument end
	if id == 0 then return out_of_memory end

	-- Allocation recovery can move the underlying register backing.
	local payloads<const>, tag_bytes<const> = frames.value_planes(owner, slot)
	local payload<const>: *u32 = payloads
	local tag<const>: *u8 = tag_bytes
	*payload, *tag = id, tags.string_tag
	local saved<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	-- These operations produce exactly one Value; the former operands
	-- must not be returned by a caller's ordinary open RET.
	saved.top = (saved.top & ~window_mask) | (destination + 1)
	return nil
end

return { receive = receive }
