local world_object<const> = require('cartlib/world/world_object')
local token<const> = require('cartlib/token')

local definitions<const> = {}
local definitions_by_token_lo<const> = {}
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
	local token_lo<const>, token_hi<const> = token.hash(source.def_id)
	local definition<const> = {
		id = source.def_id,
		ctor = class.ctor,
		instance_metatable = { __index = class },
		initialize = prototype.initialize,
		defaults = source.defaults or empty_values,
		components = source.components or empty_components,
		token_lo = token_lo,
		token_hi = token_hi,
	}
	definitions[source.def_id] = definition
	local lane = definitions_by_token_lo[token_lo]
	if lane == nil then
		lane = {}
		definitions_by_token_lo[token_lo] = lane
	end
	lane[#lane + 1] = definition
end

function prefab.definition(definition_id)
	return definitions[definition_id]
end

function prefab.definition_by_token(token_lo, token_hi)
	local lane<const> = definitions_by_token_lo[token_lo]
	for index = 1, #lane do
		local definition<const> = lane[index]
		if definition.token_hi == token_hi then
			return definition
		end
	end
end

return prefab
