module<const>

-- Source basis: fbfeafb4d. CPU::callBuiltinFunction and TS callBuiltinFunction
-- admit the signed operands; Memory::bindMappedReadView and CartridgeCard's
-- matching method admit a single public backing. StringPool::intern and TS
-- internBytes/internSource supply the lookup and reservation order. While
-- real guest work runs, a mutable source may change between instructions:
-- publish from the single copied sample, not from the earlier probe hash.

local layout<const> = require('kernel/gc_runtime_layout')
local slices<const> = require('kernel/string_slice')
local strings<const> = require('kernel/gc_strings')
local allocation<const> = require('kernel/allocate_string_slice').internal
local collector<const> = require('kernel/gc_step')
local records<const> = require('kernel/dlmalloc_record')
local frames<const> = require('kernel/thread_frame_storage').internal
local _stopped_layout<const> = require('kernel/thread_retire')
local tags<const> = require('kernel/value_type')
local string_record<const> = require('kernel/string_record')

local syscall_id<const> = 0x10000
local invalid_argument<const> = 10
local out_of_memory<const> = 9
local management<const> = layout.management_offset
local metadata<const> = management + layout.metadata_offset
local arena<const> = management + layout.arena_offset
local occupied<const> = management + layout.occupied_offset
local control_count_mask<const> = (1 << 18) - 1
local window_mask<const> = (1 << 20) - 1
local ram_word_mask<const> = 0x003ffffc
local header_bytes<const> = 16
local cart_rom_base<const> = 0x10000000
local cart_ram_base<const> = 0x30000000
local cart_mmio_base<const> = 0x30f00000
local ordinary_ram_start<const> = 0x08010448

-- Only a positive span wholly inside one populated backing is admissible.
-- The public RAM aperture and the real mapped I/O end are distinct limits.
local admit_span<const> = function(address, count, system, cart0, cart1)
	if address < 0 or count < 0 then return nil, false end
	if address < layout.ram_base then
		if count <= system - address then return address, false end
	elseif address < cart_rom_base then
		if address >= ordinary_ram_start and count <= cop0.ram_end - address then return address, true end
	elseif address < cart_mmio_base then
		local cart_select<const>: *word = 0x08010420
		local cart_ram_bytes<const>: *word = 0x08010444
		local slot<const> = *cart_select & 1
		if address < cart_ram_base then
			local extent<const> = slot == 0 and cart0 or cart1
			if count <= extent - (address - cart_rom_base) and count <= cart_ram_base - address then
				return (string_record.rom_read_address(address | (slot << 31))), false
			end
		elseif count <= *cart_ram_bytes - (address - cart_ram_base) and count <= cart_mmio_base - address then
			return (string_record.rom_read_address(address | (slot << 31))), true
		end
	end
	return nil, false
end

local lookup<const> = function(start, count, hash, system, cart0, cart1)
	local id<const> = slices.lookup_ram(metadata, start, count, count, hash, nil, nil, nil)
	if id ~= 0 then return id, 0 end
	local result<const>, fault<const> = slices.lookup_rom_directories(metadata, start, count, count, hash, system, cart0, cart1, nil, nil, nil)
	return result, fault
end

local intern<const> = function(address, count)
	local system_rom_bytes<const>: *word = 0x080101f4
	local cart0_rom_bytes<const>: *word = 0x080101f8
	local cart1_rom_bytes<const>: *word = 0x080101fc
	local system<const>, cart0<const>, cart1<const> = *system_rom_bytes, *cart0_rom_bytes, *cart1_rom_bytes
	local source, mutable = 0, false
	if count ~= 0 then
		source, mutable = admit_span(address, count, system, cart0, cart1)
		if source == nil then return nil, invalid_argument end
	end
	local hash = slices.hash_span(source, count, count)
	local id, fault = lookup(source, count, hash, system, cart0, cart1)
	if fault ~= 0 then return nil, invalid_argument end
	if id ~= 0 then
		strings.mark(metadata, id)
		return id, nil
	end

	local offset<const>, published<const> = allocation.reserve_string_record(management, metadata, count, 0, cop0.event_cycles, false)
	if offset == 0 then
		if published then collector.finish_operation(management, 0) end
		return nil, out_of_memory
	end
	local address<const> = layout.ram_base + offset
	if not mutable then
		id = slices.publish(metadata, address, source, count, count, hash)
		if published then collector.finish_result(management, tags.string_tag, id) end
		return id, nil
	end

	-- Copy directly into the unpublished record. DMA may have changed the
	-- backing since lookup; hash the stored sample, not a second source read.
	local input<const>: *u8 = source
	local payload<const> = address + header_bytes
	local output<const>: *u8 = payload
	hash = 0x811c9dc5
	for i = 0, count - 1 do
		local byte<const> = input[i]
		output[i] = byte
		hash = (hash ~ byte) * 16777619
	end
	id, fault = lookup(payload, count, hash, system, cart0, cart1)
	if fault ~= 0 or id ~= 0 then
		records.bmsx_dlmalloc_release_record(arena, offset, header_bytes + count, occupied)
		if fault ~= 0 then
			if published then collector.finish_operation(management, 0) end
			return nil, invalid_argument
		end
		strings.mark(metadata, id)
	else
		local bucket<const> = slices.internal.begin_record(metadata, address, count, hash)
		id = slices.internal.finish_record(metadata, bucket, address)
	end
	if published then collector.finish_result(management, tags.string_tag, id) end
	return id, nil
end

local receive<const> = function(owner, destination, argc)
	if argc ~= 2 then return nil, invalid_argument end
	local context<const>: *stopped_thread = owner
	local depth<const> = context.frame_depth & control_count_mask
	local frame<const>: *stopped_frame = layout.ram_base + ((context.frame_block + (depth - 1) * sizeof(stopped_frame)) & ram_word_mask)
	local slot<const> = (frame.stack_base & window_mask) + destination
	local words<const>, tags_address<const> = frames.value_planes(owner, slot + 1)
	local arguments<const>: *u32 = words
	local kinds<const>: *u8 = tags_address
	if kinds[0] ~= tags.integer_tag or kinds[1] ~= tags.integer_tag then return nil, invalid_argument end
	local id<const>, reason<const> = intern(arguments[0], arguments[1])
	if not id then return nil, reason end
	-- Read the result planes from the stopped context after any collection.
	local result_words<const>, result_tags<const> = frames.value_planes(owner, slot)
	local result<const>: *u32 = result_words
	local kind<const>: *u8 = result_tags
	*result, *kind = id, tags.string_tag
	if (frame.top & window_mask) <= destination then
		frame.top = (frame.top & ~window_mask) | (destination + 1)
	end
	return true, nil
end

return {
	syscall_id = syscall_id,
	receive = receive,
	internal = { admit_span = admit_span, lookup = lookup, intern = intern },
}
