module<const>

local ids<const> = require('kernel/bios_table_ids')
local layout<const> = require('kernel/gc_runtime_layout')
local tags<const> = require('kernel/value_type')
local frames<const> = require('kernel/thread_frame_storage').internal
local copy<const> = require('kernel/bios_copy_table').copy_record
local raw_set<const> = require('kernel/table_grow').raw_set
local set_metatable<const> = require('kernel/gc_barrier').assign_metatable
local set_global<const> = require('kernel/set_global').assign_name
local names<const> = require('kernel/global_bank')
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local word_mask<const> = 0x003ffffc
local invalid_argument<const> = 10
local ordinary_bank<const> = layout.ram_base + layout.management_offset + layout.ordinary_global_bank_offset

local receive<const> = function(owner, token, destination, count)
	if token == ids.namespace then
		if count ~= 1 and count ~= 2 then return invalid_argument end
	elseif count ~= (token == ids.copy and 1 or (token == ids.raw_set and 3 or 2)) then
		return invalid_argument
	end
	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & word_mask)
	local slot<const> = (frame.stack_base & window_mask) + destination
	local words<const>, kinds<const> = frames.value_planes(owner, slot + 1)
	local arguments<const>: *u32 = words
	local types<const>: *u8 = kinds
	if token == ids.raw_set then
		local fault<const> = raw_set(arguments[0], types[0], arguments[1], types[1], arguments[2], types[2])
		return fault
	elseif token == ids.set_metatable then
		local fault<const> = set_metatable(arguments[0], types[0], arguments[1], types[1])
		return fault
	elseif token == ids.namespace and count == 2 then
		local fault<const> = set_global(arguments[0], types[0], arguments[1], types[1])
		return fault
	end
	local result, result_tag
	if token == ids.namespace then
		if types[0] ~= tags.string_tag then return invalid_argument end
		result, result_tag = names.read_name(ordinary_bank, arguments[0])
	else
		local fault
		result, fault = copy(arguments[0], types[0])
		if fault ~= nil then return fault end
		result_tag = tags.table_tag
	end
	local result_words<const>, result_tags<const> = frames.value_planes(owner, slot)
	local payload<const>: *u32 = result_words
	local tag<const>: *u8 = result_tags
	*payload, *tag = result, result_tag
	return nil
end

return { receive = receive }
