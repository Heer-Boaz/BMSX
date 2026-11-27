module<const>

-- Source basis: b8fd922892acf5a776f4a69164d779d6f9b6bec9.
-- T/C: image activation; F: image records; S/R: StringPool; L/N: LuaHeap;
-- G/H: GlobalBank. System reset and cartridge boot share operand installation.
-- No processor sees the resulting views until the boot program binds them.
local layout<const> = require('kernel/gc_runtime_layout') -- L:27-30 N:22-25
local admission<const> = require('kernel/boot_image_admission') -- L:75-98,132-168 N:85-109,147-179
local slices<const> = require('kernel/string_slice') -- S:161-230 R:176-235
local strings<const> = require('kernel/gc_strings') -- S:244-254,438-442 R:247-253,427-430
local string_bindings<const> = require('kernel/image_string_bindings') -- T:997-1010 C:290-305; compact physical root prefix
local records<const> = require('kernel/dlmalloc_record') -- L:148-152 N:156-166
local names<const> = require('kernel/global_bank') -- G:71-109 H:59-101
local frame_storage<const> = require('kernel/thread_frame_storage')

local string_constant_tag<const> = 4 -- F:67-75
local image_magic<const> = 0x32334c42
local cart_base<const> = 0x10000000
local ram_bytes<const> = 0x400000
local immutable_string_kind<const> = 0x10005 -- F:58-59 S:145 R:160
local align_mask<const> = 7 -- F:55-56 S:144 R:157
local invalid_header<const> = 2 -- S:145-146 R:160-161; same leaf result as the directory lookup
local invalid_payload<const> = 3 -- S:153-154 R:169-171
local missing_string<const> = 4 -- S:252-253 R:253; missing is not Nil or OUT_OF_MEMORY
local no_storage<const> = 10 -- L:86,152-155 N:98,151-154; allocation recovery exhausted
local static_function<const> = 2
local function_align_mask<const> = 15

struct launch_function_record
	code: addr
	code_bytes: u32
	formals: u32
	maximum: u32
	flags: u32
	captures: addr
	capture_count: u32
	reserved: u32
end

struct immutable_image_operands
	magic: u32 -- F:4
	before_constants: u32[4] -- F:5-9
	constants: addr -- F:10
	constants_count: u32 -- F:11
	global_names: addr -- F:12
	global_count: u32 -- F:13
	system_names: addr -- F:14
	system_count: u32 -- F:15
	string_buckets: addr -- F:16
	string_bucket_count: u32 -- F:17
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

-- Bind the same media span that the execution bus can read. The socket is
-- encoded only in a cartridge address; System addresses remain unmodified.
local rom_source<const> = function(address, socket, system_bytes, cart_bytes)
	if address < cart_base then return address, system_bytes - address end
	return address | (socket << 31), cart_bytes - (address - cart_base)
end

local resolve_initial_string<const> = function(management, address, socket, system_bytes, cart0_bytes, cart1_bytes) -- S:244-254 R:247-253
	if (address & align_mask) ~= 0 or address < 0 then return 0, invalid_header end -- S:144-146 R:157-161
	local source<const>, available<const> = rom_source(address, socket, system_bytes, socket == 0 and cart0_bytes or cart1_bytes)
	if available < sizeof(rom_string) then return 0, invalid_header end -- S:144-146 R:157-161
	local record<const>: *rom_string = source -- S:145,248-250 R:158,249-251
	if record.header ~= immutable_string_kind then return 0, invalid_header end -- S:145-146 R:160-161
	local hash<const>, size<const> = record.hash, record.length -- S:249-250 R:250-251
	local payload<const> = source + sizeof(rom_string) -- S:152,251 R:167,251
	if size < 0 or size > available - sizeof(rom_string) then return 0, invalid_payload end -- S:153-154 R:169-171
	local metadata<const> = management + layout.metadata_offset -- S:65
	local id = slices.lookup_ram(metadata, payload, size, size, hash) -- S:233-234,252 R:239,252
	if id == 0 then -- S:235-236 R:240
		local fault -- S:217-224 R:227-232
		id, fault = slices.lookup_rom_directories(metadata, payload, size, size, hash, system_bytes, cart0_bytes, cart1_bytes) -- S:235 R:240
		if fault ~= 0 then return 0, fault end -- S:217-224 R:227-232
	end
	if id == 0 then return 0, missing_string end -- S:253 R:253
	local work<const> = strings.mark(metadata, id) -- S:254,438-442 R:252,427-430
	if work ~= 0 then -- S:441 R:430
		local latch<const>: *u32 = layout.ram_base + management + layout.string_mark_work_offset -- S:441 R:430
		*latch = *latch + work -- S:441 R:430
	end
	return id, 0 -- S:254 R:252
end

