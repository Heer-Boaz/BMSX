-- Studio read-only layout contract: docs/cartlib_inspection_contract.md.
local dense_set<const> = require('cartlib/util/dense_set')

local registry<const> = {
	_entries_by_id = {},
	_entries_by_key = {},
	_keys_by_entry = {},
	_empty_buckets = {},
	_id_counter = 0,
}

local empty_entries<const> = {}

-- Registry is the cart-wide identity and generic key index. World lifecycle,
-- prefab definitions and active-space membership remain with their own owners;
-- every indexed key uses this same dense representation.

local add_index<const> = function(self, entry, key)
	local bucket = self._entries_by_key[key]
	if bucket == nil then
		local empty_buckets<const> = self._empty_buckets
		local last_index<const> = #empty_buckets
		if last_index == 0 then
			bucket = dense_set.new()
		else
			bucket = empty_buckets[last_index]
			empty_buckets[last_index] = nil
		end
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

-- A key belongs to the live index only while it has members. Empty storage
-- has a separate Registry lifetime, with no former key or member attached.
local remove_index<const> = function(self, entry, key)
	local bucket<const> = self._entries_by_key[key]
	dense_set.remove(bucket, entry)
	if #bucket.items == 0 then
		self._entries_by_key[key] = nil
		local empty_buckets<const> = self._empty_buckets
		empty_buckets[#empty_buckets + 1] = bucket
	end
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
		remove_index(self, entry, key)
		keys[key] = nil
	end
end

function registry:deregister(entry)
	local keys<const> = self._keys_by_entry[entry]
	if keys ~= nil then
		for key in pairs(keys) do
			remove_index(self, entry, key)
		end
		self._keys_by_entry[entry] = nil
	end
	self._entries_by_id[entry.id] = nil
end

-- Call-local membership borrow, invalidated by Registry mutations. Stable
-- retained system views belong to World/Space rather than this key index.
function registry:entries(key)
	local bucket<const> = self._entries_by_key[key]
	return bucket and bucket.items or empty_entries
end

return registry
