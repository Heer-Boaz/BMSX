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
	local first_left<const> = first.left
	local first_right<const> = first.right

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
	assert(second.left ~= first_left and second.right ~= first_right
		and second.left.id ~= first_left.id and second.right.id ~= first_right.id,
		'two scene instances shared runtime objects or Registry identities')

	scene_library.register(scene_id, replacement_definition)
	local replacement<const> = scene_library.instantiate(scene_id)
	assert(replacement.left.authored_value == 'left.2'
		and replacement.left.x == 31 and replacement.left.y == 32
		and replacement.left.z == 33,
		're-registration did not affect the next scene instantiation')
	assert(first_left.authored_value == 'left.1'
		and first_left.x == 11 and first_left.y == 12 and first_left.z == 13,
		're-registration mutated an existing scene instance')
end

function __bmsx_host_test.update()
	return true
end
