module<const>

-- Source basis: 91ce105cf4d9649c20b9e04205dede1df9f8b297.
-- T/C: CPU, G/H: GlobalBank, L/N: LuaHeap, S/R: StringPool,
-- I/J: execution-image records, M/E: memory/domain specification.
-- Frame closure and the floor attempt separate these two retirement stages.
local layout<const> = require('kernel/gc_runtime_layout') -- L:26-29 N:22-25 M:6
local records<const> = require('kernel/dlmalloc_record') -- L:288-292 N:291-295
local names<const> = require('kernel/global_bank') -- G:9-10,50-53 H:9,32-35

local _bindings<const> = require('kernel/image_string_bindings') -- I:348-349 J:192; installed record owns its String prefix

local retire_namespace<const> = function(management, address) -- G:50 H:32
	local bank<const>: *namespace_bank = address -- G:9,50 H:32
	local values<const> = bank.values -- G:51 H:33
	if values ~= 0 then -- G:51 H:33
		local base<const> = values - names.internal.name_index_slot_bytes * bank.capacity
		records.bmsx_dlmalloc_release_record(management + layout.arena_offset, base - layout.ram_base, names.name_charge * bank.count, management + layout.occupied_offset) -- G:10,51 H:9,33 L:289-291 N:292-294
	end
	bank.values = 0 -- G:52 H:34
	bank.capacity = 0 -- G:52 H:34
	bank.count = 0 -- G:52-53 H:34; CPU releases its host view at its ownership boundary
end

local retire_namespaces<const> = function(management, system_bank, ordinary_bank) -- T:946-951 C:624-629
	retire_namespace(management, system_bank) -- T:949 C:627
	retire_namespace(management, ordinary_bank) -- T:950 C:628
end

local retire_images<const> = function(management, installed) -- T:930-935 C:219,223-230
	local bindings<const>: *installed_image_binding = installed -- T:931 C:223 I:348-349 J:192
	local arena<const> = management + layout.arena_offset -- L:289 N:292 M:6
	local occupied<const> = management + layout.occupied_offset -- L:290-291 N:293-294
	for lane = 0, 2 do -- T:931 C:223-224 E:1-3; System, socket 0, socket 1
		local base<const> = bindings[lane].base -- T:1016 C:303
		if base ~= 0 then -- T:1016 C:303
			-- C++ exchanges the host base before free; TS detaches it after.
			-- Choose the existing C++ order for this now-pausable RAM record.
			local bytes<const> = bindings[lane].bytes -- 4b2ca9763 CPU C++:231-236; retain charge for release
			bindings[lane].base = 0 -- T:1018 C:303; no backing in an empty lane
			bindings[lane].bytes = 0 -- 4b2ca9763 CPU C++:233; a retired lane has no installed extent
			bindings[lane].strings = 0 -- T:1018 C:303; detach the prefix with its backing
			bindings[lane].ram_strings = 0 -- T:1018 C:303
			records.bmsx_dlmalloc_release_record(arena, base - layout.ram_base, bytes, occupied) -- T:1017 C:304 L:289-291 N:292-294
		end
	end
	local metadata<const>: *string_metadata = layout.ram_base + management + layout.metadata_offset -- S:20-21,126-128 R:21-22,136-138 M:6
	metadata.first_cart = 0 -- T:934 C:228 S:127 R:137
	for field = 0, 5 do -- S:128 R:138; three physical address/extent pairs
		metadata.rom_tables[field] = 0 -- S:128 R:138
	end
end

return { retire_namespaces = retire_namespaces, retire_images = retire_images, internal = { retire_namespace = retire_namespace } }
