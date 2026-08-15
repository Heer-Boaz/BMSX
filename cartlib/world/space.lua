local component_class_chain<const> = require('cartlib/component/component_class').chain
local dense_set<const> = require('cartlib/util/dense_set')

local space<const> = {}
space.__index = space

-- A space materializes only the retained definition and component views that
-- configured systems request. Adding a view hydrates it once; steady updates
-- iterate its dense items directly.

function space.new(id)
	return setmetatable({
		id = id,
		_active_objects = {},
		_active_objects_by_definition = {},
		_active_components_by_class = {},
		_ticking_components_by_class = {},
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
	local objects<const> = self._active_objects
	for object_index = 1, #objects do
		local obj<const> = objects[object_index]
		if obj.definition_id == definition_id then
			dense_set.add(bucket, obj)
		end
	end
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
				local classes<const> = component_class_chain(getmetatable(component))
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

function space:register_tick_class(component_class)
	local tick_buckets<const> = self._ticking_components_by_class
	local existing<const> = tick_buckets[component_class]
	if existing ~= nil then
		return existing.items
	end
	local bucket<const> = dense_set.new()
	tick_buckets[component_class] = bucket
	local components<const> = self:register_component_class(component_class)
	for component_index = 1, #components do
		local component<const> = components[component_index]
		if component._tick_enabled then
			dense_set.add(bucket, component)
		end
	end
	return bucket.items
end

function space:tick_bucket(component_class)
	return self._ticking_components_by_class[component_class].items
end

function space:reconcile_component_tick(comp)
	local classes<const> = component_class_chain(getmetatable(comp))
	local tick_buckets<const> = self._ticking_components_by_class
	local enabled<const> = comp._tick_enabled
	for class_index = 1, #classes do
		local bucket<const> = tick_buckets[classes[class_index]]
		if bucket ~= nil then
			local included<const> = bucket.indices[comp] ~= nil
			if enabled then
				if not included then
					dense_set.add(bucket, comp)
				end
			elseif included then
				dense_set.remove(bucket, comp)
			end
		end
	end
end

function space:activate_object(obj)
	local objects<const> = self._active_objects
	local index<const> = #objects + 1
	objects[index] = obj
	obj._active_space = self
	obj._active_object_index = index

	local definition_bucket<const> = self._active_objects_by_definition[obj.definition_id]
	if definition_bucket ~= nil then
		dense_set.add(definition_bucket, obj)
	end
end

function space:deactivate_object(obj)
	local definition_bucket<const> = self._active_objects_by_definition[obj.definition_id]
	if definition_bucket ~= nil then
		dense_set.remove(definition_bucket, obj)
	end

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

function space:activate_component(comp, visual_sequence)
	comp._active_space = self
	local classes<const> = component_class_chain(getmetatable(comp))
	local component_buckets<const> = self._active_components_by_class
	for class_index = 1, #classes do
		local bucket<const> = component_buckets[classes[class_index]]
		if bucket ~= nil then
			dense_set.add(bucket, comp)
		end
	end
	if comp._tick_enabled then
		local tick_buckets<const> = self._ticking_components_by_class
		for class_index = 1, #classes do
			local bucket<const> = tick_buckets[classes[class_index]]
			if bucket ~= nil then
				dense_set.add(bucket, comp)
			end
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

	local classes<const> = component_class_chain(getmetatable(comp))
	local tick_buckets<const> = self._ticking_components_by_class
	for class_index = 1, #classes do
		local bucket<const> = tick_buckets[classes[class_index]]
		if bucket ~= nil and bucket.indices[comp] ~= nil then
			dense_set.remove(bucket, comp)
		end
	end
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
