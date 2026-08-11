local isa<const> = require('bmsx/blua32')

local arena<const> = {}

local arena_capacity<const> = 0x00040000
local allocated_mask<const> = 0x80000000
local block_size_mask<const> = 0x7fffffff
local block_header_size<const> = isa.function_alignment
local minimum_block_size<const> = block_header_size + isa.function_alignment
local collect_garbage<const> = __bmsx_collect_garbage
local allocation_owners<const> = setmetatable({}, { __mode = 'v' })

bss runtime_code_arena: u8[arena_capacity]
bss runtime_code_arena_next_block: word

local arena_address<const> = &runtime_code_arena
local arena_start<const> = (
	arena_address + isa.function_alignment - 1
) & -isa.function_alignment
local arena_end<const> = (
	arena_address + arena_capacity
) & -isa.function_alignment
local first_block<const>: *u32 = arena_start
*first_block = arena_end - arena_start
*runtime_code_arena_next_block = arena_start

local is_free_block<const> = function(address, header_word)
	return (header_word & allocated_mask) == 0
		or allocation_owners[address + block_header_size] == nil
end

local allocate_block<const> = function(address, block_size, required_size, owner)
	local allocation_size<const> = block_size - required_size < minimum_block_size
		and block_size
		or required_size
	local remaining_size<const> = block_size - allocation_size
	local next_block = address + allocation_size
	if remaining_size > 0 then
		local remaining_header<const>: *u32 = next_block
		*remaining_header = remaining_size
	elseif next_block == arena_end then
		next_block = arena_start
	end
	local header<const>: *u32 = address
	*header = allocation_size | allocated_mask
	*runtime_code_arena_next_block = next_block
	local payload_address<const> = address + block_header_size
	allocation_owners[payload_address] = owner
	return payload_address
end

local find_block<const> = function(required_size, owner)
	local address = arena_start
	local free_address
	local free_size = 0
	while address < arena_end do
		local header<const>: *u32 = address
		local header_word<const> = *header
		local block_size<const> = header_word & block_size_mask
		if is_free_block(address, header_word) then
			if free_address == nil then
				free_address = address
				free_size = block_size
			else
				free_size = free_size + block_size
			end
			local free_header<const>: *u32 = free_address
			*free_header = free_size
			if free_size >= required_size then
				return allocate_block(free_address, free_size, required_size, owner)
			end
		else
			free_address = nil
			free_size = 0
		end
		address = address + block_size
	end
end

function arena.allocate(byte_count, owner)
	local required_size<const> = (
		block_header_size + byte_count + isa.function_alignment - 1
	) & -isa.function_alignment
	local next_block<const> = *runtime_code_arena_next_block
	local next_header<const>: *u32 = next_block
	local next_header_word<const> = *next_header
	local next_block_size<const> = next_header_word & block_size_mask
	if next_block_size >= required_size
		and is_free_block(next_block, next_header_word) then
		return allocate_block(next_block, next_block_size, required_size, owner)
	end
	local address<const> = find_block(required_size, owner)
	if address ~= nil then
		return address
	end
	collect_garbage()
	local collected_address<const> = find_block(required_size, owner)
	if collected_address == nil then
		error('runtime compiler memory exhausted')
	end
	return collected_address
end

return arena
