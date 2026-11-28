module<const>

local layout<const> = require('kernel/gc_runtime_layout')
local admission<const> = require('kernel/boot_image_admission')
local arena<const> = require('kernel/dlmalloc')
local floor<const> = require('kernel/heap_floor')
local records<const> = require('kernel/dlmalloc_record')
local names<const> = require('kernel/global_bank')
local hashes<const> = require('kernel/table_reinsert').internal
local slices<const> = require('kernel/string_slice')
local strings<const> = require('kernel/gc_strings')
local _binding_types<const> = require('kernel/image_string_bindings')
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

struct image_operand_plan
	staged: addr
	delta: u32
	offset: u32
	extent: u32
	constant_count: u32
	global_count: u32
	system_count: u32
	global_prior: u32
	system_prior: u32
	string_prior: u32
	ram_string_end: u32
end

-- One System vector owns this storage through every allocation and grant.
bss image_operands: image_operand_plan[3]

local prepare_plan<const> = function(index, staged, mounted)
	local plans<const>: *image_operand_plan = image_operands
	local plan<const>: *image_operand_plan = &plans[index]
	plan.staged, plan.offset, plan.extent = staged, 0, 0
	if staged == 0 then return true, 0, 0 end
	local replacement<const>: *immutable_image_operands = staged
	local old_address<const> = index == 0 and mounted or string_record.rom_read_address(mounted | ((index - 1) << 31))
	local prior<const>: *immutable_image_operands = old_address
	if replacement.magic ~= image_magic or prior.magic ~= image_magic
		or replacement.global_count < prior.global_count or replacement.system_count < prior.system_count
		or replacement.string_buckets ~= prior.string_buckets
		or replacement.string_bucket_count ~= prior.string_bucket_count then return false end
	if replacement.data_target ~= prior.data_target or replacement.data_size ~= prior.data_size
		or replacement.bss_target ~= prior.bss_target or replacement.bss_size < prior.bss_size then return false end
	local bss_start, bss_end = 0, 0
	if replacement.bss_size ~= prior.bss_size then
		if index == 0 or prior.bss_target < 0x08040000
			or replacement.bss_size > state - prior.bss_target
			or ((prior.bss_target | prior.bss_size | replacement.bss_size) & 3) ~= 0 then return false end
		bss_start, bss_end = prior.bss_target + prior.bss_size, prior.bss_target + replacement.bss_size
		if bss_start > cop0.ram_end then return false end
	end
	local installed<const>: *installed_image_binding = state + layout.installed_image_bindings_offset
		+ index * sizeof(installed_image_binding)
	local delta<const> = staged - mounted
	local count<const> = replacement.constants_count
	local constants<const>: *constant_record = replacement.constants + delta
	local string_count = 0
	for ordinal = 0, count - 1 do
		if constants[ordinal].tag == string_constant then string_count = string_count + 1 end
	end
	local string_prior<const> = installed.bytes // 4 - prior.global_count - prior.system_count
	if string_count < string_prior then return false end
	plan.delta = delta
	local extent<const> = 4 * (replacement.global_count + replacement.system_count + string_count)
	if extent ~= installed.bytes then plan.extent = extent end
	plan.constant_count, plan.string_prior = count, string_prior
	plan.global_count, plan.global_prior = replacement.global_count, prior.global_count
	plan.system_count, plan.system_prior = replacement.system_count, prior.system_count
	return true, bss_start, bss_end
end

local lookup_staged<const> = function(index, payload, length, hash)
	local plans<const>: *image_operand_plan = image_operands
	local plan<const>: *image_operand_plan = &plans[index]
	local image<const>: *immutable_image_operands = plan.staged
	if plan.staged == 0 then return 0 end
	local delta<const> = plan.delta
	local buckets<const>: *u32 = image.string_buckets + delta
	local address = buckets[hash & (image.string_bucket_count - 1)]
	while address ~= 0 do
		local record<const>: *rom_string = address + delta
		if record.hash == hash and record.length == length
			and slices.internal.matches_slice(0, address + delta + sizeof(rom_string), -1, payload, length, length) then
			return index == 0 and address or address | ((index - 1) << 31)
		end
		address = record.next
	end
	return 0
