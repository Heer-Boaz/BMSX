-- One live composition. Definitions and game/session state have independent
-- lifetimes; this owner retains only its current World objects.
local dense_set<const> = require('cartlib/util/dense_set')
local shallow_copy<const> = require('cartlib/util/shallow_copy')
local world<const> = require('cartlib/world/world')

local scene<const> = {}
scene.__index = scene

function scene.new(plan)
	return setmetatable({ definition = plan, members = {}, _members_by_index = {},
		objects = dense_set.new(), closed = false }, scene)
end

-- World calls these at construction and final teardown, including objects
-- whose admission is cancelled at the current structural barrier.
function scene:_attach(object, member_id)
	if member_id ~= nil then
		self.members[member_id] = object
		object.scene_member_id = member_id
		local member<const> = self.definition.members_by_id[member_id]
		self._members_by_index[member.index] = object
	end
	dense_set.add(self.objects, object)
end

function scene:_detach(object)
	dense_set.remove(self.objects, object)
	local member_id<const> = object.scene_member_id
	if member_id ~= nil then
		self.members[member_id] = nil
		local member<const> = self.definition.members_by_id[member_id]
		self._members_by_index[member.index] = nil
	end
end

function scene:spawn(definition_id, options, spatial_input, initial)
	return world:spawn(definition_id, options, spatial_input, initial, self)
end

-- Admission policy belongs to the cart. It may instantiate an authored member
-- later (a revealed pickup or a scrolling enemy) without cloning the definition.
function scene:spawn_member(member_id, overrides)
	local member<const> = self.definition.members_by_id[member_id]
	local options = member.options
	if overrides ~= nil then
		options = shallow_copy(options)
		for key, value in pairs(overrides) do
			options[key] = value
		end
	end
	local parent
	if member.parent_index ~= nil then
		local parent_object<const> = self._members_by_index[member.parent_index]
		if parent_object == nil then
			error('scene spatial parent is not live: ' .. member_id)
		end
		parent = parent_object.spatial
	end
	return world:_spawn_definition(member.definition, options, member.local_transform, parent, member.initial, self, member_id)
end

function scene:spawn_members(member_ids, overrides)
	local selected<const> = {}
	local members<const> = {}
	local by_id<const> = self.definition.members_by_id
	for index = 1, #member_ids do
		local member_id<const> = member_ids[index]
		local member<const> = by_id[member_id]
		if member == nil then
			error('scene member is not declared: ' .. member_id)
		end
		if selected[member.index] then
			error('scene member selected twice: ' .. member_id)
		end
		selected[member.index] = true
	end
	local construction_order<const> = self.definition.construction_order
	for index = 1, #construction_order do
		local member<const> = construction_order[index]
		if selected[member.index] then
			members[#members + 1] = member
		end
	end
	world:spawn_members(self, members, overrides)
end

function scene:spawn_all(overrides)
	world:spawn_members(self, self.definition.construction_order, overrides)
end

function scene:dispose(on_unloaded, context)
	self.closed = true
	world:unload_objects(self.objects.items, on_unloaded, context)
end

return scene
