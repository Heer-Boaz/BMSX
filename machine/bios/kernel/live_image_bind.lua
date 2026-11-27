module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local admission<const> = require('kernel/boot_image_admission')
local arena<const> = require('kernel/dlmalloc')
local records<const> = require('kernel/dlmalloc_record')
local names<const> = require('kernel/global_bank')
local slices<const> = require('kernel/string_slice')
local strings<const> = require('kernel/gc_strings')
local binding<const> = require('kernel/image_string_bindings')
local string_record<const> = require('kernel/string_record')
local _image_types<const> = require('kernel/system_image_bind')

local management<const> = layout.management_offset
local state<const> = layout.ram_base + management
local metadata<const> = management + layout.metadata_offset
local allocator<const> = management + layout.arena_offset
local occupied<const> = management + layout.occupied_offset
local system_bank<const> = state + layout.system_global_bank_offset
local ordinary_bank<const> = system_bank + sizeof(namespace_bank)
local cart_base<const> = 0x10000000
local string_constant<const> = 4
local immutable_string<const> = 0x10005
local image_magic<const> = 0x32334c42
local invalid_image<const> = 2
local no_storage<const> = 10

-- The replacement's operands are ordinary immutable data. Its final ROM
-- addresses are not staging addresses, even when both apertures are readable.
local resolve<const> = function(address, slot, delta, system, cart0, cart1)
	local in_system<const> = address < cart_base
	local own<const> = in_system == (slot < 0)
	local source<const>: *rom_string = own and address + delta or address
	if source.header ~= immutable_string then return 0 end
	local hash<const>, length<const> = source.hash, source.length
	local payload<const> = source + sizeof(rom_string)
	local found<const> = slices.lookup_ram(metadata, payload, length, length, hash, nil, nil, nil)
	if found ~= 0 then return found end
	local prior<const>, fault<const> = slices.lookup_rom_directories(metadata, payload, length, length,
		hash, system, cart0, cart1, nil, nil, nil)
	if fault ~= 0 then return 0 end
	if prior ~= 0 then return prior end
	return in_system and address or address | (slot << 31)
end

local stage_names<const> = function(source, target, total, retained, previous, bank, slot, delta, system, cart0, cart1)
	local inputs<const>: *u32 = source
	local output<const>: *u32 = target
	local old<const>: *u32 = previous
	for index = 0, retained - 1 do output[index] = old[index] end
	local added = 0
	for index = retained, total - 1 do
		local key<const> = resolve(inputs[index], slot, delta, system, cart0, cart1)
		if key == 0 then return -1 end
		output[index] = key
		if names.find_name(bank, key) < 0 then added = added + 1 end
	end
	return added
end

local capacity_for<const> = function(bank_address, added)
	local bank<const>: *namespace_bank = bank_address
	local capacity = bank.capacity
	local needed<const> = bank.count + added
	if capacity >= needed then return 0 end
	if capacity == 0 then capacity = 8 end
	while capacity < needed do capacity = 2 * capacity end
	return capacity
end

local publish_names<const> = function(target, total, retained, bank, backing, capacity)
	local output<const>: *u32 = target
	for index = retained, total - 1 do
		local key<const> = output[index]
		local ordinal = names.find_name(bank, key)
		if ordinal < 0 then
			ordinal = names.commit_name(management, bank, key, layout.ram_base + backing, capacity)
			backing, capacity = 0, 0
		end
		output[index] = ordinal
	end
	if backing ~= 0 then arena.bmsx_dlmalloc_free(allocator, backing) end
end

