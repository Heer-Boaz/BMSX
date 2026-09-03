local prefab<const> = require('cartlib/world/prefab')
local scene_instance<const> = require('cartlib/world/scene_instance')
local world<const> = require('cartlib/world/world')

local scene_library<const> = {}
local definitions<const> = {}

-- Registration materializes an immutable scene revision. Runtime instances
-- retain these records; the authored input table is not a second live model.
local materialize_definition<const> = function(blueprint, revision)
	local records<const> = {}
	local members_by_id<const> = {}
	local source_records<const> = blueprint.objects
	for index = 1, #source_records do
		local source<const> = source_records[index]
		local pos<const> = source.pos
		local record<const> = {
			member_id = source.member_id,
			definition_id = source.definition_id,
			prefab_definition = prefab.definition(source.definition_id),
			space_id = source.space_id,
			x = pos.x,
			y = pos.y,
			z = pos.z,
		}
		records[index] = record
		members_by_id[record.member_id] = record
	end
	return {
		revision = revision,
		objects = records,
		members_by_id = members_by_id,
	}
end

function scene_library.register(scene_id, blueprint)
	local previous<const> = definitions[scene_id]
	local revision = 1
	if previous ~= nil then
		revision = previous.revision + 1
	end
	local definition<const> = materialize_definition(blueprint, revision)
	definitions[scene_id] = definition
	local instance<const> = world:_scene_instance(scene_id)
	if instance ~= nil then
		instance:_apply_definition(definition)
	end
end

function scene_library.load(scene_id)
	local instance<const> = scene_instance.new(world, scene_id)
	world:_add_scene_instance(instance)
	instance:_load(definitions[scene_id])
	return instance
end

function scene_library.unload(scene_id)
	world:_scene_instance(scene_id):_unload()
end

function scene_library.reload(scene_id)
	world:_scene_instance(scene_id):_reload(definitions[scene_id])
end

function scene_library.instance(scene_id)
	return world:_scene_instance(scene_id)
end

return scene_library
