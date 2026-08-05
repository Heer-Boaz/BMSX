local dense_set<const> = require('cartlib/util/dense_set')

local registry<const> = {
	_by_id = {},
	_objects_by_definition = {},
	_components_by_class = {},
	_by_tag = {},
	_reservations = {},
}

local empty_bucket<const> = {}

local add_object_definition<const> = function(self, obj)
	local definition_id<const> = obj.definition_id
	local bucket = self._objects_by_definition[definition_id]
	if bucket == nil then
		bucket = dense_set.new()
		self._objects_by_definition[definition_id] = bucket
	end
	dense_set.add(bucket, obj)
end

local add_component_class<const> = function(self, comp)
	local component_class<const> = getmetatable(comp)
	local bucket = self._components_by_class[component_class]
	if bucket == nil then
		bucket = dense_set.new()
		self._components_by_class[component_class] = bucket
	end
	dense_set.add(bucket, comp)
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
	add_entity_tags(self, entity)
end

function registry:register_object(obj)
	self:register(obj)
	add_object_definition(self, obj)
end

function registry:register_component(comp)
	self:register(comp)
	add_component_class(self, comp)
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
	self._by_id[entity.id] = nil
end

function registry:deregister_object(obj)
	dense_set.remove(self._objects_by_definition[obj.definition_id], obj)
	self:deregister(obj)
end

function registry:deregister_component(comp)
	dense_set.remove(self._components_by_class[getmetatable(comp)], comp)
	self:deregister(comp)
end

function registry:objects_by_definition(definition_id)
	local bucket<const> = self._objects_by_definition[definition_id]
	return bucket and bucket.items or empty_bucket
end

function registry:components(component_class)
	local bucket<const> = self._components_by_class[component_class]
	return bucket and bucket.items or empty_bucket
end

function registry:entities_by_tag(tag)
	local bucket<const> = self._by_tag[tag]
	return bucket and bucket.items or empty_bucket
end

return registry
