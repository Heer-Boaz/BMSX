local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')

local actor_definition_id<const> = 'cartlib_test.scene.actor'
local replacement_definition_id<const> = 'cartlib_test.scene.replacement'
local scene_a_id<const> = 'cartlib_test.scene.a'
local scene_b_id<const> = 'cartlib_test.scene.b'
local events<const> = {}

local scene_base<const> = {}
scene_base.__index = scene_base
setmetatable(scene_base, { __index = world_object })

function scene_base.initialize(self)
	assert(self._scene_instance ~= nil and self._scene_member_id ~= nil,
		'scene membership was not established before prefab initialization')
	events[#events + 1] = 'initialize:' .. self._scene_member_id
	world_object.initialize(self)
end

local actor<const> = {}
actor.__index = actor

function actor:onspawn()
	events[#events + 1] = 'spawn:' .. self._scene_member_id
end

function actor:ondespawn()
	events[#events + 1] = 'despawn:' .. self._scene_member_id
	world_object.ondespawn(self)
end

local replacement<const> = {}
replacement.__index = replacement

function replacement:onspawn()
	events[#events + 1] = 'replacement_spawn:' .. self._scene_member_id
end

function replacement:ondespawn()
	events[#events + 1] = 'replacement_despawn:' .. self._scene_member_id
	world_object.ondespawn(self)
end

prefab.define({
	def_id = actor_definition_id,
	class = actor,
	base = scene_base,
})

prefab.define({
	def_id = replacement_definition_id,
	class = replacement,
	base = scene_base,
})

local scene_a_revision_1<const> = {
	objects = {
		{
			member_id = 'retained',
			definition_id = actor_definition_id,
			space_id = 'main',
			pos = { x = 1, y = 2, z = 3 },
		},
		{
			member_id = 'removed',
			definition_id = actor_definition_id,
			space_id = 'main',
			pos = { x = 4, y = 5, z = 6 },
		},
		{
			member_id = 'replaced',
			definition_id = actor_definition_id,
			space_id = 'main',
			pos = { x = 7, y = 8, z = 9 },
		},
		{
			member_id = 'tombstone',
			definition_id = actor_definition_id,
			space_id = 'main',
			pos = { x = 10, y = 11, z = 12 },
		},
	},
}

local scene_b_revision_1<const> = {
	objects = {
		{
			member_id = 'retained',
			definition_id = actor_definition_id,
			space_id = 'main',
			pos = { x = 20, y = 21, z = 22 },
		},
	},
}

__bmsx_host_test = {
	complete = false,
}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	scene_library.register(scene_a_id, scene_a_revision_1)
	scene_library.register(scene_b_id, scene_b_revision_1)
	local scene_a<const> = scene_library.load(scene_a_id)
	local scene_b<const> = scene_library.load(scene_b_id)
	local retained<const> = scene_a:object('retained')
	local removed<const> = scene_a:object('removed')
	local replaced<const> = scene_a:object('replaced')
	local tombstone<const> = scene_a:object('tombstone')
	local additive_retained<const> = scene_b:object('retained')
	local applied<const>, pending<const> = scene_a:revisions()
	assert(applied == 1 and pending == nil
		and scene_library.instance(scene_a_id) == scene_a
		and scene_library.instance(scene_b_id) == scene_b,
		'initial scene definitions did not publish their retained instances')
	assert(retained.id + 1 == removed.id
		and removed.id + 1 == replaced.id
		and replaced.id + 1 == tombstone.id
		and tombstone.id + 1 == additive_retained.id
		and retained.id ~= 'retained' and additive_retained.id ~= 'retained'
		and retained ~= additive_retained,
		'authored order or separate scene-local and Registry identities changed')
	assert(registry:get(retained.id) == retained
		and registry:get(additive_retained.id) == additive_retained,
		'scene load did not publish its objects through Registry')
	local x<const>, y<const>, z<const> = scene_a:position('retained')
	assert(x == 1 and y == 2 and z == 3,
		'scene position did not use cartlib integer coordinates')
	scene_a:set_position('retained', 30, 31, 32)
	assert(retained.x == 30 and retained.y == 31 and retained.z == 32,
		'live scene position did not use the WorldObject owner')

	tombstone:mark_for_disposal()
	assert(scene_a:object('tombstone') == nil and scene_a:tombstoned('tombstone'),
		'gameplay disposal did not retain a scene tombstone')
	for index = #events, 1, -1 do
		events[index] = nil
	end

	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 40, y = 41, z = 42 },
			},
			{
				member_id = 'replaced',
				definition_id = replacement_definition_id,
				space_id = 'main',
				pos = { x = 50, y = 51, z = 52 },
			},
			{
				member_id = 'added',
				definition_id = actor_definition_id,
				space_id = 'main',
				pos = { x = 60, y = 61, z = 62 },
			},
			{
				member_id = 'tombstone',
				definition_id = replacement_definition_id,
				space_id = 'main',
				pos = { x = 70, y = 71, z = 72 },
			},
		},
	})
	local replacement_object<const> = scene_a:object('replaced')
	local added<const> = scene_a:object('added')
	local applied_2<const>, pending_2<const> = scene_a:revisions()
	assert(applied_2 == 2 and pending_2 == nil
		and scene_a:object('retained') == retained
		and scene_a:object('removed') == nil
		and registry:get(removed.id) == nil
		and replacement_object ~= replaced and replacement_object.id ~= replaced.id
		and registry:get(replaced.id) == nil
		and registry:get(replacement_object.id) == replacement_object
		and registry:get(added.id) == added,
		'scene reconcile did not retain, remove, replace and add through one World batch')
	assert(retained.space_id == 'alternate'
		and retained.x == 40 and retained.y == 41 and retained.z == 42,
		'retained common-field mutations did not use concrete WorldObject operations')
	assert(events[1] == 'despawn:replaced'
		and events[2] == 'despawn:removed'
		and events[3] == 'initialize:replaced'
		and events[4] == 'initialize:added',
		'scene replacement did not finish every terminal removal before new initialization')
	assert(scene_a:object('tombstone') == nil and scene_a:tombstoned('tombstone'),
		'a changed definition rematerialized a gameplay tombstone')

	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 40, y = 41, z = 42 },
			},
			{
				member_id = 'replaced',
				definition_id = replacement_definition_id,
				space_id = 'main',
				pos = { x = 50, y = 51, z = 52 },
			},
			{
				member_id = 'added',
				definition_id = actor_definition_id,
				space_id = 'main',
				pos = { x = 60, y = 61, z = 62 },
			},
		},
	})
	assert(not scene_a:tombstoned('tombstone'),
		'a removed authored member retained a tombstone outside its definition')

	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 40, y = 41, z = 42 },
			},
			{
				member_id = 'removed',
				definition_id = actor_definition_id,
				space_id = 'main',
				pos = { x = 45, y = 46, z = 47 },
			},
			{
				member_id = 'replaced',
				definition_id = replacement_definition_id,
				space_id = 'main',
				pos = { x = 50, y = 51, z = 52 },
			},
			{
				member_id = 'added',
				definition_id = actor_definition_id,
				space_id = 'main',
				pos = { x = 60, y = 61, z = 62 },
			},
			{
				member_id = 'tombstone',
				definition_id = actor_definition_id,
				space_id = 'main',
				pos = { x = 70, y = 71, z = 72 },
			},
		},
	})
	local respawned<const> = scene_a:object('tombstone')
	assert(respawned ~= nil and respawned.id ~= tombstone.id
		and registry:get(respawned.id) == respawned,
		'two committed remove/add revisions did not respawn a tombstoned member')

	world:clear_space('main')
	assert(scene_library.instance(scene_a_id) == scene_a
		and scene_a:object('retained') == retained
		and scene_a:tombstoned('removed')
		and scene_a:tombstoned('replaced')
		and scene_a:tombstoned('tombstone')
		and scene_b:tombstoned('retained'),
		'Space teardown changed scene ownership instead of recording live-member tombstones')

	scene_library.reload(scene_a_id)
	local reloaded_retained<const> = scene_a:object('retained')
	assert(reloaded_retained ~= retained and reloaded_retained.id ~= retained.id
		and not scene_a:tombstoned('removed')
		and not scene_a:tombstoned('replaced')
		and not scene_a:tombstoned('tombstone'),
		'explicit reload did not reconstruct every authored member and tombstone')

	scene_library.unload(scene_b_id)
	assert(scene_library.instance(scene_b_id) == nil,
		'scene unload did not remove the World-owned instance')

	world:_open_mutation_barrier()
	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 80, y = 81, z = 82 },
			},
		},
	})
	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 90, y = 91, z = 92 },
			},
		},
	})
	local applied_before<const>, pending_before<const> = scene_a:revisions()
	assert(applied_before == 4 and pending_before == 6
		and reloaded_retained.x == 40,
		'pending scene revisions leaked before their World barrier')
	world:_commit_mutation_barrier()
	local applied_after<const>, pending_after<const> = scene_a:revisions()
	assert(applied_after == 6 and pending_after == nil
		and scene_a:object('retained') == reloaded_retained
		and reloaded_retained.x == 90,
		'scene revision coalescing did not retain identity and commit the latest definition')

	world:_open_mutation_barrier()
	scene_library.register(scene_a_id, {
		objects = {
			{
				member_id = 'retained',
				definition_id = actor_definition_id,
				space_id = 'alternate',
				pos = { x = 100, y = 101, z = 102 },
			},
		},
	})
	world:clear()
	local clear_applied<const>, clear_pending<const> = scene_a:revisions()
	assert(clear_applied == 6 and clear_pending == 7,
		'deferred World clear changed scene revisions before its barrier')
	world:_commit_mutation_barrier()
	assert(scene_library.instance(scene_a_id) == nil
		and registry:get(reloaded_retained.id) == nil,
		'World clear did not supersede pending scene completion and unload its objects')
	__bmsx_host_test.complete = true
end

function __bmsx_host_test.update()
	return __bmsx_host_test.complete
end