end

-- Installed aliases take precedence over every proposed spelling. On a
-- true miss use the same physical System/first-cartridge/other order for
-- all plans, regardless of the staging addresses and publication order.
local resolve<const> = function(address, index, system, cart0, cart1)
	local plans<const>: *image_operand_plan = image_operands
	local domain<const> = address < cart_base and 0 or index
	local owner<const>: *image_operand_plan = &plans[domain]
	local read_address<const> = owner.staged ~= 0 and address + owner.delta or address
	local source<const>: *rom_string = read_address
	if source.header ~= immutable_string then return 0 end
	local hash<const>, length<const> = source.hash, source.length
	local payload<const> = read_address + sizeof(rom_string)
	local found<const> = slices.lookup_ram(metadata, payload, length, length, hash, nil, nil, nil)
	if found ~= 0 then return found end
	local prior<const>, fault<const> = slices.lookup_rom_directories(metadata, payload, length, length,
		hash, system, cart0, cart1, nil, nil, nil)
	if fault ~= 0 then return 0 end
	if prior ~= 0 then return prior end
	if domain == 0 then return address end
	-- The source record is already known. Search only the candidate banks
	-- that rank ahead of it, not its own directory or a later bank.
	local key = lookup_staged(0, payload, length, hash)
	if key ~= 0 then return key end
	local metadata_view<const>: *string_metadata = layout.ram_base + metadata
	local first<const> = metadata_view.first_cart == 2 and 2 or 1
	if domain ~= first then
		key = lookup_staged(first, payload, length, hash)
		if key ~= 0 then return key end
	end
	return address | ((domain - 1) << 31)
end

local stage_names<const> = function(index, plan_address, system_names, pending, mask, materialize, system, cart0, cart1)
	local plan<const>: *image_operand_plan = plan_address
	local image<const>: *immutable_image_operands = plan.staged
	local installed<const>: *installed_image_binding = state + layout.installed_image_bindings_offset
		+ index * sizeof(installed_image_binding)
	local bank<const> = system_names and system_bank or ordinary_bank
	local retained<const> = system_names and plan.system_prior or plan.global_prior
	local count<const> = system_names and plan.system_count or plan.global_count
	local inputs<const>: *u32 = (system_names and image.system_names or image.global_names) + plan.delta
	local output<const>: *u32 = layout.ram_base + plan.offset + (system_names and 4 * plan.global_count or 0)
	if materialize then
		local previous<const>: *u32 = installed.base + (system_names and 4 * plan.global_prior or 0)
		for slot = 0, retained - 1 do output[slot] = previous[slot] end
	end
	local keys<const>: *u32 = pending
	local added = 0
	for slot = retained, count - 1 do
		local key<const> = resolve(inputs[slot], index, system, cart0, cart1)
		if key == 0 then return -1 end
		if materialize then
			output[slot] = key
		elseif names.find_name(bank, key) < 0 then
			if pending == 0 then
				added = added + 1
			else
				local token<const> = key | (system_names and 1 or 0)
				local bucket = hashes.hash_canonical_table_key(3, token) & mask
				while keys[bucket] ~= 0 and keys[bucket] ~= token do bucket = (bucket + 1) & mask end
				if keys[bucket] == 0 then
					keys[bucket] = token
					added = added + 1
				end
			end
		end
	end
	return added
end

local stage_strings<const> = function(index, plan_address, system, cart0, cart1)
	local plan<const>: *image_operand_plan = plan_address
	local image<const>: *immutable_image_operands = plan.staged
	local installed<const>: *installed_image_binding = state + layout.installed_image_bindings_offset
		+ index * sizeof(installed_image_binding)
	local constants<const>: *constant_record = image.constants + plan.delta
	local prior<const>: *u32 = installed.strings
	local pool<const>: *u32 = layout.ram_base + plan.offset + 4 * (plan.global_count + plan.system_count)
	local string_prior<const> = plan.string_prior
	local ram_string_end, ordinal = 0, 0
	for slot = 0, plan.constant_count - 1 do
		if constants[slot].tag == string_constant then
			local id
			if ordinal < string_prior then
				id = prior[ordinal]
			else
				id = resolve(constants[slot].word, index, system, cart0, cart1)
			end
			if id == 0 then return false end
			pool[ordinal] = id
			ordinal = ordinal + 1
			if string_record.is_ram_string_id(id) then ram_string_end = ordinal end
		end
	end
	plan.ram_string_end = ram_string_end
	return true
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

