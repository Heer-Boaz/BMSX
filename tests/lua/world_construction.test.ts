import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';

// Real World, Scene, Registry, components and GPU dependencies, not a host-made
// lifecycle model. These tests exercise guest construction, not rendering.
for (const optLevel of [0, 3] as const) {
	test(`World prepares batch identities and poses before constructors, then publishes, wires and activates (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local order<const> = {}
local base<const> = setmetatable({}, { __index = world_object })
local actor<const> = {}
local component<const> = setmetatable({}, { __index = base_component })
component.__index = component
local attached = 0
local constructed = 0
local spawned = 0
local bound = 0
local component_bound = 0
local activated = 0
local received = 0
local view<const> = world:active_definition_view('batch.actor')
function base.initialize(self)
	local peer<const> = self.scene.members[self.peer_id]
	assert(self.world == world and self.events ~= nil and not self.active,
		'custom initializer ran before World basic setup')
	assert(peer ~= nil and peer.world == world and peer.events ~= nil and peer._components ~= nil,
		'custom initializer ran before every batch shell was prepared')
	assert(self.spatial.wox == self.expected_x and self.spatial.woy == self.expected_y and self.spatial.woz == self.expected_z,
		'custom initializer did not see the requested construction pose')
	assert(peer.spatial.wox == peer.expected_x and peer.spatial.woy == peer.expected_y and peer.spatial.woz == peer.expected_z,
		'peer construction pose was not prepared with its shell')
	assert(registry:get(self.id) == nil and registry:get(peer.id) == nil,
		'constructor observed partially published identities')
	order[#order + 1] = 'initialize:' .. self.scene_member_id
end
function component:on_attach()
	local owner<const> = self.owner
	assert(owner == owner.scene.members[owner.scene_member_id], 'component received a replacement owner shell')
	assert(owner.spatial.wox == owner.expected_x and owner.spatial.woy == owner.expected_y and owner.spatial.woz == owner.expected_z,
		'component attachment ran before the construction pose')
	attached = attached + 1
	owner.part = self
	order[#order + 1] = 'component:' .. owner.scene_member_id
end
function actor:ctor(options, definition_id)
	assert(self.part.owner == self and self.spatial.wox == self.expected_x and self.spatial.woy == self.expected_y
		and self.spatial.woz == self.expected_z, 'constructor did not receive final identity and pose')
	assert(definition_id == 'batch.actor' and options.expected_x == self.expected_x,
		'constructor arguments changed')
	constructed = constructed + 1
	order[#order + 1] = 'ctor:' .. self.scene_member_id
end
function actor:onspawn()
	local peer<const> = self.scene.members[self.peer_id]
	assert(constructed == 2 and attached == 2, 'onspawn ran before every batch constructor')
	assert(registry:get(self.id) == self and registry:get(peer.id) == peer
		and registry:get(self.part.id) == self.part and registry:get(peer.part.id) == peer.part,
		'onspawn ran before every object and component identity was published')
	assert(not self.active and not peer.active and #view.objects == 0,
		'published batch entered active scheduling before ready callbacks')
	assert(bound == 0 and activated == 0, 'onspawn ran after binding or activation began')
	assert(self.x == nil and self.y == nil and self.z == nil and self.sx == nil,
		'World retained a mirrored object position or invented geometry dimensions')
	spawned = spawned + 1
	order[#order + 1] = 'spawn:' .. self.scene_member_id
end
function actor:bind()
	assert(spawned == 2 and activated == 0, 'binding ran before every onspawn or after activation')
	local peer<const> = self.scene.members[self.peer_id]
	self.events:on({ event = 'activated', emitter = peer.id, handler = self.on_peer_activated })
	bound = bound + 1
	order[#order + 1] = 'bind:' .. self.scene_member_id
end
function actor:on_peer_activated()
	received = received + 1
end
function component:on_bind()
	assert(spawned == 2 and activated == 0, 'component bound outside the batch wiring phase')
	component_bound = component_bound + 1
	order[#order + 1] = 'component-bind:' .. self.owner.scene_member_id
end
function component:on_activate()
	assert(bound == 2 and component_bound == 2, 'component activated before every peer bound its subscriptions')
	activated = activated + 1
	self.owner.events:emit('activated')
	order[#order + 1] = 'activate:' .. self.owner.scene_member_id
end
prefab.define({ def_id = 'batch.actor', class = actor, base = base,
	spatial = { family = '3d', authority = 'affine', local_transform = { 1,0,0, 0,1,0, 0,0,1, -1,-2,-3 } },
	components = { function(options) return setmetatable(base_component.new(options), component) end } })
scenes.register('batch', { objects = {
	{ member_id = 'left', definition_id = 'batch.actor',
		spatial = { local_transform = { 1,0,0, 0,1,0, 0,0,1, 11,12,13 } },
		options = { peer_id = 'right', expected_x = 11, expected_y = 12, expected_z = 13 } },
	{ member_id = 'right', definition_id = 'batch.actor',
		spatial = { local_transform = { 1,0,0, 0,1,0, 0,0,1, 21,22,23 } },
		options = { peer_id = 'left', expected_x = 21, expected_y = 22, expected_z = 23 } },
} })
local scene<const> = scenes.instantiate('batch')
assert(order[1] == 'initialize:left' and order[2] == 'component:left' and order[3] == 'ctor:left'
	and order[4] == 'initialize:right' and order[5] == 'component:right' and order[6] == 'ctor:right'
	and order[7] == 'spawn:left' and order[8] == 'spawn:right'
	and order[9] == 'bind:left' and order[10] == 'component-bind:left'
	and order[11] == 'bind:right' and order[12] == 'component-bind:right'
	and order[13] == 'activate:left' and order[14] == 'activate:right', 'batch lifecycle order changed')
assert(received == 2 and #view.objects == 2, 'activation events missed an unbound peer or scheduling admission')
assert(scene.members.left.part.owner == scene.members.left and scene.members.right.part.owner == scene.members.right,
	'World replaced a constructed identity')
scene:dispose()
local single_base<const> = setmetatable({ initialize = function(self)
	assert(self.spatial.wox == 0 and self.spatial.woy == 0 and self.spatial.woz == 0 and self.events ~= nil and self.world == world,
		'procedural initializer ran before basic setup and the requested zero pose')
	self.initial_events = self.events
end }, { __index = world_object })
prefab.define({ def_id = 'single.actor', base = single_base,
	spatial = { family = '3d', authority = 'affine', local_transform = { 1,0,0, 0,1,0, 0,0,1, 11,12,13 } },
	class = { ctor = function(self)
		assert(self.spatial.wox == 0 and self.spatial.woy == 0 and self.spatial.woz == 0 and self.events == self.initial_events,
			'procedural constructor used a different initialization or position path')
	end, onspawn = function(self)
		assert(registry:get(self.id) == self and not self.active,
			'procedural ready callback ran before publication or after activation')
	end },
	components = { function(options)
		assert(options.owner.spatial.wox == 0 and options.owner.spatial.woy == 0 and options.owner.spatial.woz == 0,
			'procedural component factory ran before its requested position')
		return base_component.new(options)
	end } })
local single<const> = world:spawn('single.actor', {}, { local_transform = { 1,0,0, 0,1,0, 0,0,1, 0,0,0 } })
assert(single.active and single._bound, 'procedural spawn did not finish the common lifecycle')
single:mark_for_disposal()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World terminal requests stop later construction and lifecycle callbacks (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local initialized = 0
local constructed = 0
local spawned = 0
local bound = 0
local activated = 0
local despawned = 0
local unbound = 0
local detached = 0
local base<const> = setmetatable({}, { __index = world_object })
local actor<const> = {}
local component<const> = setmetatable({}, { __index = base_component })
component.__index = component
function base.initialize(self)
	initialized = initialized + 1
	if self.cancel_at == 'initialize' then self:mark_for_disposal() end
end
function actor:ctor()
	constructed = constructed + 1
	if self.cancel_at == 'ctor' then self:mark_for_disposal() end
end
function actor:onspawn()
	spawned = spawned + 1
	if self.cancel_at == 'spawn' then self:mark_for_disposal() end
	if self.cancel_at == 'close_scene' then self.scene:dispose() end
end
function actor:bind()
	bound = bound + 1
	if self.cancel_at == 'bind' then self:mark_for_disposal() end
end
function actor:ondespawn()
	despawned = despawned + 1
end
function actor:unbind()
	unbound = unbound + 1
end
function component:on_attach()
	if self.owner.cancel_at == 'component' then self.owner:mark_for_disposal() end
end
function component:on_activate()
	activated = activated + 1
	if self.owner.cancel_at == 'activate' then self.owner:mark_for_disposal() end
end
function component:on_detach()
	detached = detached + 1
end
local factory<const> = function(options) return setmetatable(base_component.new(options), component) end
prefab.define({ def_id = 'cancel.actor', class = actor, base = base, components = { factory, factory } })
local during_initialize<const> = world:spawn('cancel.actor', { cancel_at = 'initialize' })
assert(initialized == 1 and constructed == 0 and spawned == 0 and bound == 0 and activated == 0
	and despawned == 0 and unbound == 0 and detached == 0 and during_initialize.world == nil,
	'initializer cancellation ran later construction or despawn callbacks')
local during_component<const> = world:spawn('cancel.actor', { cancel_at = 'component' })
assert(constructed == 0 and spawned == 0 and despawned == 0 and unbound == 0 and detached == 1 and during_component.world == nil,
	'component cancellation continued construction or despawned an unconstructed shell')
local during_ctor<const> = world:spawn('cancel.actor', { cancel_at = 'ctor' })
assert(constructed == 1 and spawned == 0 and bound == 0 and unbound == 0 and despawned == 1 and during_ctor.world == nil,
	'constructor cancellation did not run exactly the constructed teardown')
local during_spawn<const> = world:spawn('cancel.actor', { cancel_at = 'spawn' })
assert(spawned == 1 and bound == 0 and unbound == 0 and activated == 0 and despawned == 2 and during_spawn.world == nil,
	'onspawn cancellation continued binding or activation')
local during_bind<const> = world:spawn('cancel.actor', { cancel_at = 'bind' })
assert(spawned == 2 and bound == 1 and unbound == 1 and activated == 0 and despawned == 3 and during_bind.world == nil,
	'bind cancellation continued component activation')
local during_activate<const> = world:spawn('cancel.actor', { cancel_at = 'activate' })
assert(activated == 1 and bound == 2 and unbound == 2 and despawned == 4 and during_activate.world == nil,
	'component activation cancellation ran another component callback')
local prior_spawns<const> = spawned
local prior_binds<const> = bound
local prior_activations<const> = activated
scenes.register('closing', { objects = {
	{ member_id = 'left', definition_id = 'cancel.actor', options = { cancel_at = 'close_scene' } },
	{ member_id = 'right', definition_id = 'cancel.actor', options = {} },
} })
local closing<const> = scenes.instantiate('closing')
assert(closing.closed and next(closing.members) == nil and #closing.objects.items == 0,
	'onspawn Scene closure retained pending or live members')
assert(spawned == prior_spawns + 1 and bound == prior_binds and activated == prior_activations
	and despawned == 6 and unbound == 2,
	'Scene closure ran later callbacks or custom unbind without a matching bind')
local factory_attached = 0
local factory_detached = 0
local factory_ctor = 0
local factory_despawn = 0
local factory_component<const> = setmetatable({
	on_attach = function() factory_attached = factory_attached + 1 end,
	on_detach = function() factory_detached = factory_detached + 1 end,
}, { __index = base_component })
factory_component.__index = factory_component
prefab.define({ def_id = 'closing.factory', class = {
	ctor = function() factory_ctor = factory_ctor + 1 end,
	ondespawn = function() factory_despawn = factory_despawn + 1 end,
}, components = { function(options)
	options.owner.scene:dispose()
	return setmetatable(base_component.new(options), factory_component)
end } })
scenes.register('factory_closing', { objects = {
	{ member_id = 'first', definition_id = 'closing.factory', options = {} },
	{ member_id = 'second', definition_id = 'closing.factory', options = {} },
} })
local factory_closing<const> = scenes.instantiate('factory_closing')
assert(factory_closing.closed and next(factory_closing.members) == nil and #factory_closing.objects.items == 0
	and factory_ctor == 0 and factory_despawn == 0, 'factory closure constructed or despawned a canceled shell')
assert(factory_attached == 0 and factory_detached == 0,
	'returned component after factory closure received late attachment or unpaired detachment')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World drains reentrant spawns after the current ready batch and cancels pending Scenes (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local order<const> = {}
local actor<const> = {}
local component<const> = setmetatable({}, { __index = base_component })
component.__index = component
function actor:ctor()
	order[#order + 1] = 'ctor:' .. self.role
end
function actor:onspawn()
	order[#order + 1] = 'spawn:' .. self.role
	if self.role == 'left' then
		self.child = self.scene:spawn('reentrant.actor', { role = 'child' })
		assert(self.child.world == world and registry:get(self.child.id) == nil and not self.child.active,
			'reentrant spawn published or activated in the middle of its parent ready batch')
	end
end
function actor:bind()
	order[#order + 1] = 'bind:' .. self.role
end
function component:on_activate()
	order[#order + 1] = 'activate:' .. self.owner.role
end
prefab.define({ def_id = 'reentrant.actor', class = actor,
	components = { function(options) return setmetatable(base_component.new(options), component) end } })
scenes.register('reentrant', { objects = {
	{ member_id = 'left', definition_id = 'reentrant.actor', options = { role = 'left' } },
	{ member_id = 'right', definition_id = 'reentrant.actor', options = { role = 'right' } },
} })
local scene<const> = scenes.instantiate('reentrant')
assert(order[1] == 'ctor:left' and order[2] == 'ctor:right'
	and order[3] == 'spawn:left' and order[4] == 'ctor:child' and order[5] == 'spawn:right'
	and order[6] == 'bind:left' and order[7] == 'bind:right'
	and order[8] == 'activate:left' and order[9] == 'activate:right'
	and order[10] == 'spawn:child' and order[11] == 'bind:child' and order[12] == 'activate:child',
	'reentrant spawn recursively interrupted the current ready batch')
assert(scene.members.left.child.active and registry:get(scene.members.left.child.id) == scene.members.left.child,
	'reentrant admission was not drained before spawn returned')
scene:dispose()
local callbacks = 0
local despawned = 0
prefab.define({ def_id = 'pending.actor', class = {
	onspawn = function() callbacks = callbacks + 1 end,
	bind = function() callbacks = callbacks + 1 end,
	ondespawn = function() despawned = despawned + 1 end,
} })
scenes.register('pending', { objects = {
	{ member_id = 'first', definition_id = 'pending.actor', options = {} },
	{ member_id = 'second', definition_id = 'pending.actor', options = {} },
} })
world:_open_mutation_barrier()
local pending<const> = scenes.instantiate('pending')
local first<const> = pending.members.first
local second<const> = pending.members.second
assert(callbacks == 0 and registry:get(first.id) == nil and registry:get(second.id) == nil,
	'pending batch escaped its structural barrier')
local completion = false
pending:dispose(function()
	assert(first.world == nil and second.world == nil and registry:get(first.id) == nil and registry:get(second.id) == nil,
		'Scene unload completion preceded pending cancellation')
	completion = true
end)
assert(not completion, 'pending Scene unload completed inside the caller system group')
world:_commit_mutation_barrier()
assert(completion and callbacks == 0 and despawned == 2 and next(pending.members) == nil,
	'pending Scene closure ran ready callbacks or failed constructed teardown')
local retirement_callback_active = false
local retirement_ready = 0
local disposal_child
local unload_child
prefab.define({ def_id = 'retirement.child', class = { onspawn = function()
	assert(not retirement_callback_active, 'callback-requested child published in a half-completed retirement')
	retirement_ready = retirement_ready + 1
end } })
prefab.define({ def_id = 'retirement.parent', class = { ondespawn = function()
	retirement_callback_active = true
	disposal_child = world:spawn('retirement.child', {})
	assert(registry:get(disposal_child.id) == nil and not disposal_child.active and retirement_ready == 0,
		'ondespawn recursively admitted its requested spawn')
	retirement_callback_active = false
end } })
local retiring<const> = world:spawn('retirement.parent', {})
retiring:mark_for_disposal()
assert(retiring.world == nil and disposal_child.active and registry:get(disposal_child.id) == disposal_child
	and retirement_ready == 1, 'disposal failed to drain a callback-requested admission')
scenes.register('unloading', { objects = {} })
local unloading<const> = scenes.create('unloading')
unloading:dispose(function()
	retirement_callback_active = true
	unload_child = world:spawn('retirement.child', {})
	assert(registry:get(unload_child.id) == nil and not unload_child.active and retirement_ready == 1,
		'unload completion recursively admitted its requested spawn')
	retirement_callback_active = false
end)
assert(unload_child.active and registry:get(unload_child.id) == unload_child and retirement_ready == 2,
	'unload completion failed to drain its callback-requested admission')
disposal_child:mark_for_disposal()
unload_child:mark_for_disposal()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Scenes retain exact prefab construction mappings and methods for staged member admission (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local shared_state<const> = { lives = 3 }
local defaults<const> = { revision = 'old', shared_state = shared_state }
local base<const> = setmetatable({ initialize = function(self)
	self.initialized = 'old'
	self.component_order = ''
end }, { __index = world_object })
local class<const> = {
	helper = function() return 'old' end,
	ctor = function(self) self.constructed = self:helper() end,
	onspawn = function(self) self.ready = self:helper() end,
}
local first_factory<const> = function(options)
	options.owner.component_order = options.owner.component_order .. 'a'
	return base_component.new(options)
end
local second_factory<const> = function(options)
	options.owner.component_order = options.owner.component_order .. 'b'
	return base_component.new(options)
end
local components<const> = { first_factory, second_factory }
prefab.define({ def_id = 'retained.actor', class = class, base = base, defaults = defaults, components = components })
local definition<const> = { name = 'old.scene', launchable = true, state = shared_state, objects = {
	{ member_id = 'first', definition_id = 'retained.actor', options = { role = 'first' } },
	{ member_id = 'later', definition_id = 'retained.actor', options = { role = 'later' } },
} }
scenes.register('retained', definition)
local existing<const> = scenes.create('retained')
local first<const> = existing:spawn_member('first')
definition.name = 'new.scene'
definition.launchable = false
class.helper = function() return 'new' end
class.ctor = function(self) self.constructed = self:helper() end
class.onspawn = function(self) self.ready = self:helper() end
base.initialize = function(self)
	self.initialized = 'new'
	self.component_order = ''
end
defaults.revision = 'new'
components[1] = second_factory
components[2] = first_factory
prefab.define({ def_id = 'retained.actor', class = class, base = base, defaults = defaults, components = components })
local later<const> = existing:spawn_member('later')
local same_plan<const> = scenes.instantiate('retained')
assert(first.constructed == 'old' and first.revision == 'old' and first.ready == 'old' and first:helper() == 'old'
	and later.constructed == 'old' and later.revision == 'old' and later.ready == 'old' and later:helper() == 'old'
	and first.initialized == 'old' and later.initialized == 'old'
	and first.component_order == 'ab' and later.component_order == 'ab'
	and same_plan.members.first.constructed == 'old' and same_plan.members.later.revision == 'old',
	'Scene resolved an authored member through replaced prefab mappings or methods')
local selected<const> = scenes.create('retained')
selected:spawn_members({ 'later', 'first' }, { later = { role = 'overridden' } })
assert(selected.members.later.role == 'overridden' and selected.members.first.role == 'first'
	and selected.members.later.constructed == 'old' and selected.members.first.component_order == 'ab'
	and selected.definition == existing.definition and definition.objects[2].options.role == 'later'
	and selected.definition.name == 'old.scene' and selected.definition.launchable
	and selected.definition.state == shared_state,
	'explicit member-ID batch did not select retained Scene rows or mutated authored options')
local procedural<const> = existing:spawn('retained.actor', {})
assert(procedural.constructed == 'new' and procedural.revision == 'new' and procedural.ready == 'new'
	and procedural.initialized == 'new' and procedural.component_order == 'ba',
	'procedural spawn did not resolve current construction mappings at request admission')
assert(first.shared_state == shared_state and later.shared_state == shared_state and procedural.shared_state == shared_state,
	'prefab admission deep-cloned a declared gameplay reference')
scenes.register('retained', definition)
local replacement<const> = scenes.instantiate('retained')
assert(replacement.members.first.constructed == 'new' and replacement.members.later.revision == 'new'
	and replacement.members.first.ready == 'new' and replacement.members.later.component_order == 'ba'
	and replacement.definition.name == 'new.scene' and not replacement.definition.launchable,
	'registering a new Scene plan did not bind current prefab definitions')
assert(first.constructed == 'old' and later.constructed == 'old', 'Scene replacement mutated retained instances')
existing:dispose()
same_plan:dispose()
selected:dispose()
replacement:dispose()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World admits a class used as its own base and owns each instance tag set (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local declared_tags<const> = { ['fixture.shared'] = true }
local class<const> = setmetatable({
	initialize = function(self) self.initialized = self:helper() end,
	helper = function() return 'same.base' end,
	onspawn = function(self) assert(self.initialized == 'same.base', 'class/base admission lost its initializer') end,
}, { __index = world_object })
prefab.define({ def_id = 'same.base', class = class, base = class, defaults = { tags = declared_tags } })
local first<const> = world:spawn('same.base', {})
local second<const> = world:spawn('same.base', {})
assert(first:helper() == 'same.base' and first.tags ~= second.tags and first.tags ~= declared_tags,
	'class/base admission created cyclic lookup or shared instance tag storage')
assert(#registry:entries('fixture.shared') == 2, 'declared tags were not published for both objects')
first:remove_tag('fixture.shared')
first:add_tag('fixture.first')
assert(not first:has_tag('fixture.shared') and second:has_tag('fixture.shared') and declared_tags['fixture.shared']
	and not second:has_tag('fixture.first') and declared_tags['fixture.first'] == nil,
	'live tag changes mutated another instance or the prefab declaration')
assert(#registry:entries('fixture.shared') == 1 and registry:entries('fixture.shared')[1] == second
	and #registry:entries('fixture.first') == 1 and registry:entries('fixture.first')[1] == first,
	'per-instance tag mutations did not reconcile Registry indexes')
local authored_tags<const> = { ['fixture.authored'] = true }
local third<const> = world:spawn('same.base', { tags = authored_tags })
local fourth<const> = world:spawn('same.base', { tags = authored_tags })
third:remove_tag('fixture.authored')
assert(fourth:has_tag('fixture.authored') and authored_tags['fixture.authored']
	and not third:has_tag('fixture.shared'), 'spawn-option tags leaked mutable ownership or merged prefab defaults')
first:mark_for_disposal()
second:mark_for_disposal()
third:mark_for_disposal()
fourth:mark_for_disposal()
assert(#registry:entries('fixture.shared') == 0 and #registry:entries('fixture.first') == 0
	and #registry:entries('fixture.authored') == 0, 'tag ownership retained disposed Registry identities')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Scene registration rejects unresolved prefabs and duplicate members before runtime construction (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local constructed = 0
prefab.define({ def_id = 'cold.actor', class = { ctor = function() constructed = constructed + 1 end } })
local unresolved<const> = pcall(function()
	scenes.register('cold.unresolved', { objects = {
		{ member_id = 'missing', definition_id = 'cold.missing', options = {} },
	} })
end)
assert(not unresolved and scenes.definition('cold.unresolved') == nil and constructed == 0,
	'unresolved prefab admission was deferred until runtime construction')
local duplicate<const> = pcall(function()
	scenes.register('cold.duplicate', { objects = {
		{ member_id = 'same', definition_id = 'cold.actor', options = {} },
		{ member_id = 'same', definition_id = 'cold.actor', options = {} },
	} })
end)
assert(not duplicate and scenes.definition('cold.duplicate') == nil and constructed == 0,
	'duplicate member admission was deferred until runtime construction')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
	test(`FSM subscriptions bind with the batch before peer activation but dispatch only after startup (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local events<const> = require('cartlib/event_emitter')
local library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local entered = 0
library.register('binding.machine', { initial = 'idle', states = {
	idle = { on = { wake = { emitter = false, go = '/active' } } },
	active = { entering_state = function() entered = entered + 1 end },
} })
local emitter_component<const> = setmetatable({ on_activate = function(self)
	local receiver<const> = self.owner.scene.members.receiver
	local machine<const> = receiver.state_machines
	assert(machine._bound and events._subscriptions_by_subscriber[machine] ~= nil,
		'earlier peer activated before FSM event routes were bound')
	assert(not receiver.active and not machine._started, 'later receiver activated ahead of authored order')
	self.owner.events:emit('wake')
	assert(entered == 0 and machine:get_machine('binding.machine').current_id == 'idle',
		'inactive receiver dispatched a pre-start event')
end }, { __index = base_component })
emitter_component.__index = emitter_component
prefab.define({ def_id = 'binding.emitter', class = {}, components = {
	function(options) return setmetatable(base_component.new(options), emitter_component) end,
} })
local prestart_component<const> = setmetatable({ on_activate = function(self)
	local owner<const> = self.owner
	local machine<const> = owner.state_machines
	assert(owner.active and machine._bound and not machine._started,
		'component startup did not retain the bound-but-unstarted FSM boundary')
	owner.events:emit('wake')
	assert(entered == 0 and machine:get_machine('binding.machine').current_id == 'idle',
		'active owner dispatched into an FSM before that component started')
end }, { __index = base_component })
prestart_component.__index = prestart_component
prefab.define({ def_id = 'binding.receiver', class = {}, components = {
	function(options) return setmetatable(base_component.new(options), prestart_component) end,
	fsm_component.factory({ 'binding.machine' }),
} })
scenes.register('binding', { objects = {
	{ member_id = 'emitter', definition_id = 'binding.emitter', options = {} },
	{ member_id = 'receiver', definition_id = 'binding.receiver', options = {} },
} })
local scene<const> = scenes.instantiate('binding')
local machine<const> = scene.members.receiver.state_machines
assert(machine._started and machine:get_machine('binding.machine').current_id == 'idle' and entered == 0,
	'FSM startup replayed a pre-start event')
scene.members.emitter.events:emit('wake')
assert(machine:get_machine('binding.machine').current_id == 'active' and entered == 1,
	'bound FSM did not dispatch a post-start event')
scene:dispose()
assert(events._subscriptions_by_subscriber[machine] == nil, 'FSM teardown retained its bound routes')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Terminal teardown consumes custom-unbind resources and dynamic self-removing attachments (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local owner_unbound = 0
local late_attached = 0
local late_detached = 0
local late_unbound = 0
local events_delivered = 0
local late_component<const> = setmetatable({
	on_attach = function() late_attached = late_attached + 1 end,
	on_detach = function() late_detached = late_detached + 1 end,
	unbind = function(self)
		late_unbound = late_unbound + 1
		base_component.unbind(self)
	end,
}, { __index = base_component })
late_component.__index = late_component
prefab.define({ def_id = 'cleanup.owner', class = {
	unbind = function(self)
		owner_unbound = owner_unbound + 1
		self.events:on({ event = 'cleanup.event', handler = function() events_delivered = events_delivered + 1 end })
		self.late_component = self:add_component(setmetatable(base_component.new({ owner = self }), late_component))
	end,
} })
local owner<const> = world:spawn('cleanup.owner', {})
owner:mark_for_disposal()
owner.events:emit('cleanup.event')
assert(owner_unbound == 1 and late_unbound == 1 and events_delivered == 0
	and #owner._components == 0 and owner:get_component(late_component) == nil,
	'terminal cleanup retained resources created by its custom unbind hook')
assert(late_attached == 0 and late_detached == 0 and not owner.late_component._attached,
	'terminal cleanup ran a late attach callback or an unpaired detach callback')
local attached = 0
local detached = 0
local bound = 0
local activated = 0
local removing_component<const> = setmetatable({
	on_attach = function(self)
		attached = attached + 1
		self.owner:remove_component(self)
	end,
	on_detach = function() detached = detached + 1 end,
	on_bind = function() bound = bound + 1 end,
	on_activate = function() activated = activated + 1 end,
}, { __index = base_component })
removing_component.__index = removing_component
prefab.define({ def_id = 'attachment.owner', class = {} })
local live_owner<const> = world:spawn('attachment.owner', {})
local view<const> = world:active_component_view(removing_component)
local component<const> = live_owner:add_component(setmetatable(base_component.new({ owner = live_owner }), removing_component))
assert(attached == 1 and detached == 1 and bound == 0 and activated == 0,
	'on_attach self-removal was lost or continued into binding/activation')
assert(not component._attached and #live_owner._components == 0 and live_owner:get_component(removing_component) == nil
	and registry:get(component.id) == nil and #registry:entries(removing_component) == 0 and #view.components == 0,
	'on_attach self-removal retained owner storage, Registry identity or active membership')
live_owner:mark_for_disposal()
assert(detached == 1, 'owner teardown repeated the self-removed component detach callback')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

}
