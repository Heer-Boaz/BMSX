-- Cold declaration admission. Runtime Scenes consume these retained bindings,
-- never resolving a member's prefab name again during staged construction.
local prefab<const> = require('cartlib/world/prefab')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local scene_plan<const> = {}
local empty_options<const> = {}

function scene_plan.compile(declaration)
	local plan<const> = shallow_copy(declaration)
	local objects<const> = {}
	local members_by_id<const> = {}
	local declared_objects<const> = declaration.objects
	for index = 1, #declared_objects do
		local source<const> = declared_objects[index]
		local member_id<const> = source.member_id
		if members_by_id[member_id] ~= nil then
			error('scene member already declared: ' .. member_id)
		end
		local definition<const> = prefab.definition(source.definition_id)
		if definition == nil then
			error('scene prefab is not registered: ' .. source.definition_id)
		end
		local local_transform = definition.default_local_transform
		local spatial_source<const> = source.spatial
		if spatial_source ~= nil then
			if definition.spatial_constructor == nil then
				error('scene spatial input belongs to a nonspatial member: ' .. member_id)
			end
			if spatial_source.local_transform ~= nil then
				local_transform = shallow_copy(spatial_source.local_transform)
				local validate_local<const> = definition.spatial_validate_local
				if validate_local ~= nil then
					validate_local(local_transform)
				end
			end
		end
		local member<const> = {
			index = index,
			member_id = member_id,
			definition_id = definition.definition_id,
			definition = definition,
			options = shallow_copy(source.options or empty_options),
			local_transform = local_transform,
		}
		objects[index] = member
		members_by_id[member_id] = member
	end

	-- Resolve forward references after every authored identity exists. The
	-- numeric child links retain authored sibling order independently of the
	-- parent-first construction order.
	local last_children<const> = {}
	local ready<const> = {}
	for index = 1, #objects do
		local member<const> = objects[index]
		local spatial_source<const> = declared_objects[index].spatial
		local parent_id<const> = spatial_source and spatial_source.parent_id
		if parent_id ~= nil then
			if member.definition.spatial_root_origin then
				error('scene root-origin member cannot have a parent: ' .. member.member_id)
			end
			local parent<const> = members_by_id[parent_id]
			if parent == nil then
				error('scene spatial parent is not declared: ' .. parent_id)
			end
			if parent.definition.spatial_constructor == nil then
				error('scene spatial parent is nonspatial: ' .. parent_id)
			end
			if parent.definition.spatial_family ~= member.definition.spatial_family then
				error('scene spatial parent belongs to another family: ' .. member.member_id)
			end
			local parent_index<const> = parent.index
			member.parent_index = parent_index
			local previous<const> = last_children[parent_index]
			if previous == nil then
				parent.first_child_index = index
			else
				objects[previous].next_sibling_index = index
			end
			last_children[parent_index] = index
		else
			ready[#ready + 1] = index
		end
	end

	-- Kahn ordering selects the smallest authored index among the currently
	-- ready members. A numeric min-heap keeps cold compilation O(N log N),
	-- including forward-parent chains interleaved with independent roots.
	local construction_order<const> = {}
	local ready_count = #ready
	for order_index = 1, #objects do
		if ready_count == 0 then
			error('scene spatial parent cycle')
		end
		local index<const> = ready[1]
		local last<const> = ready[ready_count]
		ready[ready_count] = nil
		ready_count = ready_count - 1
		if ready_count > 0 then
			local position = 1
			local child = 2
			while child <= ready_count do
				if child < ready_count and ready[child + 1] < ready[child] then
					child = child + 1
				end
				if last < ready[child] then
					break
				end
				ready[position] = ready[child]
				position = child
				child = position * 2
			end
			ready[position] = last
		end
		local member<const> = objects[index]
		construction_order[order_index] = member
		local child_index = member.first_child_index
		while child_index ~= nil do
			ready_count = ready_count + 1
			local position = ready_count
			while position > 1 do
				local parent_position<const> = position // 2
				local parent_index<const> = ready[parent_position]
				if parent_index < child_index then
					break
				end
				ready[position] = parent_index
				position = parent_position
			end
			ready[position] = child_index
			child_index = objects[child_index].next_sibling_index
		end
	end
	plan.objects = objects
	plan.members_by_id = members_by_id
	plan.construction_order = construction_order
	return plan
end

return scene_plan
