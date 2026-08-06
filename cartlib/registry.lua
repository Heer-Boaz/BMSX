local componentclass<const> = require('cartlib/component/componentclass')
local dense_set<const> = require('cartlib/util/dense_set')

local registry<const> = {
	_claims_by_id = {},
	_objects_by_id = {},
	_objects_by_definition = {},
	_components_by_class = {},
	_by_tag = {},
	_id_counter = 0,
}

local empty_bucket<const> = {}
local generated_id_max<const> = 0x7fffffff

local add_object_definition<const> = function(self, obj)
	local definition_id<const> = obj.definition_id
	local bucket = self._objects_by_definition[definition_id]
	if bucket == nil then
		bucket = dense_set.new()
		self._objects_by_definition[definition_id] = bucket
	end
	dense_set.add(bucket, obj)
end

local add_component_classes<const> = function(self, comp)
	local classes<const> = componentclass.chain(getmetatable(comp))
	for class_index = 1, #classes do
		local component_class<const> = classes[class_index]
		local bucket = self._components_by_class[component_class]
		if bucket == nil then
			bucket = dense_set.new()
			self._components_by_class[component_class] = bucket
		end
		dense_set.add(bucket, comp)
	end
end

local add_object_tag<const> = function(self, obj, tag)
	local bucket = self._by_tag[tag]
	if bucket == nil then
		bucket = dense_set.new()
		self._by_tag[tag] = bucket
	end
	dense_set.add(bucket, obj)
end

local add_object_tags<const> = function(self, obj)
	local tags<const> = obj.tags
	for tag in pairs(tags) do
		add_object_tag(self, obj, tag)
	end
end

local remove_object_tags<const> = function(self, obj)
	local tags<const> = obj.tags
	for tag in pairs(tags) do
		dense_set.remove(self._by_tag[tag], obj)
	end
end

function registry:next_id(prefix)
	local number = self._id_counter + 1
	if number >= generated_id_max then
		number = 1
	end

	local id = prefix .. '_' .. tostring(number)
	while self:is_id_claimed(id) do
		number = number + 1
		if number >= generated_id_max then
			number = 1
		end
		id = prefix .. '_' .. tostring(number)
	end

	self._id_counter = number
	return id
end

function registry:reserve(entity)
	local id<const> = entity.id
	if self._claims_by_id[id] ~= nil then
		error('registry.reserve duplicate id "' .. id .. '"')
	end
	self._claims_by_id[id] = entity
end

function registry:get_object(id)
	return self._objects_by_id[id]
end

function registry:is_id_claimed(id)
	return self._claims_by_id[id] ~= nil
end

function registry:register(entity)
	local existing<const> = self._claims_by_id[entity.id]
	if existing ~= nil and existing ~= entity then
		error('registry.register duplicate id "' .. entity.id .. '"')
	end
	self._claims_by_id[entity.id] = entity
end

function registry:register_object(obj)
	self:register(obj)
	self._objects_by_id[obj.id] = obj
	add_object_definition(self, obj)
	add_object_tags(self, obj)
end

function registry:register_component(comp)
	self:register(comp)
	add_component_classes(self, comp)
end

function registry:reconcile_tag(obj, tag)
	local bucket<const> = self._by_tag[tag]
	if obj.tags[tag] then
		if bucket == nil then
			add_object_tag(self, obj, tag)
		elseif bucket.indices[obj] == nil then
			dense_set.add(bucket, obj)
		end
	elseif bucket ~= nil and bucket.indices[obj] ~= nil then
		dense_set.remove(bucket, obj)
	end
end

function registry:deregister(entity)
	self._claims_by_id[entity.id] = nil
end

function registry:deregister_object(obj)
	remove_object_tags(self, obj)
	dense_set.remove(self._objects_by_definition[obj.definition_id], obj)
	self._objects_by_id[obj.id] = nil
	self:deregister(obj)
end

function registry:deregister_component(comp)
	local classes<const> = componentclass.chain(getmetatable(comp))
	for class_index = 1, #classes do
		dense_set.remove(self._components_by_class[classes[class_index]], comp)
	end
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

function registry:objects_by_tag(tag)
	local bucket<const> = self._by_tag[tag]
	return bucket and bucket.items or empty_bucket
end

return registry
