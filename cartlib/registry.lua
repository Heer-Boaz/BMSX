local dense_set<const> = require('cartlib/util/dense_set')

local registry<const> = {
	_by_id = {},
	_by_type = {},
	_by_tag = {},
	_reservations = {},
	_entities = dense_set.new(),
}

local empty_bucket<const> = {}

local add_entity_type<const> = function(self, entity)
	local type_name<const> = entity.type_name
	if type_name ~= nil then
		local bucket = self._by_type[type_name]
		if bucket == nil then
			bucket = dense_set.new()
			self._by_type[type_name] = bucket
		end
		dense_set.add(bucket, entity)
	end
end

local remove_entity_type<const> = function(self, entity)
	local type_name<const> = entity.type_name
	if type_name ~= nil then
		dense_set.remove(self._by_type[type_name], entity)
	end
end

local add_entity_tag<const> = function(self, entity, tag)
	local bucket = self._by_tag[tag]
	if bucket == nil then
		bucket = dense_set.new()
		self._by_tag[tag] = bucket
	end
	dense_set.add(bucket, entity)
end

local add_entity_tags<const> = function(self, entity)
	local tags<const> = entity.tags
	if tags ~= nil then
		for tag in pairs(tags) do
			add_entity_tag(self, entity, tag)
		end
	end
end

local remove_entity_tags<const> = function(self, entity)
	local tags<const> = entity.tags
	if tags ~= nil then
		for tag in pairs(tags) do
			dense_set.remove(self._by_tag[tag], entity)
		end
	end
end

function registry:reserve(entity)
	local id<const> = entity.id
	if self._by_id[id] ~= nil or self._reservations[id] ~= nil then
		error('registry.reserve duplicate id "' .. id .. '"')
	end
	self._reservations[id] = entity
end

function registry:get(id)
	return self._by_id[id]
end

function registry:is_id_claimed(id)
	return self._by_id[id] ~= nil or self._reservations[id] ~= nil
end

function registry:register(entity)
	local existing<const> = self._by_id[entity.id]
	if existing ~= nil and existing ~= entity then
		error('registry.register duplicate id "' .. entity.id .. '"')
	end
	self._reservations[entity.id] = nil
	self._by_id[entity.id] = entity
	dense_set.add(self._entities, entity)
	add_entity_type(self, entity)
	add_entity_tags(self, entity)
end

function registry:reconcile_tag(entity, tag)
	local bucket<const> = self._by_tag[tag]
	if entity.tags[tag] then
		if bucket == nil then
			add_entity_tag(self, entity, tag)
		elseif bucket.indices[entity] == nil then
			dense_set.add(bucket, entity)
		end
	elseif bucket ~= nil and bucket.indices[entity] ~= nil then
		dense_set.remove(bucket, entity)
	end
end

function registry:deregister(entity)
	remove_entity_tags(self, entity)
	remove_entity_type(self, entity)
	dense_set.remove(self._entities, entity)
	self._by_id[entity.id] = nil
end

function registry:clear()
	local entities<const> = self._entities.items
	local index = #entities
	while index > 0 do
		local entity<const> = entities[index]
		if not entity.registrypersistent then
			self:deregister(entity)
		end
		index = index - 1
	end
end

function registry:entities_by_type(type_name)
	local bucket<const> = self._by_type[type_name]
	return bucket and bucket.items or empty_bucket
end

function registry:entities_by_tag(tag)
	local bucket<const> = self._by_tag[tag]
	return bucket and bucket.items or empty_bucket
end

return registry
