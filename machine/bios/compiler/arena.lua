local arena<const> = {}

local arena_capacity<const> = 0x00040000

bss runtime_code_arena: u8[arena_capacity]
bss runtime_code_arena_offset: word

function arena.allocate(byte_count, alignment)
	local arena_address<const> = &runtime_code_arena
	local address<const> = (
		arena_address
		+ *runtime_code_arena_offset
		+ alignment
		- 1
	) & -alignment
	local next_offset<const> = address + byte_count - arena_address
	if next_offset > arena_capacity then
		error('runtime compiler memory exhausted')
	end
	*runtime_code_arena_offset = next_offset
	return address
end

return arena
