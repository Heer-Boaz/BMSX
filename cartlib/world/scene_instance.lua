local structural_batch<const> = require('cartlib/world/structural_batch')

local scene_instance<const> = {}
scene_instance.__index = scene_instance

local state_active<const> = 1
local state_unloading<const> = 2
local state_unloaded<const> = 3

local complete_plan

local new_plan<const> = function(definition)
	local plan<const> = structural_batch.new_plan(complete_plan)
	plan.definition = definition
	plan.objects_by_member = {}
	plan.tombstones_by_member = {}
	return plan
end

local add_member<const> = function(self, plan, record)
	local obj<const> = self._world:_allocate_spawn_object(
		record.definition_id,
		record.prefab_definition,
		nil
	)
	obj._scene_instance = self
	obj._scene_member_id = record.member_id
	plan.objects_by_member[record.member_id] = obj
	local additions<const> = plan.additions
	additions[#additions + 1] = {
		object = obj,
		definition = record.prefab_definition,
		input = {
			space_id = record.space_id,
			pos = {
				x = record.x,
				y = record.y,
				z = record.z,
			},
		},
	}
end

local add_position_mutation<const> = function(plan, obj, record)
	local mutations<const> = plan.mutations
	mutations[#mutations + 1] = {
		kind = structural_batch.mutation_position,
		object = obj,
		x = record.x,
		y = record.y,
		z = record.z,
	}
end

local add_space_mutation<const> = function(plan, obj, space_id)
	local mutations<const> = plan.mutations
	mutations[#mutations + 1] = {
		kind = structural_batch.mutation_space,
		object = obj,
		space_id = space_id,
	}
end

