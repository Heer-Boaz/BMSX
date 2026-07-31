local action_effects<const> = require('cartlib/action_effects')
local behaviourtreecomponent<const> = require('cartlib/behaviourtree/component')
local statemachinecomponent<const> = require('cartlib/fsm/component')
local fsmlibrary<const> = require('cartlib/fsm/library')
local spriteobject<const> = require('cartlib/sprite')
local textobject<const> = require('cartlib/text/object')
local world_instance<const> = require('cartlib/world/world').instance
local worldobject<const> = require('cartlib/world/object')

local definitions<const> = {}
local prefab<const> = {}

local skip_position<const> = { pos = true }
local skip_position_and_image<const> = { pos = true, imgid = true }
local skip_position_and_dimensions<const> = { pos = true, dimensions = true }

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
	for index = 1, #list do
		instance:add_component(list[index]({ parent = instance }))
	end
end

local attach_fsms<const> = function(instance, fsms)
	if not fsms then
		return
	end
	local state_machines = instance.state_machines
	if not state_machines then
		state_machines = statemachinecomponent.new({ parent = instance })
		instance:add_component(state_machines)
	end
	for index = 1, #fsms do
		local id<const> = fsms[index]
		state_machines:add_statemachine(id, fsmlibrary.get(id))
	end
end

local attach_effects<const> = function(instance, effects)
	if not effects or #effects == 0 then
		return
	end
	local component<const> = action_effects.actioneffectcomponent.new({ parent = instance })
	instance:add_component(component)
	for index = 1, #effects do
		component:grant_effect(effects[index])
	end
end

local attach_behaviour_trees<const> = function(instance, trees)
	if not trees then
		return
	end
	for index = 1, #trees do
		local root<const> = trees[index]
		instance:add_component(behaviourtreecomponent.new({
			parent = instance,
			root = root,
			id_local = root.id,
		}))
	end
end

local apply_definition<const> = function(instance, definition, addons, skipped)
	apply_values(instance, definition.defaults, skipped)
	setmetatable(instance, definition.instance_metatable)
	attach_components(instance, definition.components)
	attach_fsms(instance, definition.fsms)
	attach_effects(instance, definition.effects)
	attach_behaviour_trees(instance, definition.bts)
	apply_values(instance, addons, skipped)
	local ctor<const> = definition.ctor
	if ctor then
		ctor(instance, addons, definition.def_id)
	end
end

local spawn_object<const> = function(definition, addons)
	local class<const> = definition.class
	local instance<const> = worldobject.new({
		id = (addons and addons.id) or class.id,
	})
	instance.type_name = definition.def_id
	apply_definition(instance, definition, addons, skip_position)
	world_instance:spawn(instance, addons and addons.pos)
	return instance
end

local spawn_sprite<const> = function(definition, addons)
	local class<const> = definition.class
	local instance<const> = spriteobject.new({
		id = (addons and addons.id) or class.id,
	})
	instance.type_name = definition.def_id
	apply_definition(instance, definition, addons, skip_position_and_image)
	local defaults<const> = definition.defaults
	local image_id<const> = (addons and addons.imgid) or (defaults and defaults.imgid)
	if image_id then
		instance:gfx(image_id)
	end
	world_instance:spawn(instance, addons and addons.pos)
	return instance
end

local spawn_text<const> = function(definition, addons)
	local options<const> = {}
	apply_values(options, definition.defaults, skip_position)
	apply_values(options, addons, skip_position)
	options.id = (addons and addons.id) or definition.class.id
	local instance<const> = textobject.new(options)
	instance.type_name = definition.def_id
	apply_definition(instance, definition, addons, skip_position_and_dimensions)
	world_instance:spawn(instance, addons and addons.pos)
	return instance
end

function prefab.define(definition)
	local prototype = worldobject
	local spawn = spawn_object
	if definition.type == 'sprite' then
		prototype = spriteobject
		spawn = spawn_sprite
	elseif definition.type == 'textobject' then
		prototype = textobject
		spawn = spawn_text
	end
	local class<const> = definition.class
	local class_metatable<const> = getmetatable(class)
	if class_metatable then
		if not class_metatable.__index then
			class_metatable.__index = prototype
		end
	else
		setmetatable(class, { __index = prototype })
	end
	definition.ctor = class.ctor or class.constructor
	definition.instance_metatable = { __index = class }
	definition.spawn = spawn
	definitions[definition.def_id] = definition
end

function prefab.spawn(definition_id, addons)
	local definition<const> = definitions[definition_id]
	return definition.spawn(definition, addons)
end

return prefab
