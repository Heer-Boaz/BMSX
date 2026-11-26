module<const>

-- Source basis: fdbb99cb46fbf8381dff4e5a065ae765dee1b525.
-- T/C LuaHeap, A/B allocator binding, L/R/H Closure layout and writes,
-- N/P CPU, U/V/W GC, O/Q object prefix, J/K tags, M RAM.
-- The caller has admitted a canonical ROM cache miss with no captures.
-- Logical/physical admission policy and a refused reservation's recovery
-- remain at the CPU continuation. There are no new cells or latched tail.
local arena<const> = require('kernel/dlmalloc') -- T:231-234 C:246-248 A:56-58 B:54-56
local collector<const> = require('kernel/gc_control') -- N:1278-1279 P:164-165 U:147-155 V:235-244
local ram_base<const> = 0x08000000 -- A:58 B:56 M:6
local object_prefix<const> = 8 -- T:233,250 C:248,264 O:6,9 Q:9,13
local closure_kind<const> = 7 -- L:63 R:21 J:9-10 K:21-22
local canonical<const> = 4 -- L:35,62 R:19-20 H:54

struct rom_closure
	kind: u32 -- L:62-63 R:19-22 H:52-57
	gray: u32 -- L:64 R:23 O:8 Q:15
	prototype: addr -- L:39,73 R:24 H:58
end

local canonical_bytes<const> = 12 -- T:227-228 C:242-243 L:40-43 H:59-60,64-66; fixed export of sizeof(rom_closure)

local create_closure<const> = function(state, control, occupied, function_address, execution_domain) -- T:226 C:241 N:1276-1279 P:161-165,585
	local base<const> = arena.bmsx_dlmalloc_allocate(state, canonical_bytes + object_prefix, 1) -- T:233 C:248 A:56-58 B:54-56
	if base == 0 then return 0 end -- T:232,234,255 C:247-248,269; retire refusal to the caller before retrying
	local charge<const>: *u32 = ram_base + occupied -- T:249,272-274 C:263,283-285
	*charge = *charge + canonical_bytes -- T:235,241-244,249,274 C:249,255-259,263,285; the empty cell loop, including its unused white sample, reduces to this charge
	local offset<const> = base + object_prefix -- T:250 C:264
	local address<const> = ram_base + offset -- A:58 B:56 N:1277-1279 P:163-165
	local record<const>: *rom_closure = address -- L:61,72 R:18 N:1278 P:164
	local white<const>: *u8 = ram_base + control + collector.internal.white_offset -- N:1278 P:164 U:102 W:93; the unused no-cell white sample has no effect
	local flags<const> = (execution_domain + 1) | canonical -- L:62 R:19-20 H:69-71
	record.kind = closure_kind | ((*white & 1) << 8) | (flags << 16) -- L:63 R:21-22 U:102 W:93
	record.gray = 0 -- L:64 R:23; no capture-count bits
	record.prototype = function_address -- L:65,72-74 R:24-25; no latched tail
	collector.publish_object(control, address) -- N:1279 P:165 U:147-155 V:235-244
	return offset -- N:1281 P:166,587; the CPU publishes the canonical index and destination
end

return { create_closure = create_closure, canonical_bytes = canonical_bytes }
