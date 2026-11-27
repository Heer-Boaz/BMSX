module<const>

-- Source basis: b8fd922892acf5a776f4a69164d779d6f9b6bec9.
-- T/C: image activation; F: image records; S/R: StringPool; L/N: LuaHeap;
-- G/H: GlobalBank. This entry prepares the cold System operand banks.
-- No processor sees the resulting views until the boot program binds them.
local layout<const> = require('kernel/gc_runtime_layout') -- L:27-30 N:22-25
local allocator<const> = require('kernel/dlmalloc') -- L:164 N:177
local records<const> = require('kernel/dlmalloc_record') -- L:148-152 N:156-166
local admission<const> = require('kernel/heap_admission') -- L:75-98,132-138 N:85-109,147-164
local slices<const> = require('kernel/string_slice') -- S:161-230 R:176-235
local strings<const> = require('kernel/gc_strings') -- S:244-254,438-442 R:247-253,427-430
local names<const> = require('kernel/global_bank') -- G:71-109 H:59-101
local string_bindings<const> = require('kernel/image_string_bindings') -- T:997-1010 C:290-305; compact physical root prefix

local string_constant_tag<const> = 4 -- F:67-75
local immutable_string_kind<const> = 0x10005 -- F:58-59 S:145 R:160
local align_mask<const> = 7 -- F:55-56 S:144 R:157
local invalid_header<const> = 2 -- S:145-146 R:160-161; same leaf result as the directory lookup
local invalid_payload<const> = 3 -- S:153-154 R:169-171
local missing_string<const> = 4 -- S:252-253 R:253; missing is not Nil or OUT_OF_MEMORY
local no_storage<const> = 10 -- L:86,152-155 N:98,151-154; cold admission refused

struct immutable_image_operands
	before_constants: u32[5] -- F:4-9
	constants: addr -- F:10
	constants_count: u32 -- F:11
	global_names: addr -- F:12
	global_count: u32 -- F:13
	system_names: addr -- F:14
	system_count: u32 -- F:15
end

struct constant_record
	tag: u32 -- F:49
	word: u32 -- F:50
	reserved: u32 -- F:48
end

struct rom_string
	header: u32 -- F:57-59
	hash: u32 -- F:60
	length: u32 -- F:61
	next: addr -- F:62
end

struct operand_bindings
	global_base: addr -- G:9 H:67,75
	global_capacity: u32 -- G:9 H:67,75
	global_count: u32 -- G:9 H:67,75
	system_base: addr -- G:9 H:67,75
	system_capacity: u32 -- G:9 H:67,75
	system_count: u32 -- G:9 H:67,75
	image: installed_image_binding -- T:1139-1144 C:420-426; the same installed operand record as the live owner
end

-- The System directory has already been installed by firmware. No Cart
-- directory is registered yet; a RAM diagnostic may shadow a ROM literal.
local resolve_initial_string<const> = function(metadata, address, system_bytes, cart0_bytes) -- S:244-254 R:247-253
	if (address & align_mask) ~= 0 or address < 0 or address > system_bytes - sizeof(rom_string) then -- S:144-146 R:157-161
		return 0, invalid_header -- S:146 R:161
	end
	local record<const>: *rom_string = address -- S:145,248-250 R:158,249-251
	if record.header ~= immutable_string_kind then return 0, invalid_header end -- S:145-146 R:160-161
	local hash<const>, size<const> = record.hash, record.length -- S:249-250 R:250-251
	local payload<const> = address + sizeof(rom_string) -- S:152,251 R:167,251
	if size < 0 or size > system_bytes - payload then return 0, invalid_payload end -- S:153-154 R:169-171
	local id = slices.lookup_ram(metadata, payload, size, size, hash) -- S:233-234,252 R:239,252
	if id == 0 then -- S:235-236 R:240
		local fault -- S:217-224 R:227-232
		id, fault = slices.internal.lookup_rom(metadata, 0, hash, payload, size, size, system_bytes, cart0_bytes) -- S:235 R:240
		if fault ~= 0 then return 0, fault end -- S:217-224 R:227-232
	end
	if id == 0 then return 0, missing_string end -- S:253 R:253
	strings.mark(metadata, id) -- S:254,438-442 R:252,427-430
	return id, 0 -- S:254 R:252
end

