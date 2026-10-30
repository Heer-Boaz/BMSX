local world_object<const> = require('cartlib/world/world_object')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local definitions<const> = {}
local prefab<const> = {}

local empty_values<const> = {}
local empty_components<const> = {}

-- Prefab definitions retain concrete classes and ordered component
-- constructors. World owns identity, construction and publication.

function prefab.define(source)
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
	}
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

return prefab
