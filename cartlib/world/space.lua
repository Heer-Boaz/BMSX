local componentclass<const> = require('cartlib/component/componentclass')
local dense_set<const> = require('cartlib/util/dense_set')

local space<const> = {}
space.__index = space

function space.new(id)
	return setmetatable({
		id = id,
		_objects = {},
		_active_objects = {},
		_active_objects_by_definition = {},
		_active_objects_by_tag = {},
		_active_components_by_class = {},
		_active_visuals = {},
	}, space)
end

function space:register_definition(definition_id)
	local buckets<const> = self._active_objects_by_definition
	local bucket = buckets[definition_id]
	if bucket ~= nil then
		return bucket.items
	end
	bucket = dense_set.new()
	buckets[definition_id] = bucket
	return bucket.items
end

function space:definition_bucket(definition_id)
	return self._active_objects_by_definition[definition_id].items
end

function space:active_visuals()
	return self._active_visuals
end

function space:register_component_class(component_class)
	local component_buckets<const> = self._active_components_by_class
	local existing<const> = component_buckets[component_class]
	if existing ~= nil then
		return existing.items
	end
	local bucket<const> = dense_set.new()
	component_buckets[component_class] = bucket
	local objects<const> = self._active_objects
	for object_index = 1, #objects do
		local components<const> = objects[object_index]._components
		for component_index = 1, #components do
			local component<const> = components[component_index]
			if component._active_space == self then
				local classes<const> = componentclass.chain(getmetatable(component))
				for class_index = 1, #classes do
					if classes[class_index] == component_class then
						dense_set.add(bucket, component)
						break
					end
				end
			end
		end
	end
	return bucket.items
end

function space:component_bucket(component_class)
	return self._active_components_by_class[component_class].items
end

function space:add_object(obj)
	local objects<const> = self._objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._space = self
	obj._space_object_index = index
end

function space:remove_object(obj)
	local objects<const> = self._objects
	local index<const> = obj._space_object_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._space_object_index = index
	end
	objects[last_index] = nil
	obj._space = nil
	obj._space_object_index = nil
end

function space:activate_object(obj)
	local objects<const> = self._active_objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._active_space = self
	obj._active_object_index = index

	local definition_bucket = self._active_objects_by_definition[obj.definition_id]
	if definition_bucket == nil then
		definition_bucket = dense_set.new()
		self._active_objects_by_definition[obj.definition_id] = definition_bucket
	end
	dense_set.add(definition_bucket, obj)
	obj._active_tag_count = 0
	for tag in pairs(obj.tags) do
		self:add_active_tag(obj, tag)
	end
end

function space:deactivate_object(obj)
	dense_set.remove(self._active_objects_by_definition[obj.definition_id], obj)
	local active_tags<const> = obj._active_tags
	for index = 1, obj._active_tag_count do
		local tag<const> = active_tags[index]
		dense_set.remove(self._active_objects_by_tag[tag], obj)
		active_tags[index] = nil
	end
	obj._active_tag_count = 0

	local objects<const> = self._active_objects
	local index<const> = obj._active_object_index
	local last_index<const> = #objects
	if index < last_index then
		local moved<const> = objects[last_index]
		objects[index] = moved
		moved._active_object_index = index
	end
	objects[last_index] = nil
	obj._active_space = nil
	obj._active_object_index = nil
end

function space:add_active_tag(obj, tag)
	local bucket = self._active_objects_by_tag[tag]
	if bucket == nil then
		bucket = dense_set.new()
		self._active_objects_by_tag[tag] = bucket
	end
	dense_set.add(bucket, obj)
	local active_tags = obj._active_tags
	if active_tags == nil then
		active_tags = {}
		obj._active_tags = active_tags
	end
	local index<const> = obj._active_tag_count + 1
	obj._active_tag_count = index
	active_tags[index] = tag
end

function space:remove_active_tag(obj, tag)
	dense_set.remove(self._active_objects_by_tag[tag], obj)
	local active_tags<const> = obj._active_tags
	local last_index<const> = obj._active_tag_count
	for index = 1, last_index do
		if active_tags[index] == tag then
			active_tags[index] = active_tags[last_index]
			active_tags[last_index] = nil
			obj._active_tag_count = last_index - 1
			return
		end
	end
end

function space:reconcile_active_tag(obj, tag)
	local bucket<const> = self._active_objects_by_tag[tag]
	if obj.tags[tag] then
		if bucket == nil then
			self:add_active_tag(obj, tag)
		elseif bucket.indices[obj] == nil then
			self:add_active_tag(obj, tag)
		end
	elseif bucket ~= nil and bucket.indices[obj] ~= nil then
		self:remove_active_tag(obj, tag)
	end
end

function space:activate_component(comp, visual_sequence)
	comp._active_space = self
	local classes<const> = componentclass.chain(getmetatable(comp))
	local component_buckets<const> = self._active_components_by_class
	for class_index = 1, #classes do
		local bucket<const> = component_buckets[classes[class_index]]
		if bucket ~= nil then
			dense_set.add(bucket, comp)
		end
	end
	if comp.is_visual then
		local visuals<const> = self._active_visuals
		comp._visual_sequence = visual_sequence
		comp._active_visual_index = #visuals + 1
		visuals[comp._active_visual_index] = comp
	end
end

function space:deactivate_component(comp)
	if comp.is_visual then
		local visuals<const> = self._active_visuals
		local visual_index<const> = comp._active_visual_index
		local last_visual_index<const> = #visuals
		if visual_index < last_visual_index then
			local moved<const> = visuals[last_visual_index]
			visuals[visual_index] = moved
			moved._active_visual_index = visual_index
		end
		visuals[last_visual_index] = nil
		comp._active_visual_index = nil
		comp._visual_sequence = nil
	end

	local classes<const> = componentclass.chain(getmetatable(comp))
	local component_buckets<const> = self._active_components_by_class
	for class_index = 1, #classes do
		local bucket<const> = component_buckets[classes[class_index]]
		if bucket ~= nil then
			dense_set.remove(bucket, comp)
		end
	end
	comp._active_space = nil
end

return space
