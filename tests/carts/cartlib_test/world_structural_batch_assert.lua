local base_component<const> = require('cartlib/component/base_component')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local structural_batch<const> = require('cartlib/world/structural_batch')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')

local definition_id<const> = 'cartlib_test.world_structural_batch'
local events<const> = {}
local definition_view
local component_view

local probe_component<const> = {}
probe_component.__index = probe_component
setmetatable(probe_component, { __index = base_component })

function probe_component.new(options)
	return setmetatable(base_component.new(options), probe_component)
end

function probe_component:on_attach()
	local owner<const> = self.parent
	events[#events + 1] = 'attach:' .. owner.label
	assert(owner.initialized and registry:get(owner.id) == nil,
		'structural-batch component construction observed partial publication')
end

function probe_component:on_activate()
	local owner<const> = self.parent
	events[#events + 1] = 'component_activate:' .. owner.label
	assert(registry:get(owner.id) == nil,
		'structural-batch component activation observed partial publication')
end

local new_probe_component<const> = function(options)
	return probe_component.new(options)
end

local probe_base<const> = {}
probe_base.__index = probe_base
setmetatable(probe_base, { __index = world_object })

function probe_base.initialize(self)
	events[#events + 1] = 'initialize:' .. self.label
	assert(registry:get(self.id) == nil,
		'structural-batch initialize observed a published object')
	if self.peer ~= nil then
		assert(self.peer.peer == self and self.peer.label == self.expected_peer_label,
			'structural-batch initialize ran before every final peer input was applied')
	end
	world_object.initialize(self)
	self.initialized = true
end

local probe_class<const> = {}
probe_class.__index = probe_class

function probe_class:ctor(construction_input)
	events[#events + 1] = 'constructor:' .. self.label
	assert(self.initialized and construction_input == self.construction_input,
		'structural-batch constructor did not receive its final input')
end

function probe_class:onspawn(pos)
	events[#events + 1] = 'onspawn:' .. self.label
	assert(self.x == pos.x and self.y == pos.y and self.z == pos.z,
		'structural-batch lifecycle did not observe its final position')
	assert(registry:get(self.id) == nil,
		'structural-batch lifecycle observed its own publication')
	if self.removed_id ~= nil then
		assert(registry:get(self.removed_id) == nil,
			'replacement lifecycle began before terminal old-object removal')
	end
	if self.nested_options ~= nil then
		self.nested_object = self.world:spawn(definition_id, self.nested_options)
	end
	if self.nested_structural_plan ~= nil then
		self.world:_submit_structural_plan(
			self.nested_structural_owner,
			self.nested_structural_plan
		)
	end
end

function probe_class:bind()
	events[#events + 1] = 'bind:' .. self.label
	assert(registry:get(self.id) == nil,
		'structural-batch bind observed a published object')
end

function probe_class:ondespawn()
	events[#events + 1] = 'ondespawn:' .. self.label
	assert(registry:get(self.id) == nil,
		'old object remained registered during terminal callback')
	if self.replacement_object ~= nil then
		assert(registry:get(self.replacement_object.id) == nil,
			'replacement was admitted before the old terminal callback')
	end
	world_object.ondespawn(self)
end

prefab.define({
	def_id = definition_id,
	class = probe_class,
	base = probe_base,
	components = { new_probe_component },
})

definition_view = world:active_definition_view(definition_id)
component_view = world:active_component_view(probe_component)

local complete_plan<const> = function(owner, plan)
	events[#events + 1] = plan.completion_event
	owner.revision = plan.revision
	owner.completed_object = plan.completed_object
	assert(registry:get(plan.completed_object.id) == plan.completed_object,
		'structural plan completed before its object was admitted')
	if plan.nested_owner ~= nil then
		assert(registry:get(plan.nested_owner.nested_object.id) == plan.nested_owner.nested_object,
			'structural plan completed before lifecycle-enqueued normal admission')
	end
end

local new_plan<const> = function(revision, completion_event)
	local plan<const> = structural_batch.new_plan(complete_plan)
	plan.revision = revision
	plan.completion_event = completion_event
	return plan
end

__bmsx_host_test = {
	complete = false,
}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	local definition<const> = prefab.definition(definition_id)
	local old_options<const> = {
		label = 'old',
		pos = { x = 1, y = 2, z = 3 },
	}
	old_options.construction_input = old_options
	local old<const> = world:spawn(definition_id, old_options)
	for index = #events, 1, -1 do
		events[index] = nil
	end

	local stale<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local stale_input<const> = {
		label = 'stale',
		pos = { x = 10, y = 11, z = 12 },
	}
	stale_input.construction_input = stale_input
	local owner_a<const> = {}
	local stale_plan<const> = new_plan(1, 'complete:stale')
	stale_plan.additions[1] = {
		object = stale,
		definition = definition,
		input = stale_input,
	}
	stale_plan.completed_object = stale

	local right<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local replacement<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local followup<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local nested_options<const> = {
		label = 'nested',
		pos = { x = 70, y = 71, z = 72 },
	}
	nested_options.construction_input = nested_options
	local followup_input<const> = {
		label = 'followup',
		pos = { x = 80, y = 81, z = 82 },
	}
	followup_input.construction_input = followup_input
	local owner_c<const> = {}
	local followup_plan<const> = new_plan(1, 'complete:followup')
	followup_plan.additions[1] = {
		object = followup,
		definition = definition,
		input = followup_input,
	}
	followup_plan.completed_object = followup
	local replacement_input<const> = {
		label = 'replacement',
		peer = right,
		expected_peer_label = 'right',
		removed_id = old.id,
		nested_options = nested_options,
		nested_structural_owner = owner_c,
		nested_structural_plan = followup_plan,
		pos = { x = 20, y = 21, z = 22 },
	}
	replacement_input.construction_input = replacement_input
	local right_input<const> = {
		label = 'right',
		peer = replacement,
		expected_peer_label = 'replacement',
		pos = { x = 30, y = 31, z = 32 },
	}
	right_input.construction_input = right_input
	old.replacement_object = replacement

	local owner_b<const> = {}
	local right_plan<const> = new_plan(1, 'complete:right')
	right_plan.additions[1] = {
		object = right,
		definition = definition,
		input = right_input,
	}
	right_plan.completed_object = right

	local replacement_plan<const> = new_plan(2, 'complete:replacement')
	replacement_plan.removals[1] = old
	replacement_plan.additions[1] = {
		object = replacement,
		definition = definition,
		input = replacement_input,
	}
	replacement_plan.mutations[1] = {
		kind = structural_batch.mutation_position,
		object = replacement,
		x = 40,
		y = 41,
		z = 42,
	}
	replacement_plan.completed_object = replacement
	replacement_plan.nested_owner = replacement

	world:_open_mutation_barrier()
	world:_submit_structural_plan(owner_a, stale_plan)
	world:_submit_structural_plan(owner_b, right_plan)
	world:_submit_structural_plan(owner_a, replacement_plan)
	assert(owner_a.revision == nil and owner_b.revision == nil
		and registry:get(old.id) == old
		and registry:get(replacement.id) == nil and registry:get(right.id) == nil,
		'deferred structural submission changed the live World before its barrier')
	world:_commit_mutation_barrier()

	assert(owner_a.revision == 2 and owner_b.revision == 1 and owner_c.revision == 1,
		'coalesced structural plans did not publish the newest revisions')
	assert(stale.label == nil and registry:get(stale.id) == nil,
		'a superseded structural plan began construction or entered Registry')
	assert(old.id ~= replacement.id and registry:get(old.id) == nil,
		'replacement reused or retained the terminal old runtime identity')
	assert(replacement.x == 40 and replacement.y == 41 and replacement.z == 42,
		'retained mutation did not run after replacement admission')
	assert(definition_view.objects[1] == replacement
		and definition_view.objects[2] == right
		and definition_view.objects[3] == replacement.nested_object
		and definition_view.objects[4] == followup
		and #component_view.components == 4,
		'batch additions or lifecycle-enqueued admission lost deterministic order')
	assert(events[1] == 'ondespawn:old'
		and events[2] == 'initialize:replacement'
		and events[3] == 'initialize:right',
		'structural batch did not remove globally before applying every final input and initialize')
	assert(events[#events - 2] == 'complete:replacement'
		and events[#events - 1] == 'complete:right'
		and events[#events] == 'complete:followup',
		'plan completion did not retain first-enqueue owner order')

	replacement:mark_for_disposal()
	right:mark_for_disposal()
	followup:mark_for_disposal()
	replacement.nested_object:mark_for_disposal()
	for index = #events, 1, -1 do
		events[index] = nil
	end

	local direct<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local direct_input<const> = {
		label = 'direct',
		pos = { x = 50, y = 51, z = 52 },
	}
	direct_input.construction_input = direct_input
	local direct_owner<const> = {}
	local direct_plan<const> = new_plan(1, 'complete:direct')
	direct_plan.additions[1] = {
		object = direct,
		definition = definition,
		input = direct_input,
	}
	direct_plan.completed_object = direct
	world:_submit_structural_plan(direct_owner, direct_plan)
	assert(direct_owner.revision == 1 and registry:get(direct.id) == direct,
		'direct structural submission did not synchronously use the World barrier operation')
	direct:mark_for_disposal()

	local deferred<const> = world:_allocate_spawn_object(
		definition_id,
		definition,
		nil
	)
	local deferred_input<const> = {
		label = 'deferred',
		pos = { x = 60, y = 61, z = 62 },
	}
	deferred_input.construction_input = deferred_input
	local deferred_owner<const> = {}
	local deferred_plan<const> = new_plan(1, 'complete:deferred')
	deferred_plan.additions[1] = {
		object = deferred,
		definition = definition,
		input = deferred_input,
	}
	deferred_plan.completed_object = deferred
	world:_open_mutation_barrier()
	world:_submit_structural_plan(deferred_owner, deferred_plan)
	assert(deferred_owner.revision == nil and registry:get(deferred.id) == nil,
		'deferred structural submission bypassed the open World barrier')
	world:_commit_mutation_barrier()
	assert(deferred_owner.revision == 1 and registry:get(deferred.id) == deferred,
		'deferred structural submission did not use the same commit operation')
	deferred:mark_for_disposal()
	__bmsx_host_test.complete = true
end

function __bmsx_host_test.update()
	return __bmsx_host_test.complete
end
