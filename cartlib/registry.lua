-- Cart-wide identity only. Membership belongs to World, Space and WorldObject.
local registry<const> = {
	_entries_by_id = {},
	_id_counter = 0,
}

function registry:next_id()
	local id<const> = self._id_counter + 1
	self._id_counter = id
	return id
end

function registry:get(id)
	return self._entries_by_id[id]
end

function registry:register(entry)
	local id<const> = entry.id
	if self._entries_by_id[id] ~= nil then
		error('registry.register duplicate id "' .. id .. '"')
	end
	self._entries_by_id[id] = entry
end

function registry:deregister(entry)
	self._entries_by_id[entry.id] = nil
end

return registry