local bind_name_table<const> = function(management, root, source, count, bank, destination, socket, system_bytes, cart0_bytes, cart1_bytes, source_cycles) -- T:1026-1035 C:304-312
	if count == 0 then return 0, source_cycles end -- T:1027 C:305
	local source_names<const>: *u32 = source -- T:1027-1033 C:305-310 F:52-53
	local mapped<const>: *u32 = destination -- T:1034 C:311
	for index = 0, count - 1 do -- T:1031 C:308
		local key<const>, fault<const> = resolve_initial_string(management, source_names[index], socket, system_bytes, cart0_bytes, cart1_bytes) -- T:1033 C:310
		if fault ~= 0 then return fault, source_cycles end -- S:253 R:253; malformed external operand, not allocation refusal
		local ordinal = names.find_name(bank, key) -- T:1034 G:90-91 C:311 H:82
		if ordinal < 0 then -- G:91 H:82
			local capacity<const> = names.growth_capacity(bank) -- G:93-94 H:84-85
			local accepted, offset
			accepted, offset, source_cycles = admission.reserve(management, root,
				key, names.name_charge, names.backing_slot_bytes * capacity, false, source_cycles, 0, 0) -- G:93-99 H:84-91 L:160-168 N:173-179
			if not accepted then return no_storage, source_cycles end -- L:86,152-155 N:98,151-154
			local backing<const> = offset == 0 and 0 or layout.ram_base + offset -- G:95-97 H:86-88
			ordinal = names.commit_name(management, bank, key, backing, capacity) -- G:97,101-108 H:88,92-100
		end
		mapped[index] = ordinal -- T:1034 C:311
	end
	return 0, source_cycles -- T:1035 C:312
end