local bind_name_table<const> = function(management, source, count, bank, destination, system_bytes, cart0_bytes) -- T:1026-1035 C:304-312
	if count == 0 then return 0 end -- T:1027 C:305
	local source_names<const>: *u32 = source -- T:1027-1033 C:305-310 F:52-53
	local mapped<const>: *u32 = destination -- T:1034 C:311
	local metadata<const>, state<const> = management + layout.metadata_offset, management + layout.arena_offset -- S:65 L:164 N:177
	for index = 0, count - 1 do -- T:1031 C:308
		local key<const>, fault<const> = resolve_initial_string(metadata, source_names[index], system_bytes, cart0_bytes) -- T:1033 C:310
		if fault ~= 0 then return fault end -- S:253 R:253; malformed external operand, not allocation refusal
		local ordinal = names.find_name(bank, key) -- T:1034 G:90-91 C:311 H:82
		if ordinal < 0 then -- G:91 H:82
			if admission.logical_fits(state, names.name_charge) == 0 then return no_storage end -- G:95,99 H:86,90 L:90-98 N:102-109
			local capacity<const> = names.growth_capacity(bank) -- G:93-94 H:84-85
			local backing = 0 -- G:92 H:83
			if capacity ~= 0 then -- G:93 H:84
				local offset<const> = allocator.bmsx_dlmalloc_allocate(state, names.backing_slot_bytes * capacity, 0) -- G:95 H:86 L:160-165 N:173-177
				if offset == 0 then return no_storage end -- L:164-166 N:177-179; no reclaimable language records before first Thread
				backing = layout.ram_base + offset -- G:95-97 H:86-88
			end
			ordinal = names.commit_name(management, bank, key, backing, capacity) -- G:97,101-108 H:88,92-100
		end
		mapped[index] = ordinal -- T:1034 C:311
	end
	return 0 -- T:1035 C:312
end

-- A cold image contains no previously running mutator. The live allocations
-- at this point are the key directory, its fixed retained Strings, and the
-- banks being constructed; no object or old program backing can be reclaimed.
-- The general (managed/cart/warm) admission path is not this boot entry.
local bind_initial_image<const> = function(management, header, output, system_bytes, cart0_bytes) -- T:1052-1078,1130-1145 C:326-375,414-440
	local image<const>: *immutable_image_operands = header -- T:1054-1061 C:330-355 F:10-15
	local constants<const>: *constant_record = image.constants -- T:1059,1062 C:327-348 F:10
	local count<const> = image.constants_count -- T:1052 C:330 F:11
	local strings_count = 0 -- T:1066,1069 C:361,365
	for index = 0, count - 1 do -- T:1070 C:366-367
		if constants[index].tag == string_constant_tag then strings_count = strings_count + 1 end -- T:1072-1073 C:367-368
	end
	local global_count<const>, system_count<const> = image.global_count, image.system_count -- T:1053-1054 C:335-341
	local extent<const> = 4 * (global_count + system_count + strings_count) -- T:1076-1077 C:370,419
	local base, strings, ram_count = 0, 0, 0 -- T:1139,1005-1006 C:420,282,291
	local view<const>: *operand_bindings = output -- T:1139-1144 C:420-426
	view.global_base, view.global_capacity, view.global_count = 0, 0, 0 -- G:15-17 H:13; first System registration has no previous namespace
	view.system_base, view.system_capacity, view.system_count = 0, 0, 0 -- G:15-17 H:13
	if extent ~= 0 then -- T:1139 C:420
		local arena<const> = management + layout.arena_offset -- L:119-120 N:122-123
		if admission.logical_fits(arena, extent) == 0 then return no_storage end -- L:86,132-138 N:98,147-155
		local offset<const> = records.bmsx_dlmalloc_reserve_record(arena, extent, 0, 0, 0, extent, 0, 0, management + layout.occupied_offset) -- T:1140 C:421 L:148-152 N:119-139,151-152
		if offset == 0 then return no_storage end -- L:153-155 N:152-154; only fixed retained inputs exist on this path
		base = layout.ram_base + offset -- T:1140 C:421

		local fault = bind_name_table(management, image.global_names, global_count, output, base, system_bytes, cart0_bytes) -- T:1142 C:424
		if fault ~= 0 then return fault end -- T:1142 C:424; never publish an incomplete binding
		local system_base<const> = base + 4 * global_count -- T:1143-1144 C:425-426
		fault = bind_name_table(management, image.system_names, system_count, &view.system_base, system_base, system_bytes, cart0_bytes) -- T:1143-1144 C:425-426
		if fault ~= 0 then return fault end -- T:1143 C:425
		strings = system_base + 4 * system_count -- T:1147 C:440
		local slot = 0 -- T:1005-1006 C:282,291
		local metadata<const> = management + layout.metadata_offset -- T:1001-1002 C:288 S:65
		for index = 0, count - 1 do -- T:968,996 C:282; copy only the decoded String ordinals into binding RAM
			if constants[index].tag == string_constant_tag then -- T:996 C:270-272
				local id<const>, reason<const> = resolve_initial_string(metadata, constants[index].word, system_bytes, cart0_bytes) -- T:1001-1003 C:287-289
				if reason ~= 0 then return reason end -- S:253 R:253; same external-data failure, before the CPU sees bindings
				ram_count = string_bindings.store_binding(strings, strings_count, slot, ram_count, id) -- T:1003,1009 C:289,301
				slot = slot + 1 -- T:1005 C:291
			end
		end
	end
	view.image.strings = strings -- T:1147 C:440; compact prefix with the binding's own backing
	view.image.ram_strings = ram_count -- T:1005-1006 C:282,291
	view.image.base = base -- T:1178 C:421; final bind source, not a hardware latch
	view.image.bytes = extent -- T:1076-1077 C:370,419
	return 0 -- T:1167-1181 C:441
end

return {
	internal = { resolve_initial_string = resolve_initial_string, bind_name_table = bind_name_table },
	bind_initial_image = bind_initial_image,
}
