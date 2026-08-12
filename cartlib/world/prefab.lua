local world_object<const> = require('cartlib/world/world_object')

local definitions<const> = {}
local prefab<const> = {}

local empty_values<const> = {}
local empty_components<const> = {}

-- Prefab definitions retain concrete classes and ordered component
-- constructors. World owns identity, construction and publication.

function prefab.define(definition)
	local prototype<const> = definition.base or world_object
	local class<const> = definition.class
	local class_metatable<const> = getmetatable(class)
	if class_metatable then
		if not class_metatable.__index then
			class_metatable.__index = prototype
		end
	else
		setmetatable(class, { __index = prototype })
	end
	definition.ctor = class.ctor
	definition.instance_metatable = { __index = class }
	definition.initialize = prototype.initialize
	definition.defaults = definition.defaults or empty_values
	definition.components = definition.components or empty_components
	definitions[definition.def_id] = definition
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

return prefab
