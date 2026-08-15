local world_object<const> = require('cartlib/world/world_object')

local definitions<const> = {}
local prefab<const> = {}

local empty_values<const> = {}
local empty_components<const> = {}

-- Prefab definitions retain concrete classes and ordered component
-- constructors. World owns identity, construction and publication.

function prefab.define(source)
	local prototype<const> = source.base or world_object
	local class<const> = source.class
	local class_metatable<const> = getmetatable(class)
	if class_metatable then
		if not class_metatable.__index then
			class_metatable.__index = prototype
		end
	else
		setmetatable(class, { __index = prototype })
	end
	definitions[source.def_id] = {
		ctor = class.ctor,
		instance_metatable = { __index = class },
		initialize = prototype.initialize,
		defaults = source.defaults or empty_values,
		components = source.components or empty_components,
	}
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

return prefab
