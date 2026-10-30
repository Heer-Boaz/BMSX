local world_object<const> = require('cartlib/world/world_object')
local shallow_copy<const> = require('cartlib/util/shallow_copy')
local transform_2d<const> = require('cartlib/component/transform_2d_component')
local transform_3d<const> = require('cartlib/component/transform_3d_component')
local component_inputs<const> = require('cartlib/world/component_inputs')

local definitions<const> = {}
local prefab<const> = {}

local empty_values<const> = {}
local empty_components<const> = {}

-- Prefab definitions retain concrete classes and ordered component
-- constructors. World owns identity, construction and publication.

function prefab.define(source)
	local spatial_constructor
	local spatial_family
	local spatial_root_origin
	local spatial_validate_local
	local default_local_transform
	local spatial_source<const> = source.spatial
	if spatial_source ~= nil then
		local transform
		if spatial_source.family == '2d' then
			transform = transform_2d
		elseif spatial_source.family == '3d' then
			transform = transform_3d
		else
			error('unsupported prefab spatial family: ' .. source.def_id)
		end
		spatial_family = transform.family
		if spatial_source.authority == 'affine' then
			spatial_constructor = transform.new
		elseif spatial_source.authority == 'root_origin' then
			local root_origin<const> = transform.root_origin
			spatial_constructor = root_origin.new
			spatial_root_origin = true
			spatial_validate_local = root_origin.validate_local
		else
			error('unsupported prefab spatial authority: ' .. source.def_id)
		end
		local authored_transform<const> = spatial_source.local_transform
		if authored_transform == nil then
			default_local_transform = spatial_family.identity
		else
			default_local_transform = shallow_copy(authored_transform)
			if spatial_validate_local ~= nil then
				spatial_validate_local(default_local_transform)
			end
		end
	end

	local prototype<const> = source.base or world_object
	local class<const> = source.class
	-- A concrete library base may itself be the instantiated class. That
	-- declares no new inheritance edge (not a self-parented prototype).
	if class ~= prototype then
		local class_metatable<const> = getmetatable(class)
		local inheritance<const> = class_metatable and shallow_copy(class_metatable) or {}
		inheritance.__index = prototype
		setmetatable(class, inheritance)
	end

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
	local source_components<const> = source.components or empty_components
	for index = 1, #source_components do
		components[index] = source_components[index]
	end
	definitions[source.def_id] = {
		definition_id = source.def_id,
		ctor = methods.ctor,
		instance_metatable = { __index = methods },
		initialize = methods.initialize,
		defaults = shallow_copy(source.defaults or empty_values),
		components = components,
		initial = component_inputs.merge(component_inputs.empty, source.initial),
		spatial_constructor = spatial_constructor,
		spatial_family = spatial_family,
		spatial_root_origin = spatial_root_origin,
		spatial_validate_local = spatial_validate_local,
		default_local_transform = default_local_transform,
	}
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

return prefab