local bind_live<const> = function(slot, staged, mounted)
	local replacement<const>: *immutable_image_operands = staged
	local old_address<const> = slot < 0 and mounted or string_record.rom_read_address(mounted | (slot << 31))
	local prior<const>: *immutable_image_operands = old_address
	if replacement.magic ~= image_magic or prior.magic ~= image_magic
		or replacement.global_count < prior.global_count or replacement.system_count < prior.system_count
		or replacement.string_buckets ~= prior.string_buckets
		or replacement.string_bucket_count ~= prior.string_bucket_count then return invalid_image end
	local installed<const>: *installed_image_binding = state + layout.installed_image_bindings_offset
		+ (slot + 1) * sizeof(installed_image_binding)
	local previous<const>, previous_bytes<const> = installed.base, installed.bytes
	local prior_strings<const>: *u32 = installed.strings
	local delta<const> = staged - mounted
	local count<const>, global_count<const>, system_count<const> = replacement.constants_count, replacement.global_count, replacement.system_count
	local constants<const>: *constant_record = replacement.constants + delta
	local string_count = 0
	for index = 0, count - 1 do
		if constants[index].tag == string_constant then string_count = string_count + 1 end
	end
	local extent<const> = 4 * (global_count + system_count + string_count)
	local cycles = cop0.event_cycles
	local accepted, offset, ordinary_storage, system_storage = true, 0, 0, 0
	if extent ~= 0 then
		accepted, offset, cycles = admission.reserve(management, 0, 0, extent, extent, true, cycles, 0, 0)
		if not accepted then return no_storage end
	end

	local system_extent<const>: *word = 0x080101f4
	local cart0_extent<const>: *word = 0x080101f8
	local cart1_extent<const>: *word = 0x080101fc
	local system<const>, cart0<const>, cart1<const> = *system_extent, *cart0_extent, *cart1_extent
	local base<const> = offset == 0 and 0 or layout.ram_base + offset
	local system_base<const> = base + 4 * global_count
	local strings_base<const> = system_base + 4 * system_count
	local global_source<const>, system_source<const> = replacement.global_names + delta, replacement.system_names + delta
	local global_prior<const>, system_prior<const> = prior.global_count, prior.system_count
	local string_prior<const> = previous_bytes // 4 - global_prior - system_prior
	local ordinary_added<const> = stage_names(global_source, base, global_count, global_prior, previous,
		ordinary_bank, slot, delta, system, cart0, cart1)
	local system_added<const> = stage_names(system_source, system_base, system_count, system_prior, previous + 4 * global_prior,
		system_bank, slot, delta, system, cart0, cart1)
	local ram_count, ordinal, fault = 0, 0, 0
	if ordinary_added < 0 or system_added < 0 then fault = invalid_image end
	local ordinary_capacity, system_capacity = 0, 0
	if fault == 0 then
		local charged<const> = (ordinary_added + system_added) * names.name_charge
		ordinary_capacity, system_capacity = capacity_for(ordinary_bank, ordinary_added), capacity_for(system_bank, system_added)
		if charged ~= 0 then
			accepted, ordinary_storage, cycles = admission.reserve(management, 0, 0, charged,
				names.backing_slot_bytes * ordinary_capacity, false, cycles, 0, 0)
		end
		if accepted and system_capacity ~= 0 then
			accepted, system_storage, cycles = admission.reserve(management, 0, 0, 0,
				names.backing_slot_bytes * system_capacity, false, cycles, 0, 0)
		end
		if not accepted then fault = no_storage end
	end
	if fault == 0 then
		-- No further collection can run in this vector. Resolve again because
		-- admission may have reclaimed an otherwise unrooted RAM String.
		local after_global<const> = stage_names(global_source, base, global_count, global_prior, previous,
			ordinary_bank, slot, delta, system, cart0, cart1)
		local after_system<const> = stage_names(system_source, system_base, system_count, system_prior, previous + 4 * global_prior,
			system_bank, slot, delta, system, cart0, cart1)
		if after_global < 0 or after_system < 0 then fault = invalid_image end
		local old_ram, old_rom = 0, string_prior - 1
		for index = 0, count - 1 do
			if constants[index].tag == string_constant then
				local id
				if ordinal < string_prior then
					if (prior_strings[ordinal] & binding.ordinal_ram_bit) ~= 0 then
						id = prior_strings[old_ram] & ~binding.ordinal_ram_bit
						old_ram = old_ram + 1
					else
						id = prior_strings[old_rom] & ~binding.ordinal_ram_bit
						old_rom = old_rom - 1
					end
				else
					id = resolve(constants[index].word, slot, delta, system, cart0, cart1)
				end
				if id == 0 then
					fault = invalid_image
					break
				end
				ram_count = binding.store_binding(strings_base, string_count, ordinal, ram_count, id)
				ordinal = ordinal + 1
			end
		end
	end
	if fault ~= 0 then
		if ordinary_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, ordinary_storage) end
		if system_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, system_storage) end
		if offset ~= 0 then records.bmsx_dlmalloc_release_record(allocator, offset, extent, occupied) end
		return fault
	end

	publish_names(base, global_count, global_prior, ordinary_bank, ordinary_storage, ordinary_capacity)
	publish_names(system_base, system_count, system_prior, system_bank, system_storage, system_capacity)
	local pool<const>: *u32 = strings_base
	local work = 0
	for index = 0, ram_count - 1 do
		work = work + strings.mark(metadata, pool[index] & ~binding.ordinal_ram_bit)
	end
	if work ~= 0 then
		local latch<const>: *u32 = state + layout.string_mark_work_offset
		*latch = *latch + work
	end
	installed.strings, installed.ram_strings = strings_base, ram_count
	installed.base, installed.bytes = base, extent
	if previous ~= 0 then
		records.bmsx_dlmalloc_release_record(allocator, previous - layout.ram_base, previous_bytes, occupied)
	end
	return 0
end

return {
	bind_live = bind_live,
	internal = { resolve = resolve, stage_names = stage_names, capacity_for = capacity_for, publish_names = publish_names },
}
