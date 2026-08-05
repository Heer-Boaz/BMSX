local dense_set<const> = require('cartlib/util/dense_set')

local space<const> = {}
space.__index = space

function space.new(id)
	return setmetatable({
		id = id,
		_objects = {},
		_active_objects = {},
		_active_objects_by_type = {},
		_active_objects_by_tag = {},
		_active_components_by_type = {},
		_active_visuals = {},
	}, space)
end

function space:active_objects()
	return self._active_objects
end

function space:active_objects_by_type(type_name)
	local bucket<const> = self._active_objects_by_type[type_name]
	return bucket and bucket.items
end

function space:active_objects_by_tag(tag)
	local bucket<const> = self._active_objects_by_tag[tag]
	return bucket and bucket.items
end

function space:active_visuals()
	return self._active_visuals
end

function space:register_component_type(type_name)
	local bucket<const> = {}
	self._active_components_by_type[type_name] = bucket
	return bucket
end

function space:component_bucket(type_name)
	return self._active_components_by_type[type_name]
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
	local index = #objects + 1
	while index > 1 and objects[index - 1].z > obj.z do
		local moved<const> = objects[index - 1]
		objects[index] = moved
		moved._active_object_index = index
		index = index - 1
	end
	objects[index] = obj
	obj._active_space = self
	obj._active_object_index = index

	local type_bucket = self._active_objects_by_type[obj.type_name]
	if type_bucket == nil then
		type_bucket = dense_set.new()
		self._active_objects_by_type[obj.type_name] = type_bucket
	end
	dense_set.add(type_bucket, obj)
	obj._active_tag_count = 0
	for tag in pairs(obj.tags) do
		self:add_active_tag(obj, tag)
	end
end

function space:deactivate_object(obj)
	dense_set.remove(self._active_objects_by_type[obj.type_name], obj)
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
	for moved_index = index + 1, last_index do
		local moved<const> = objects[moved_index]
		objects[moved_index - 1] = moved
		moved._active_object_index = moved_index - 1
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
	local bucket<const> = self._active_components_by_type[comp.type_name]
	if bucket ~= nil then
		local index<const> = #bucket + 1
		bucket[index] = comp
		comp._active_component_index = index
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

	local index<const> = comp._active_component_index
	if index ~= nil then
		local bucket<const> = self._active_components_by_type[comp.type_name]
		local last_index<const> = #bucket
		if index < last_index then
			local moved<const> = bucket[last_index]
			bucket[index] = moved
			moved._active_component_index = index
		end
		bucket[last_index] = nil
		comp._active_component_index = nil
	end
	comp._active_space = nil
end

return space
