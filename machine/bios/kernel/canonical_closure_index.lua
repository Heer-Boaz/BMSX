module<const>

-- Source basis: 8d86f3126d51726af64f065ff55058c83c61915f.
-- TS CPU 1101–1122 / C++ CPU 600–619 select the least-addressed live
-- prototype match. TS Closure 23–28 matches the complete sampled tuple,
-- and TS GcHeap 168–170 excludes old-white records during Sweep.
-- StaticClosureIndex.ts 19–63 is lookup, publication and weak retirement;
-- the former host map and observer are replaced by this firmware chain.
-- The GC inventory still owns the word at record-4. The other allocated
-- prefix word (record-8) carries the weak chain, independently of the GC link.
local layout<const> = require('kernel/gc_runtime_layout')
local gc<const> = require('kernel/gc_control').internal
local prefix_bytes<const> = require('kernel/dlmalloc_record').internal.object_prefix
local ram_base<const> = layout.ram_base
local management<const> = layout.management_offset
local heads_address<const> = ram_base + management + layout.canonical_closure_heads_offset
local head_count<const> = 128
local record_shift<const> = 3
local link_bits<const> = 19
local link_mask<const> = (1 << link_bits) - 1
local canonical_flag<const> = 4
local latched_flag<const> = 8 << 16
local sweep<const> = 4

struct indexed_closure
	chain: u32
	inventory_link: addr
	header: u32
	gray: u32
	prototype: addr
	code: addr
	params: u32
	stack: u32
	flags: u32
	descriptors: addr
	count: u32
end

local bucket<const> = function(prototype, domain)
	local key<const> = prototype >> 2
	return (key ~ (key >> 7) ~ (key >> 14) ~ (domain * 37)) & (head_count - 1)
end

local initialize<const> = function()
	local heads<const>: *u32 = heads_address
	for i = 0, head_count - 1 do heads[i] = 0 end
end

local find<const> = function(control, prototype, domain, code, formals, stack, flags, descriptors, count, rom)
	local heads<const>: *u32 = heads_address
	local white<const>: *u8 = ram_base + control + gc.white_offset
	local dead<const> = gc.phase(control) == sweep and ((*white & 1) ~ 1) or -1
	local index = heads[bucket(prototype, domain)]
	local first = 0
	while index ~= 0 do
		local offset<const> = index << record_shift
		local closure<const>: *indexed_closure = ram_base + offset - prefix_bytes
		if (first == 0 or offset < first) and closure.prototype == prototype then
			local header<const> = closure.header
			if ((header >> 16) & 3) == (domain + 1) and ((header >> 8) & 3) ~= dead then
				if rom ~= 0 then
					-- The selected physical ROM record is immutable at a given domain/address.
					if (header & latched_flag) == 0 then first = offset end
				elseif (header & latched_flag) ~= 0 and closure.code == code and closure.params == formals
					and closure.stack == stack and closure.flags == flags and closure.descriptors == descriptors
					and closure.count == count then
					first = offset
				end
			end
		end
		index = closure.chain & link_mask
	end
	return first
end

local publish<const> = function(address, prototype, domain)
	local home<const> = bucket(prototype, domain)
	local heads<const>: *u32 = heads_address
	local closure<const>: *indexed_closure = address - prefix_bytes
	closure.chain = (home << link_bits) | heads[home]
	heads[home] = (address - ram_base) >> record_shift
end

local retire<const> = function(address)
	local closure_link<const>: *u32 = address - prefix_bytes
	local packed<const> = *closure_link
	local home<const> = packed >> link_bits
	local index<const> = (address - ram_base) >> record_shift
	local heads<const>: *u32 = heads_address
	local link: *u32 = &heads[home]
	while (*link & link_mask) ~= index do
		link = ram_base + ((*link & link_mask) << record_shift) - prefix_bytes
	end
	*link = (*link & ~link_mask) | (packed & link_mask)
end

return { initialize = initialize, find = find, publish = publish, retire = retire,
	bucket = bucket, canonical_flag = canonical_flag }