local publish_names<const> = function(plan_address, system_names, backing, capacity)
	local plan<const>: *image_operand_plan = plan_address
	local target<const> = layout.ram_base + plan.offset + (system_names and 4 * plan.global_count or 0)
	local output<const>: *u32 = target
	local bank<const> = system_names and system_bank or ordinary_bank
	local retained<const> = system_names and plan.system_prior or plan.global_prior
	local count<const> = system_names and plan.system_count or plan.global_count
	for slot = retained, count - 1 do
		local key<const> = output[slot]
		local ordinal = names.find_name(bank, key)
		if ordinal < 0 then
			ordinal = names.commit_name(management, bank, key, layout.ram_base + backing, capacity)
			backing, capacity = 0, 0
		end
		output[slot] = ordinal
	end
	return backing, capacity
end

local publish_operand_bank<const> = function(index, plan_address)
	local plan<const>: *image_operand_plan = plan_address
	local installed<const>: *installed_image_binding = state + layout.installed_image_bindings_offset
		+ index * sizeof(installed_image_binding)
	local previous<const>, previous_bytes<const> = installed.base, installed.bytes
	local base<const> = plan.offset == 0 and 0 or layout.ram_base + plan.offset
	local pool_address<const> = base + 4 * (plan.global_count + plan.system_count)
	local pool<const>: *u32 = pool_address
	local ram_string_end<const> = plan.ram_string_end
	local work = 0
	for index = 0, ram_string_end - 1 do
		work = work + strings.mark(metadata, pool[index])
	end
	if work ~= 0 then
		local latch<const>: *u32 = state + layout.string_mark_work_offset
		*latch = *latch + work
	end
	installed.strings, installed.ram_string_end = pool_address, ram_string_end
	installed.base, installed.bytes = base, plan.extent
	if previous ~= 0 then
		records.bmsx_dlmalloc_release_record(allocator, previous - layout.ram_base, previous_bytes, occupied)
	end
end

