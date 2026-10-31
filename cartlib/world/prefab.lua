local world_object<const> = require('cartlib/world/world_object')

local definitions<const> = {}
local placement_fields<const> = {
	position = true, rotation = true, scale = true, skew = true,
	transform = true, parent = true,
}
local prefab<const> = {}

local empty_values<const> = {}
local empty_components<const> = {}

-- Prefab definitions retain concrete classes and ordered component
-- constructors. World owns identity, construction and publication.

function prefab.define(source)
	local class = source.class
	if class == nil then class = world_object end

	-- Admission owns the lookup surface and ordered construction mappings.
	-- Nested authored values and closure captures retain their declared identity;
	-- this is not a deep clone of gameplay state or executable closures.
	local methods<const> = {}
	local current = class
	while current ~= nil do
		for key, value in pairs(current) do
			if key ~= '__index' and rawget(methods, key) == nil then
				methods[key] = value
			end
		end
		local metatable<const> = getmetatable(current)
		current = metatable and metatable.__index
	end
	local components<const> = {}
	local source_components = source.components
	if source_components == nil then source_components = empty_components end
	for index = 1, #source_components do
		components[index] = source_components[index]
	end
	local initialize_transform<const> = methods._initialize_transform
	local reserved<const> = initialize_transform ~= nil and placement_fields or empty_values
	local source_defaults = source.defaults
	if source_defaults == nil then source_defaults = empty_values end
	local defaults<const> = {}
	for key, value in pairs(source_defaults) do
		if not reserved[key] then
			defaults[key] = value
		end
	end
	local definition<const> = {
		definition_id = source.def_id,
		ctor = methods.ctor,
		instance_metatable = { __index = methods },
		initialize = methods.initialize,
		defaults = defaults,
		components = components,
		transform_family = methods._family,
		compile_pose = methods._compile_pose,
		initialize_transform = initialize_transform,
		placement_fields = reserved,
	}
	local compile_pose<const> = definition.compile_pose
	if compile_pose ~= nil and not compile_pose(definition, nil, source) then
		error('prefab placement cannot preserve unspecified rotation or skew: ' .. source.def_id)
	end
	definitions[source.def_id] = definition
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

return prefab
