local intro<const> = require('intro')
local story<const> = require('story')
local title_screen<const> = require('title_screen')
local director<const> = require('director')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')

local placements<const> = {
	{ definition_id = intro.definition_id, named_id = intro.instance_id, space_id = 'intro' },
	{ definition_id = story.definition_id, named_id = story.instance_id, space_id = 'story' },
	{ definition_id = title_screen.definition_id, named_id = title_screen.instance_id, space_id = 'title' },
	{ definition_id = director.director_def_id, named_id = director.director_instance_id, space_id = 'intro' },
}
local test_scene_id<const> = 'nemesis_s.scene_identity.test'

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return registry:get(director.director_instance_id) ~= nil
end

function __bmsx_host_test.setup()
	for _, placement in ipairs(placements) do
		local original<const> = registry:get(placement.named_id)
		assert(original ~= nil and original.definition_id == placement.definition_id,
			'root composition lost its explicitly named instance')
		local original_component_count<const> = #original._components
		local definition<const> = {
			objects = {
				{
					member_id = 'left', definition_id = placement.definition_id,
					options = { space_id = placement.space_id, pos = { x = 11, y = 12, z = 13 } },
				},
				{
					member_id = 'right', definition_id = placement.definition_id,
					options = { space_id = placement.space_id, pos = { x = 21, y = 22, z = 23 } },
				},
			},
		}
		scene_library.register(test_scene_id, definition)
		local first<const> = scene_library.instantiate(test_scene_id)
		local second<const> = scene_library.instantiate(test_scene_id)
		assert(first.left.id ~= first.right.id and second.left.id ~= second.right.id
			and first.left.id ~= second.left.id and first.right.id ~= second.right.id,
			'repeated scene placement reused a Registry identity')
		assert(first.left.x == 11 and first.left.y == 12 and first.left.z == 13
			and second.right.x == 21 and second.right.y == 22 and second.right.z == 23,
			'placement stopped consuming the actual prefab construction and position options')
		assert(prefab.definition(placement.definition_id).defaults.id == nil
			and definition.objects[1].options.id == nil and definition.objects[2].options.id == nil,
			'instantiation manufactured identity inside the authored prototype or placement')
		for _, object in ipairs({ first.left, first.right, second.left, second.right }) do
			assert(object.id ~= placement.named_id and object.id ~= 'left' and object.id ~= 'right'
				and registry:get(object.id) == object and object.space_id == placement.space_id,
				'scene-local member name replaced the Registry-owned runtime identity')
			local component_ids<const> = {}
			for index, component in ipairs(object._components) do
				assert(component.parent == object and registry:get(component.id) == component,
					'the repeated real prefab shared or failed to register a component')
				component_ids[index] = component.id
			end
			world:mark_for_disposal(object)
			assert(registry:get(object.id) == nil and registry:get(placement.named_id) == original,
				'disposing an extra placement removed the named root instance')
			for _, id in ipairs(component_ids) do
				assert(registry:get(id) == nil, 'disposed placement left a registered component')
			end
		end
		assert(registry:get(placement.named_id) == original and #original._components == original_component_count,
			'repeated placement changed the cart-owned root identity')
		for _, component in ipairs(original._components) do
			assert(component.parent == original and registry:get(component.id) == component,
				'disposing an extra placement removed an original root component')
		end
	end
end

function __bmsx_host_test.update()
	return true
end
