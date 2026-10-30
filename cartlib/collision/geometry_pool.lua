-- A cart supplies the BSS span and fixed slot class. Live collider bindings
-- own stable slots; retired slots reuse their first raw word as the free link.
local geometry_pool<const> = {}

function geometry_pool.new(base, slot_bytes, slot_count)
	return { base = base, slot_bytes = slot_bytes, slot_count = slot_count,
		_next_slot = 0, _free = 0 }
end

function geometry_pool.acquire(pool)
	local address<const> = pool._free
	if address ~= 0 then
		local link<const>: *word = address
		pool._free = *link
		return address
	end
	local index<const> = pool._next_slot
	if index == pool.slot_count then
		error('collider geometry pool capacity exceeded')
	end
	pool._next_slot = index + 1
	return pool.base + index * pool.slot_bytes
end

function geometry_pool.release(pool, address)
	local link<const>: *word = address
	*link = pool._free
	pool._free = address
end

return geometry_pool