local build_reconcile_plan<const> = function(self, definition)
	local plan<const> = new_plan(definition)
	local previous<const> = self._definition
	if previous == nil then
		local records<const> = definition.objects
		for index = 1, #records do
			add_member(self, plan, records[index])
		end
		return plan
	end

	local previous_members<const> = previous.members_by_id
	local previous_objects<const> = self._objects_by_member
	local previous_tombstones<const> = self._tombstones_by_member
	local records<const> = definition.objects
	for index = 1, #records do
		local record<const> = records[index]
		local member_id<const> = record.member_id
		local previous_record<const> = previous_members[member_id]
		if previous_record == nil then
			add_member(self, plan, record)
		elseif previous_tombstones[member_id] then
			plan.tombstones_by_member[member_id] = true
		elseif previous_record.definition_id ~= record.definition_id then
			local previous_object<const> = previous_objects[member_id]
			local removals<const> = plan.removals
			removals[#removals + 1] = previous_object
			add_member(self, plan, record)
		else
			local obj<const> = previous_objects[member_id]
			plan.objects_by_member[member_id] = obj
			if previous_record.space_id ~= record.space_id and obj.space_id ~= record.space_id then
				add_space_mutation(plan, obj, record.space_id)
			end
			if (previous_record.x ~= record.x
				or previous_record.y ~= record.y
				or previous_record.z ~= record.z)
				and (obj.x ~= record.x or obj.y ~= record.y or obj.z ~= record.z) then
				add_position_mutation(plan, obj, record)
			end
		end
	end

	local next_members<const> = definition.members_by_id
	local previous_records<const> = previous.objects
	for index = 1, #previous_records do
		local member_id<const> = previous_records[index].member_id
		if next_members[member_id] == nil and not previous_tombstones[member_id] then
			local removals<const> = plan.removals
			removals[#removals + 1] = previous_objects[member_id]
		end
	end
	return plan
end

local build_reload_plan<const> = function(self, definition)
	local plan<const> = new_plan(definition)
	local previous<const> = self._definition
	if previous ~= nil then
		local previous_records<const> = previous.objects
		local previous_objects<const> = self._objects_by_member
		local previous_tombstones<const> = self._tombstones_by_member
		for index = 1, #previous_records do
			local member_id<const> = previous_records[index].member_id
			if not previous_tombstones[member_id] then
				local removals<const> = plan.removals
				removals[#removals + 1] = previous_objects[member_id]
			end
		end
	end
	local records<const> = definition.objects
	for index = 1, #records do
		add_member(self, plan, records[index])
	end
	return plan
end

local submit_plan<const> = function(self, plan)
	self._pending_plan = plan
	self._world:_submit_structural_plan(self, plan)
end

complete_plan = function(self, plan)
	if self._state == state_unloaded then
		return
	end
	if plan.unload then
		self._world:_remove_scene_instance(self)
		self._definition = nil
		self._objects_by_member = plan.objects_by_member
		self._tombstones_by_member = plan.tombstones_by_member
		self._pending_plan = nil
		self._state = state_unloaded
		return
	end
	self._definition = plan.definition
	self._objects_by_member = plan.objects_by_member
	self._tombstones_by_member = plan.tombstones_by_member
	if self._pending_plan == plan then
		self._pending_plan = nil
	end
end

function scene_instance.new(world, scene_id)
	return setmetatable({
		id = scene_id,
		_world = world,
		_definition = nil,
		_pending_plan = nil,
		_objects_by_member = {},
		_tombstones_by_member = {},
		_state = state_active,
	}, scene_instance)
end

function scene_instance:_load(definition)
	submit_plan(self, build_reconcile_plan(self, definition))
end

function scene_instance:_apply_definition(definition)
	if self._state ~= state_active then
		return
	end
	submit_plan(self, build_reconcile_plan(self, definition))
end

function scene_instance:_reload(definition)
	self._state = state_active
	submit_plan(self, build_reload_plan(self, definition))
end

function scene_instance:_unload()
	self._state = state_unloading
	local plan<const> = new_plan(nil)
	plan.unload = true
	local definition<const> = self._definition
	if definition ~= nil then
		local records<const> = definition.objects
		local objects<const> = self._objects_by_member
		local tombstones<const> = self._tombstones_by_member
		for index = 1, #records do
			local member_id<const> = records[index].member_id
			if not tombstones[member_id] then
				local removals<const> = plan.removals
				removals[#removals + 1] = objects[member_id]
			end
		end
	end
	submit_plan(self, plan)
end

function scene_instance:_begin_world_clear()
	self._state = state_unloading
end

function scene_instance:_world_cleared()
	self._definition = nil
	self._pending_plan = nil
	self._objects_by_member = {}
	self._tombstones_by_member = {}
	self._state = state_unloaded
	self._world_scene_index = nil
end

function scene_instance:_object_disposed(obj)
	local member_id<const> = obj._scene_member_id
	if self._objects_by_member[member_id] == obj then
		self._objects_by_member[member_id] = nil
		if self._state == state_active then
			self._tombstones_by_member[member_id] = true
		end
	end
	local pending<const> = self._pending_plan
	if pending ~= nil and pending.objects_by_member[member_id] == obj then
		pending.objects_by_member[member_id] = nil
		if self._state == state_active then
			pending.tombstones_by_member[member_id] = true
		end
	end
	obj._scene_instance = nil
	obj._scene_member_id = nil
end

function scene_instance:object(member_id)
	return self._objects_by_member[member_id]
end

function scene_instance:tombstoned(member_id)
	return self._tombstones_by_member[member_id]
end

function scene_instance:position(member_id)
	local obj<const> = self._objects_by_member[member_id]
	return obj.x, obj.y, obj.z
end

function scene_instance:set_position(member_id, x, y, z)
	self._objects_by_member[member_id]:set_pos(x, y, z)
end

function scene_instance:revisions()
	local applied_revision = nil
	local pending_revision = nil
	if self._definition ~= nil then
		applied_revision = self._definition.revision
	end
	if self._pending_plan ~= nil and self._pending_plan.definition ~= nil then
		pending_revision = self._pending_plan.definition.revision
	end
	return applied_revision, pending_revision
end

return scene_instance
