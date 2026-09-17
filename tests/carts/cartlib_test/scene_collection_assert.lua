local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')

local actor_definition_id<const> = 'cartlib_test.scene_collection.actor'
local scene_id<const> = 'cartlib_test.scene_collection'
local lifecycle<const> = {}

local scene_actor_base<const> = {}
scene_actor_base.__index = scene_actor_base
setmetatable(scene_actor_base, { __index = world_object })

function scene_actor_base.initialize(self)
	lifecycle[#lifecycle + 1] = 'initialize:' .. self.authored_value
	world_object.initialize(self)
end

local scene_actor<const> = {}
scene_actor.__index = scene_actor

function scene_actor:onspawn()
	lifecycle[#lifecycle + 1] = 'spawn:' .. self.authored_value
end

function scene_actor:ondespawn()
	if self.other ~= nil then
		self.other:mark_for_disposal()
	end
end

prefab.define({
	def_id = actor_definition_id,
	class = scene_actor,
	base = scene_actor_base,
})

local first_definition<const> = {
	objects = {
		{
			member_id = 'left',
			definition_id = actor_definition_id,
			options = {
				authored_value = 'left.1',
				pos = { x = 11, y = 12, z = 13 },
			},
		},
		{
			member_id = 'right',
			definition_id = actor_definition_id,
			options = {
				authored_value = 'right.1',
				pos = { x = 21, y = 22, z = 23 },
			},
		},
	},
}

local replacement_definition<const> = {
	objects = {
		{
			member_id = 'left',
			definition_id = actor_definition_id,
			options = {
				authored_value = 'left.2',
				pos = { x = 31, y = 32, z = 33 },
			},
		},
	},
}

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	world:clear()
	scene_library.register(scene_id, first_definition)
	local first<const> = scene_library.instantiate(scene_id)
	local first_left<const> = first.members.left
	local first_right<const> = first.members.right

	assert(lifecycle[1] == 'initialize:left.1'
		and lifecycle[2] == 'spawn:left.1'
		and lifecycle[3] == 'initialize:right.1'
		and lifecycle[4] == 'spawn:right.1',
		'scene members were not instantiated in authored order')
	assert(first_left.authored_value == 'left.1'
		and first_left.x == 11 and first_left.y == 12 and first_left.z == 13
		and first_right.authored_value == 'right.1'
		and first_right.x == 21 and first_right.y == 22 and first_right.z == 23,
		'scene instantiation did not consume direct World spawn options')
	assert(first_left.id ~= 'left' and first_right.id ~= 'right'
		and registry:get(first_left.id) == first_left
		and registry:get(first_right.id) == first_right,
		'scene-local member identity replaced Registry runtime identity')

	local second<const> = scene_library.instantiate(scene_id)
	assert(second.members.left ~= first_left and second.members.right ~= first_right
		and second.members.left.id ~= first_left.id and second.members.right.id ~= first_right.id,
		'two scene instances shared runtime objects or Registry identities')
	local state<const> = { lives = 3 }
	local bound<const> = scene_library.instantiate(scene_id, {
		left = { authored_value = 'bound', player_state = state },
	})
	assert(bound.members.left.player_state == state and bound.members.left.authored_value == 'bound'
		and bound.members.left.x == 11 and bound.members.right.authored_value == 'right.1',
		'runtime binding discarded layout or affected an unbound member')
	assert(scene_library.definition(scene_id) == first_definition
		and first_definition.objects[1].options.authored_value == 'left.1'
		and first_definition.objects[1].options.player_state == nil,
		'runtime binding mutated the authored definition')
	local projectile<const> = bound:spawn(actor_definition_id, { authored_value = 'projectile' })
	projectile:set_space('main')
	projectile:deactivate()
	bound:dispose()
	assert(projectile.world == nil and #bound.objects.items == 0 and next(bound.members) == nil,
		'scene teardown retained an inactive procedural object')

	-- Destruction of a single member releases the live membership immediately;
	-- a long-running scene must not retain every expired projectile it spawned.
	for index = 1, 20 do
		local transient<const> = second:spawn(actor_definition_id, { authored_value = 'transient' })
		transient:mark_for_disposal()
	end
	assert(#second.objects.items == 2, 'scene retained expired runtime objects')

	local cascading<const> = scene_library.instantiate(scene_id)
	local cascading_left<const> = cascading.members.left
	local cascading_right<const> = cascading.members.right
	local owner<const> = cascading:spawn(actor_definition_id, {
		authored_value = 'encounter', other = cascading_left,
	})
	cascading:dispose()
	assert(cascading_left.world == nil and cascading_right.world == nil and owner.world == nil,
		'nested encounter teardown skipped a scene member')

	world:_open_mutation_barrier()
	local pending_scene<const> = scene_library.instantiate(scene_id)
	local pending<const> = pending_scene.members.left
	local completion<const> = { called = false, object = pending }
	pending_scene:dispose(function(context)
		assert(context.object.world == nil and registry:get(context.object.id) == nil,
			'scene unload completed before pending admissions were cancelled')
		context.called = true
	end, completion)
	assert(not completion.called, 'scene teardown escaped the current system group')
	world:_commit_mutation_barrier()
	assert(completion.called and #pending_scene.objects.items == 0,
		'scene unload did not finish at the structural barrier')

	scene_library.register(scene_id, replacement_definition)
	local replacement<const> = scene_library.instantiate(scene_id)
	assert(replacement.members.left.authored_value == 'left.2'
		and replacement.members.left.x == 31 and replacement.members.left.y == 32
		and replacement.members.left.z == 33,
		're-registration did not affect the next scene instantiation')
	assert(first_left.authored_value == 'left.1'
		and first_left.x == 11 and first_left.y == 12 and first_left.z == 13,
		're-registration mutated an existing scene instance')
	first:dispose()
	assert(registry:get(first_left.id) == nil and registry:get(first_right.id) == nil
		and registry:get(second.members.left.id) == second.members.left
		and registry:get(replacement.members.left.id) == replacement.members.left,
		'disposing a scene affected another instance or retained its own members')
	local second_left<const> = second.members.left
	local replacement_left<const> = replacement.members.left
	world:clear()
	second:dispose()
	replacement:dispose()
	assert(second_left.world == nil and replacement_left.world == nil
		and next(second.members) == nil and next(replacement.members) == nil,
		'group cleanup after World clear repeated object teardown')
end

function __bmsx_host_test.update()
	return true
end
