local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local worldobject<const> = require('cartlib/world/worldobject')

local definitions<const> = {}
local prefab<const> = {}

local skip_position<const> = { pos = true }

local apply_values<const> = function(instance, values, skipped)
	if not values then
		return
	end
	for key, value in pairs(values) do
		if not skipped[key] then
			instance[key] = value
		end
	end
end

local attach_components<const> = function(instance, list)
	if not list then
		return
	end
	local options<const> = { parent = instance }
	for index = 1, #list do
		instance:add_component(list[index](options))
	end
end

local construct<const> = function(definition, addons)
	local options<const> = {}
	apply_values(options, definition.defaults, skip_position)
	apply_values(options, addons, skip_position)
	options.definition_id = definition.def_id
	options.id = options.id or registry:next_id(definition.def_id)
	local instance<const> = definition.base.new(options)
	world:_reserve_object(instance)
	apply_values(instance, options, skip_position)
	setmetatable(instance, definition.instance_metatable)
	attach_components(instance, definition.components)
	local ctor<const> = definition.ctor
	if ctor then
		ctor(instance, addons, definition.def_id)
	end
	world:spawn(instance, addons and addons.pos)
	return instance
end

function prefab.define(definition)
	local prototype<const> = definition.base or worldobject
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
	definition.base = prototype
	definitions[definition.def_id] = definition
end

function prefab.spawn(definition_id, addons)
	return construct(definitions[definition_id], addons)
end

return prefab
