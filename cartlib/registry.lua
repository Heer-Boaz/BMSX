local dense_set<const> = require('cartlib/util/dense_set')

local registry<const> = {
	_entries_by_id = {},
	_entries_by_key = {},
	_keys_by_entry = {},
	_id_counter = 0,
}

local empty_entries<const> = {}

local add_index<const> = function(self, entry, key)
	local bucket = self._entries_by_key[key]
	if bucket == nil then
		bucket = dense_set.new()
		self._entries_by_key[key] = bucket
	end
	dense_set.add(bucket, entry)
	local keys = self._keys_by_entry[entry]
	if keys == nil then
		keys = {}
		self._keys_by_entry[entry] = keys
	end
	keys[key] = true
end

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

function registry:index(entry, key)
	add_index(self, entry, key)
end

function registry:reconcile_index(entry, key, included)
	local keys<const> = self._keys_by_entry[entry]
	local indexed<const> = keys ~= nil and keys[key] ~= nil
	if included then
		if not indexed then
			add_index(self, entry, key)
		end
	elseif indexed then
		dense_set.remove(self._entries_by_key[key], entry)
		keys[key] = nil
	end
end

function registry:deregister(entry)
	local keys<const> = self._keys_by_entry[entry]
	if keys ~= nil then
		for key in pairs(keys) do
			dense_set.remove(self._entries_by_key[key], entry)
		end
		self._keys_by_entry[entry] = nil
	end
	self._entries_by_id[entry.id] = nil
end

function registry:entries(key)
	local bucket<const> = self._entries_by_key[key]
	return bucket and bucket.items or empty_entries
end

return registry
