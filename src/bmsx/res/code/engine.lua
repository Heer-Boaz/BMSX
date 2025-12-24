-- engine.lua
-- Lua engine facade for system ROM

local world_module = require("world")
local WorldObject = require("worldobject")
local SpriteObject = require("sprite")
local TextObject = require("textobject")
local fsmlibrary = require("fsmlibrary")
local action_effects = require("action_effects")

local world = world_module.instance

local definitions = {}

local excluded_class_keys = {
	def_id = true,
	class = true,
	defaults = true,
	metatable = true,
	constructor = true,
	prototype = true,
	super = true,
	__index = true,
}

local function apply_defaults(instance, defaults, skip_key)
	if not defaults then
		return
	end
	for k, v in pairs(defaults) do
		if k ~= skip_key then
			instance[k] = v
		end
	end
end

local function apply_class_addons(instance, class_table)
	if not class_table then
		return
	end
	for k, v in pairs(class_table) do
		if not excluded_class_keys[k] then
			instance[k] = v
		end
	end
end

local function apply_addons(instance, addons, skip_keys)
	if not addons then
		return
	end
	for k, v in pairs(addons) do
		if not skip_keys[k] then
			instance[k] = v
		end
	end
end

local function attach_fsms(instance, fsms)
	if not fsms then
		return
	end
	for i = 1, #fsms do
		local id = fsms[i]
		instance.sc:add_statemachine(id, fsmlibrary.get(id))
	end
end

local function attach_effects(instance, effects)
	if not effects or #effects == 0 then
		return
	end
	local component = action_effects.ActionEffectComponent.new({ parent = instance })
	instance:add_component(component)
	for i = 1, #effects do
		component:grant_effect_by_id(effects[i])
	end
	instance.actioneffects = component
end

local function attach_bts(instance, bts)
	if not bts then
		return
	end
	for i = 1, #bts do
		instance:add_btree(bts[i])
	end
end

local function apply_definition(instance, def, addons, skip_key)
	if def then
		apply_defaults(instance, def.defaults, skip_key)
		apply_class_addons(instance, def.class)
		attach_fsms(instance, def.fsms)
		attach_effects(instance, def.effects)
		attach_bts(instance, def.bts)
	end
	local skip_keys = { pos = true }
	if skip_key then
		skip_keys[skip_key] = true
	end
	apply_addons(instance, addons, skip_keys)
end

local Engine = {}

function Engine.define_fsm(id, blueprint)
	fsmlibrary.register(id, blueprint)
end

function Engine.define_world_object(definition)
	definitions[definition.def_id] = definition
end

function Engine.new_timeline(def)
	local timeline = require("timeline")
	return timeline.Timeline.new(def)
end

function Engine.spawn_object(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = WorldObject.new({ id = instance_id })
	apply_definition(instance, def, addons)
	world:spawn(instance, addons and addons.pos)
	return instance
end

function Engine.spawn_sprite(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = SpriteObject.new({ id = instance_id })
	apply_definition(instance, def, addons, "imgid")
	local imgid = (addons and addons.imgid) or (def and def.defaults and def.defaults.imgid)
	if imgid then
		instance:set_image(imgid)
	end
	world:spawn(instance, addons and addons.pos)
	return instance
end

function Engine.spawn_textobject(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = TextObject.new({ id = instance_id })
	apply_definition(instance, def, addons, "dimensions")
	local dims = (addons and addons.dimensions) or (def and def.defaults and def.defaults.dimensions)
	if dims then
		instance:set_dimensions(dims)
	end
	world:spawn(instance, addons and addons.pos)
	return instance
end

function Engine.object(id)
	return world:get(id)
end

function Engine.update(dt)
	world:update(dt)
end

function Engine.draw()
	world:draw()
end

function Engine.reset()
	world:clear()
end

return Engine
