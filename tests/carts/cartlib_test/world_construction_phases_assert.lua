local base_component<const> = require('cartlib/component/base_component')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')

local definition_id<const> = 'cartlib_test.world_construction_phases'
local default_x<const> = 7
local default_y<const> = 8
local default_z<const> = 9

local probe_component<const> = {}
probe_component.__index = probe_component
setmetatable(probe_component, { __index = base_component })

function probe_component.new(options)
	local self<const> = setmetatable(base_component.new(options), probe_component)
	self.id_local = 'probe'
	return self
end

function probe_component:on_attach()
	local owner<const> = self.parent
	local phases<const> = owner.phases
	phases[#phases + 1] = 'component_attach'
	assert(owner.initialized and registry:get(owner.id) == nil,
		'component construction observed an uninitialized or published owner')
end

function probe_component:on_activate()
	local owner<const> = self.parent
	local phases<const> = owner.phases
	phases[#phases + 1] = 'component_activate'
	assert(owner.active and registry:get(owner.id) == nil,
		'component activation did not precede object publication')
end

function probe_component:on_detach()
	local phases<const> = self.parent.phases
	phases[#phases + 1] = 'component_detach'
end

function probe_component:unbind()
	local phases<const> = self.parent.phases
	phases[#phases + 1] = 'component_unbind'
	base_component.unbind(self)
end

local new_probe_component<const> = function(options)
	return probe_component.new(options)
end

local definition_view
local component_view

local probe_base<const> = {}
probe_base.__index = probe_base
setmetatable(probe_base, { __index = world_object })

function probe_base.initialize(self)
	local phases<const> = self.phases
	phases[#phases + 1] = 'initialize'
	assert(self.default_value == 'prefab default'
		and self.override_value == self.expected_override
		and self.x == default_x and self.y == default_y and self.z == default_z,
		'prefab defaults or final construction input were not visible before initialize')
	assert(self.definition_id == definition_id and self.id == self.expected_runtime_id,
		'World identity was not final before initialize')
	if self.peer ~= nil then
		assert(self.peer.override_value == self.expected_peer_override,
			'initialize ran before every peer received its final construction input')
	end
	assert(registry:get(self.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'initialize observed a partially published object')
	world_object.initialize(self)
	self.initialized = true
end

local probe_class<const> = {}
probe_class.__index = probe_class

function probe_class:ctor(construction_input, actual_definition_id)
	local phases<const> = self.phases
	phases[#phases + 1] = 'constructor'
	assert(self.initialized and self:get_component(probe_component) ~= nil,
		'constructor ran before initialization or component construction')
	assert(construction_input == self.expected_construction_input
		and actual_definition_id == definition_id,
		'constructor did not receive the original construction input')
	assert(self.peer == construction_input.peer and registry:get(self.id) == nil,
		'constructor did not receive its resolved peer before publication')
end

function probe_class:onspawn(pos)
	local phases<const> = self.phases
	phases[#phases + 1] = 'onspawn'
	assert(self.x == pos.x and self.y == pos.y and self.z == pos.z,
		'onspawn did not observe the final position')
	assert(registry:get(self.id) == nil,
		'onspawn observed a published object')
	if self.child_options ~= nil then
		self.child = self.world:spawn(definition_id, self.child_options)
	end
	if self.cancel_on_spawn then
		self:mark_for_disposal()
	end
end

function probe_class:bind()
	local phases<const> = self.phases
	phases[#phases + 1] = 'bind'
	assert(registry:get(self.id) == nil,
		'bind observed a published object')
end

function probe_class:ondespawn()
	local phases<const> = self.phases
	phases[#phases + 1] = 'ondespawn'
	world_object.ondespawn(self)
end

function probe_class:unbind()
	local phases<const> = self.phases
	phases[#phases + 1] = 'unbind'
	world_object.unbind(self)
end

prefab.define({
	def_id = definition_id,
	class = probe_class,
	base = probe_base,
	components = { new_probe_component },
	defaults = {
		default_value = 'prefab default',
		override_value = 'default override value',
		x = default_x,
		y = default_y,
		z = default_z,
	},
})

definition_view = world:active_definition_view(definition_id)
component_view = world:active_component_view(probe_component)

__bmsx_host_test = {
	complete = false,
}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	local single_phases<const> = {}
	local single_options<const> = {
		id = 'cartlib_test.single_spawn',
		definition_id = 'ignored.definition',
		phases = single_phases,
		expected_override = 'single override',
		override_value = 'single override',
		expected_runtime_id = 'cartlib_test.single_spawn',
		pos = { x = 41, y = 42, z = 43 },
	}
	single_options.expected_construction_input = single_options
	local single<const> = world:spawn(definition_id, single_options)
	assert(single.definition_id == definition_id and single.id == single_options.id,
		'single spawn did not preserve World-owned definition and requested identity')
	assert(single_phases[1] == 'initialize'
		and single_phases[2] == 'component_attach'
		and single_phases[3] == 'constructor'
		and single_phases[4] == 'onspawn'
		and single_phases[5] == 'bind'
		and single_phases[6] == 'component_activate'
		and #single_phases == 6,
		'single spawn lifecycle order changed')
	local single_component<const> = single:get_component(probe_component)
	assert(registry:get(single.id) == single
		and registry:get(single_component.id) == single_component
		and definition_view.objects[1] == single
		and component_view.components[1] == single_component,
		'single spawn did not publish object, component and retained views together')
	single:mark_for_disposal()
	assert(registry:get(single.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'single spawn disposal did not retire every published identity')

	local child_phases<const> = {}
	local child_options<const> = {
		id = 'cartlib_test.deferred_child',
		phases = child_phases,
		expected_override = 'child override',
		override_value = 'child override',
		expected_runtime_id = 'cartlib_test.deferred_child',
		pos = { x = 21, y = 22, z = 23 },
	}
	child_options.expected_construction_input = child_options
	local parent_phases<const> = {}
	local parent_options<const> = {
		id = 'cartlib_test.deferred_parent',
		phases = parent_phases,
		expected_override = 'parent override',
		override_value = 'parent override',
		expected_runtime_id = 'cartlib_test.deferred_parent',
		child_options = child_options,
		pos = { x = 11, y = 12, z = 13 },
	}
	parent_options.expected_construction_input = parent_options
	world:_open_mutation_barrier()
	local parent<const> = world:spawn(definition_id, parent_options)
	assert(parent.child ~= nil
		and registry:get(parent.id) == nil and registry:get(parent.child.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'deferred nested spawn leaked partial Registry or retained-view membership')
	world:_commit_mutation_barrier()
	assert(definition_view.objects[1] == parent
		and definition_view.objects[2] == parent.child,
		'deferred nested admission did not preserve enqueue order')
	parent:mark_for_disposal()
	parent.child:mark_for_disposal()

	local canceled_phases<const> = {}
	local canceled_options<const> = {
		id = 'cartlib_test.canceled_spawn',
		phases = canceled_phases,
		expected_override = 'canceled override',
		override_value = 'canceled override',
		expected_runtime_id = 'cartlib_test.canceled_spawn',
		cancel_on_spawn = true,
		pos = { x = 31, y = 32, z = 33 },
	}
	canceled_options.expected_construction_input = canceled_options
	world:_open_mutation_barrier()
	local canceled<const> = world:spawn(definition_id, canceled_options)
	world:_commit_mutation_barrier()
	assert(registry:get(canceled.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'a canceled deferred spawn entered Registry, Space or component views')
	assert(canceled_phases[1] == 'initialize'
		and canceled_phases[2] == 'component_attach'
		and canceled_phases[3] == 'constructor'
		and canceled_phases[4] == 'onspawn'
		and canceled_phases[5] == 'ondespawn'
		and canceled_phases[6] == 'component_detach'
		and canceled_phases[7] == 'component_unbind'
		and canceled_phases[8] == 'unbind'
		and #canceled_phases == 8,
		'canceled deferred spawn did not preserve terminal lifecycle order')

	world:_open_mutation_barrier()
	local left<const>, left_definition<const> = world:_allocate_spawn_object(definition_id, nil)
	local right<const>, right_definition<const> = world:_allocate_spawn_object(definition_id, nil)
	local ordered_members<const> = {
		{ member_id = 'left', object = left },
		{ member_id = 'right', object = right },
	}
	local members_by_id<const> = {
		left = left,
		right = right,
	}
	assert(right.id == left.id + 1
		and ordered_members[1].member_id ~= left.id
		and ordered_members[2].member_id ~= right.id,
		'multi-object allocation did not establish separate ordered runtime identities')
	assert(registry:get(left.id) == nil and registry:get(right.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'multi-object identity allocation published an object shell')

	local left_phases<const> = {}
	local left_input<const> = {
		phases = left_phases,
		expected_override = 'left override',
		override_value = 'left override',
		expected_runtime_id = left.id,
		peer = members_by_id.right,
		expected_peer_override = 'right override',
		member_id = ordered_members[1].member_id,
		pos = { x = 51, y = 52, z = 53 },
	}
	left_input.expected_construction_input = left_input
	local right_phases<const> = {}
	local right_input<const> = {
		phases = right_phases,
		expected_override = 'right override',
		override_value = 'right override',
		expected_runtime_id = right.id,
		peer = members_by_id.left,
		expected_peer_override = 'left override',
		member_id = ordered_members[2].member_id,
		pos = { x = 61, y = 62, z = 63 },
	}
	right_input.expected_construction_input = right_input
	world:_apply_spawn_input(left, left_input)
	world:_apply_spawn_input(right, right_input)
	world:_initialize_spawn_object(left, left_definition)
	world:_initialize_spawn_object(right, right_definition)
	world:_construct_spawn_object(left, left_definition, left_input)
	world:_construct_spawn_object(right, right_definition, right_input)
	world:_queue_spawn_admission(left)
	world:_queue_spawn_admission(right)
	world:_start_spawn_lifecycle(left, left_input.pos)
	world:_start_spawn_lifecycle(right, right_input.pos)
	assert(left.peer == right and right.peer == left
		and registry:get(left.id) == nil and registry:get(right.id) == nil
		and #definition_view.objects == 0 and #component_view.components == 0,
		'multi-object construction did not retain resolved peers before atomic publication')
	world:_commit_mutation_barrier()
	assert(registry:get(left.id) == left and registry:get(right.id) == right
		and definition_view.objects[1] == left and definition_view.objects[2] == right
		and #component_view.components == 2,
		'multi-object admission did not publish the fully constructed authored order')
	left:mark_for_disposal()
	right:mark_for_disposal()
	__bmsx_host_test.complete = true
end

function __bmsx_host_test.update()
	return __bmsx_host_test.complete
end