local bind_live<const> = function(arguments_address)
	local arguments<const>: *u32 = arguments_address
	local plans<const>: *image_operand_plan = image_operands
	local total_names, name_images = 0, 0
	local bss_start, bss_end = 0, 0
	for index = 0, 2 do
		local valid<const>, first<const>, last<const> = prepare_plan(index, arguments[2 * index], arguments[2 * index + 1])
		if not valid then return invalid_image end
		if first ~= 0 then
			if bss_start ~= 0 then return invalid_image end
			bss_start, bss_end = first, last
		end
		if plans[index].extent ~= 0 then
			local added<const> = plans[index].global_count - plans[index].global_prior
				+ plans[index].system_count - plans[index].system_prior
			if added ~= 0 then name_images = name_images + 1 end
			total_names = total_names + added
		end
	end
	local system_extent<const>: *word = 0x080101f4
	local cart0_extent<const>: *word = 0x080101f8
	local cart1_extent<const>: *word = 0x080101fc
	local system<const>, cart0<const>, cart1<const> = *system_extent, *cart0_extent, *cart1_extent
	-- Claim the new static prefix before operand allocations may enter it.
	-- Keep its RAM aperture unpublished until the whole load can commit.
	local prior_floor, ram_end = 0, cop0.ram_end
	local floor_claimed<const> = bss_end > ram_end
	if floor_claimed then
		prior_floor = arena.bmsx_dlmalloc_floor(allocator)
		ram_end = floor.admit_static_end(bss_end)
		if ram_end == 0 then return no_storage end
	end
	local cycles = cop0.event_cycles
	local fault = 0
	for index = 0, 2 do
		local plan<const>: *image_operand_plan = &plans[index]
		if plan.extent ~= 0 then
			local accepted, offset
			accepted, offset, cycles = admission.reserve(management, 0, 0, plan.extent, plan.extent, true, cycles, 0, 0)
			if not accepted then
				fault = no_storage
				break
			end
			plan.offset = offset
		end
	end

	-- Across images a name can appear more than once. Use one temporary
	-- set to charge it and size its backing once per namespace.
	local pending, mask = 0, 0
	if fault == 0 and name_images > 1 then
		local buckets = 1
		while buckets < 2 * total_names do buckets = 2 * buckets end
		local accepted, offset
		accepted, offset, cycles = admission.reserve(management, 0, 0, 0, 4 * buckets, false, cycles, 0, 0)
		if not accepted then
			fault = no_storage
		else
			pending, mask = layout.ram_base + offset, buckets - 1
			local keys<const>: *u32 = pending
			for index = 0, mask do keys[index] = 0 end
		end
	end
	local ordinary_added, system_added = 0, 0
	if fault == 0 then
		for index = 0, 2 do
			if plans[index].extent ~= 0 then
				local plan<const> = &plans[index]
				local ordinary<const> = stage_names(index, plan, false, pending, mask, false, system, cart0, cart1)
				local special<const> = stage_names(index, plan, true, pending, mask, false, system, cart0, cart1)
				if ordinary < 0 or special < 0 then
					fault = invalid_image
					break
				end
				ordinary_added, system_added = ordinary_added + ordinary, system_added + special
			end
		end
	end
	if pending ~= 0 then arena.bmsx_dlmalloc_free(allocator, pending - layout.ram_base) end
	local ordinary_storage, system_storage, ordinary_capacity, system_capacity = 0, 0, 0, 0
	if fault == 0 then
		local charged<const> = (ordinary_added + system_added) * names.name_charge
		ordinary_capacity, system_capacity = capacity_for(ordinary_bank, ordinary_added), capacity_for(system_bank, system_added)
		local accepted = true
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
		-- No collection follows this pass. Earlier admission could reclaim a
		-- RAM String absent from the installed names and operand roots.
		for index = 0, 2 do
			if plans[index].extent ~= 0 then
				local plan<const> = &plans[index]
				if stage_names(index, plan, false, 0, 0, true, system, cart0, cart1) < 0
					or stage_names(index, plan, true, 0, 0, true, system, cart0, cart1) < 0
					or not stage_strings(index, plan, system, cart0, cart1) then
					fault = invalid_image
					break
				end
			end
		end
	end
	if fault ~= 0 then
		if ordinary_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, ordinary_storage) end
		if system_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, system_storage) end
		for index = 0, 2 do
			local plan<const>: *image_operand_plan = &plans[index]
			if plan.offset ~= 0 then records.bmsx_dlmalloc_release_record(allocator, plan.offset, plan.extent, occupied) end
		end
		if floor_claimed then arena.bmsx_dlmalloc_set_floor(allocator, prior_floor) end
		return fault
	end
	for index = 0, 2 do
		if plans[index].extent ~= 0 then
			local plan<const> = &plans[index]
			ordinary_storage, ordinary_capacity = publish_names(plan, false, ordinary_storage, ordinary_capacity)
			system_storage, system_capacity = publish_names(plan, true, system_storage, system_capacity)
			publish_operand_bank(index, plan)
		end
	end
	if ordinary_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, ordinary_storage) end
	if system_storage ~= 0 then arena.bmsx_dlmalloc_free(allocator, system_storage) end
	if bss_start ~= 0 then
		local suffix<const>: *u32 = bss_start
		for word = 0, (bss_end - bss_start) // 4 - 1 do suffix[word] = 0 end
		if floor_claimed then cop0.ram_end = ram_end end
	end
	return 0
end

return {
	bind_live = bind_live,
	internal = {
		prepare_plan = prepare_plan, lookup_staged = lookup_staged, resolve = resolve, stage_names = stage_names, stage_strings = stage_strings,
		capacity_for = capacity_for, publish_names = publish_names, publish_operand_bank = publish_operand_bank,
	},
}