-- The newly allocated block stays allocator-owned until the complete
-- name/literal binding has succeeded, just as in native image activation.
local bind_image<const> = function(management, header, ordinary_bank, system_bank, installed, system_bytes, cart0_bytes, cart1_bytes, root, slot, source_cycles)
	local image<const>: *immutable_image_operands = header -- T:1054-1061 C:330-355 F:10-15
	if image.magic ~= image_magic then return invalid_header end -- T:1047 C:335
	local socket<const> = slot < 0 and 0 or slot
	local cart_bytes<const> = socket == 0 and cart0_bytes or cart1_bytes
	local count<const>, global_count<const>, system_count<const> = image.constants_count, image.global_count, image.system_count
	local constant_address<const>, global_address<const>, system_address<const> = image.constants, image.global_names, image.system_names
	local constant_base<const>, constant_bytes<const> = rom_source(constant_address, socket, system_bytes, cart_bytes)
	local ordinary_names<const>, ordinary_bytes<const> = rom_source(global_address, socket, system_bytes, cart_bytes)
	local system_names<const>, system_names_bytes<const> = rom_source(system_address, socket, system_bytes, cart_bytes)
	if count ~= 0 and (count < 0 or constant_address < 0 or (constant_address & 3) ~= 0
		or constant_bytes < 0 or count > constant_bytes // sizeof(constant_record)) then return invalid_header end
	if global_count ~= 0 and (global_count < 0 or global_address < 0 or (global_address & 3) ~= 0
		or ordinary_bytes < 0 or global_count > ordinary_bytes // 4) then return invalid_header end
	if system_count ~= 0 and (system_count < 0 or system_address < 0 or (system_address & 3) ~= 0
		or system_names_bytes < 0 or system_count > system_names_bytes // 4) then return invalid_header end
	local constants<const>: *constant_record = constant_base -- T:1059,1062 C:327-348 F:10
	local strings_count = 0 -- T:1066,1069 C:361,365
	for index = 0, count - 1 do -- T:1070 C:366-367
		if constants[index].tag == string_constant_tag then strings_count = strings_count + 1 end -- T:1072-1073 C:367-368
	end
	local extent<const> = 4 * (global_count + system_count + strings_count) -- T:1076-1077 C:370,419
	if extent > ram_bytes then return no_storage end -- T:1077 C:371
	if slot >= 0 then
		local buckets<const>, bucket_count<const> = image.string_buckets, image.string_bucket_count
		local source<const>, available<const> = rom_source(buckets, socket, system_bytes, cart_bytes)
		if buckets < 0 or (buckets & 3) ~= 0 or bucket_count <= 0 or (bucket_count & (bucket_count - 1)) ~= 0
			or available < 0 or bucket_count > available // 4 then return invalid_header end -- StringPool.activateRomTable
		local metadata<const>: *string_metadata = layout.ram_base + management + layout.metadata_offset
		local directory<const> = slot + 1
		metadata.rom_tables[2 * directory] = source
		metadata.rom_tables[2 * directory + 1] = bucket_count
		if metadata.first_cart == 0 then metadata.first_cart = directory end
	end
	local base, strings_base, ram_count = 0, 0, 0 -- T:1139,1005-1006 C:420,282,291
	local view<const>: *installed_image_binding = installed -- T:1139-1144 C:420-426
	if extent ~= 0 then -- T:1139 C:420
		local accepted, offset
		accepted, offset, source_cycles = admission.reserve(management, root,
			0, extent, extent, true, source_cycles, 0, 0) -- T:1140 C:421 L:132-155 N:142-155
		if not accepted then return no_storage end -- L:86,153-155 N:98,153-154
		base = layout.ram_base + offset -- T:1140 C:421

		local fault
		fault, source_cycles = bind_name_table(management, root, ordinary_names, global_count, ordinary_bank, base, socket, system_bytes, cart0_bytes, cart1_bytes, source_cycles) -- T:1142 C:424
		local system_base<const> = base + 4 * global_count -- T:1143-1144 C:425-426
		if fault == 0 then
			fault, source_cycles = bind_name_table(management, root, system_names, system_count, system_bank, system_base, socket, system_bytes, cart0_bytes, cart1_bytes, source_cycles) -- T:1143 C:425
		end
		if fault == 0 then
			strings_base = system_base + 4 * system_count -- T:1147 C:440
			local slot = 0 -- T:1005-1006 C:282,291
			for index = 0, count - 1 do -- T:968,996 C:282; copy only the decoded String ordinals into binding RAM
				if constants[index].tag == string_constant_tag then -- T:996 C:270-272
					local id
					id, fault = resolve_initial_string(management, constants[index].word, socket, system_bytes, cart0_bytes, cart1_bytes) -- T:1001-1003 C:287-289
					if fault ~= 0 then break end -- S:253 R:253; malformed external operand
					ram_count = string_bindings.store_binding(strings_base, strings_count, slot, ram_count, id) -- T:1003,1009 C:289,301
					slot = slot + 1 -- T:1005 C:291
				end
			end
		end
		if fault ~= 0 then
			-- No installed binding owns this reservation; a cartridge
			-- rejection returns to a console that can still be reset.
			records.bmsx_dlmalloc_release_record(management + layout.arena_offset, offset, extent, management + layout.occupied_offset)
			return fault
		end
	end
	view.strings = strings_base -- T:1147 C:440; compact prefix belongs to this installed binding
	view.ram_strings = ram_count -- T:1005-1006 C:282,291
	view.base = base -- T:1178 C:421; the actual installed operand block
	view.bytes = extent -- T:1076-1077 C:370,419; this bank owns the original charged span
	return 0, source_cycles -- T:1167-1181 C:441
end

local bind_initial_image<const> = function(management, header, ordinary_bank, system_bank, installed, system_bytes, cart0_bytes, root)
	return (bind_image(management, header, ordinary_bank, system_bank, installed, system_bytes, cart0_bytes, 0, root, -1, 0))
end

local bind_cartridge<const> = function(slot, header, system_bytes, cart0_bytes, cart1_bytes, startup, root_thread)
	local management_port<const>: *u32 = layout.management_address
	local source_cycles<const>: *u32 = layout.call_cycles_address
	local management<const> = *management_port
	local state<const> = layout.ram_base + management
	local system_bank<const> = state + layout.system_global_bank_offset
	local ordinary_bank<const> = system_bank + sizeof(namespace_bank)
	local installed<const> = state + layout.installed_image_bindings_offset + (slot + 1) * sizeof(installed_image_binding)
	local status<const>, remaining<const> = bind_image(management, header | (slot << 31), ordinary_bank, system_bank, installed,
		system_bytes, cart0_bytes, cart1_bytes, 0, slot, *source_cycles)
	if status ~= 0 then return status end
	-- EXEC still owns Function fetch and execution admission. Only a
	-- readable cartridge Function contributes a backing reservation.
	local cart_bytes<const> = slot == 0 and cart0_bytes or cart1_bytes
	if startup < cart_base or startup - cart_base > cart_bytes - sizeof(launch_function_record)
		or (startup & function_align_mask) ~= 0 then return 0 end
	local entry<const>: *launch_function_record = startup | (slot << 31)
	if (entry.flags & static_function) == 0 then return 0 end
	local formals<const>, maximum<const> = entry.formals, entry.maximum
	if formals < 0 or maximum < 0 then return 0 end
	local slots = formals > maximum and formals or maximum
	if slots == 0 then slots = 1 end
	if slots > ram_bytes // 5 then return 0 end

	local owner_cell<const>: *value = state + layout.value_cell_offset
	local owner_word<const>: *u32 = state + layout.value_cell_offset
	*owner_cell = root_thread
	return (frame_storage.prepare_frame_space(management, *owner_word, slots, 2, 0, remaining))
end

return {
	bind_cartridge = bind_cartridge,
	internal = { rom_source = rom_source, resolve_initial_string = resolve_initial_string, bind_name_table = bind_name_table, bind_image = bind_image },
	bind_initial_image = bind_initial_image,
}
