local world_object<const> = require('cartlib/world/world_object')

local structural_batch<const> = {}
structural_batch.__index = structural_batch

structural_batch.mutation_position = 1
structural_batch.mutation_space = 2

local apply_position_mutation<const> = function(mutation)
	world_object.set_pos(mutation.object, mutation.x, mutation.y, mutation.z)
end

local apply_space_mutation<const> = function(mutation)
	world_object.set_space(mutation.object, mutation.space_id)
end

local mutation_handlers<const> = {
	apply_position_mutation,
	apply_space_mutation,
}

function structural_batch.new_plan(complete)
	return {
		removals = {},
		additions = {},
		mutations = {},
		complete = complete,
	}
end

-- Structural plans are retained in two buffers. Flush switches buffers before
-- invoking lifecycle code, so mutations produced by that lifecycle enter the
-- next ordered batch instead of rewriting the plan being committed.
local new_plan_buffer<const> = function()
	return {
		owners = {},
		plans = {},
		indices_by_owner = {},
		count = 0,
	}
end

function structural_batch.new(world)
	return setmetatable({
		_world = world,
		_pending = new_plan_buffer(),
		_standby = new_plan_buffer(),
		_completion_owners = {},
		_completion_plans = {},
		_completion_count = 0,
	}, structural_batch)
end

-- The first submission fixes an owner's place in the batch. A newer plan for
-- that owner replaces only the retained plan reference.
function structural_batch:enqueue(owner, plan)
	local pending<const> = self._pending
	local index<const> = pending.indices_by_owner[owner]
	if index ~= nil then
		pending.plans[index] = plan
		return
	end
	local count<const> = pending.count + 1
	pending.count = count
	pending.owners[count] = owner
	pending.plans[count] = plan
	pending.indices_by_owner[owner] = count
end

-- All plans share the same World phases: global removals, all final inputs,
-- initialization, construction, lifecycle, publication and retained mutation.
-- No plan callback can interpose another structural representation.
function structural_batch:flush()
	local world<const> = self._world
	local pending<const> = self._pending
	self._pending = self._standby
	self._standby = pending

	local plans<const> = pending.plans
	local plan_count<const> = pending.count
	for plan_index = 1, plan_count do
		local removals<const> = plans[plan_index].removals
		for removal_index = 1, #removals do
			world:mark_for_disposal(removals[removal_index])
		end
	end
	world:_commit_pending_disposals()

	for plan_index = 1, plan_count do
		local additions<const> = plans[plan_index].additions
		for addition_index = 1, #additions do
			local addition<const> = additions[addition_index]
			world:_apply_spawn_input(addition.object, addition.input)
		end
	end
	for plan_index = 1, plan_count do
		local additions<const> = plans[plan_index].additions
		for addition_index = 1, #additions do
			local addition<const> = additions[addition_index]
			world:_initialize_spawn_object(addition.object, addition.definition)
		end
	end
	for plan_index = 1, plan_count do
		local additions<const> = plans[plan_index].additions
		for addition_index = 1, #additions do
			local addition<const> = additions[addition_index]
			world:_construct_spawn_object(
				addition.object,
				addition.definition,
				addition.input
			)
		end
	end
	for plan_index = 1, plan_count do
		local additions<const> = plans[plan_index].additions
		for addition_index = 1, #additions do
			local addition<const> = additions[addition_index]
			world:_start_spawn_lifecycle(addition.object, addition.input.pos)
		end
	end
	for plan_index = 1, plan_count do
		local additions<const> = plans[plan_index].additions
		for addition_index = 1, #additions do
			local obj<const> = additions[addition_index].object
			if obj.marked_for_disposal then
				world:_commit_disposal(obj)
			else
				world:_commit_spawn(obj)
			end
		end
	end
	for plan_index = 1, plan_count do
		local mutations<const> = plans[plan_index].mutations
		for mutation_index = 1, #mutations do
			local mutation<const> = mutations[mutation_index]
			mutation_handlers[mutation.kind](mutation)
		end
	end

	local completion_owners<const> = self._completion_owners
	local completion_plans<const> = self._completion_plans
	local completion_count = self._completion_count
	local owners<const> = pending.owners
	local indices_by_owner<const> = pending.indices_by_owner
	for plan_index = 1, plan_count do
		completion_count = completion_count + 1
		local owner<const> = owners[plan_index]
		completion_owners[completion_count] = owner
		completion_plans[completion_count] = plans[plan_index]
		indices_by_owner[owner] = nil
		owners[plan_index] = nil
		plans[plan_index] = nil
	end
	self._completion_count = completion_count
	world._structural_batch_completion_pending = true
	pending.count = 0
end

function structural_batch:complete()
	self._world._structural_batch_completion_pending = false
	local owners<const> = self._completion_owners
	local plans<const> = self._completion_plans
	local count<const> = self._completion_count
	for index = 1, count do
		local owner<const> = owners[index]
		local plan<const> = plans[index]
		owners[index] = nil
		plans[index] = nil
		plan.complete(owner, plan)
	end
	self._completion_count = 0
end

return structural_batch
