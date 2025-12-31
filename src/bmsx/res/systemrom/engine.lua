-- engine.lua
-- lua engine facade for system rom

local world_module = require("world")
local worldobject = require("worldobject")
local spriteobject = require("sprite")
local textobject = require("textobject")
local fsmlibrary = require("fsmlibrary")
local action_effects = require("action_effects")
local components = require("components")
local service = require("service")
local registry = require("registry")
local eventemitter = require("eventemitter").eventemitter

local world = world_module.instance

local definitions = {}
local service_definitions = {}
local component_definitions = {}

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

local function ensure_component_type(def_id, def)
	if components.componentregistry[def_id] then
		return
	end
	local luacomponent = {}
	luacomponent.__index = luacomponent
	setmetatable(luacomponent, { __index = components.component })
	function luacomponent.new(opts)
		opts = opts or {}
		opts.type_name = def_id
		local self = setmetatable(components.component.new(opts), luacomponent)
		apply_class_addons(self, def and def.class)
		return self
	end
	components.register_component(def_id, luacomponent)
end

local function attach_components(instance, list)
	if not list then
		return
	end
	for i = 1, #list do
		local entry = list[i]
		if type(entry) == "string" then
			local comp = components.new_component(entry, { parent = instance })
			instance:add_component(comp)
		elseif type(entry) == "table" and entry.type_name then
			local comp = entry
			comp.parent = instance
			instance:add_component(comp)
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
	local component = action_effects.actioneffectcomponent.new({ parent = instance })
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
		attach_components(instance, def.components)
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

local engine = {}

function engine.define_fsm(id, blueprint)
	fsmlibrary.register(id, blueprint)
end

function engine.define_world_object(definition)
	definitions[definition.def_id] = definition
end

function engine.define_service(definition)
	service_definitions[definition.def_id] = definition
end

function engine.define_component(definition)
	component_definitions[definition.def_id] = definition
	ensure_component_type(definition.def_id, definition)
end

function engine.define_effect(definition, opts)
	action_effects.register_effect(definition, opts)
end

function engine.new_timeline(def)
	local timeline = require("timeline")
	return timeline.timeline.new(def)
end

function engine.timeline_range(frame_count)
	local frames = {}
	for i = 0, frame_count - 1 do
		frames[#frames + 1] = i
	end
	return frames
end

function engine.new_timeline_range(def)
	local definition = def or {}
	definition.frames = engine.timeline_range(definition.frame_count)
	return engine.new_timeline(definition)
end

function engine.spawn_object(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = worldobject.new({ id = instance_id })
	apply_definition(instance, def, addons)
	world:spawn(instance, addons and addons.pos)
	return instance
end

function engine.spawn_sprite(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = spriteobject.new({ id = instance_id })
	apply_definition(instance, def, addons, "imgid")
	local imgid = (addons and addons.imgid) or (def and def.defaults and def.defaults.imgid)
	if imgid then
		instance:set_image(imgid)
	end
	world:spawn(instance, addons and addons.pos)
	return instance
end

function engine.spawn_textobject(definition_id, addons)
	local def = definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = textobject.new({ id = instance_id })
	apply_definition(instance, def, addons, "dimensions")
	local dims = (addons and addons.dimensions) or (def and def.defaults and def.defaults.dimensions)
	if dims then
		instance:set_dimensions(dims)
	end
	world:spawn(instance, addons and addons.pos)
	return instance
end

function engine.create_service(definition_id, addons)
	local def = service_definitions[definition_id]
	local class_table = def and def.class or nil
	local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
	local instance = service.new({ id = instance_id })
	apply_definition(instance, def, addons)
	registry.instance:register(instance)
	if def and def.auto_activate then
		instance:activate()
	end
	return instance
end

function engine.service(id)
	return registry.instance:get(id)
end

function engine.object(id)
	return world:get(id)
end

function engine.attach_component(object_or_id, component_or_type)
	local obj = type(object_or_id) == "string" and world:get(object_or_id) or object_or_id
	if type(component_or_type) == "table" and component_or_type.type_name then
		obj:add_component(component_or_type)
		return component_or_type
	end
	if type(component_or_type) == "string" then
		local comp = components.new_component(component_or_type, { parent = obj })
		obj:add_component(comp)
		return comp
	end
	error("attach_component expects a component instance or type name")
end

function engine.update(dt)
	world:update(dt)
end

function engine.draw()
	world:draw()
end

function engine.reset()
	world:clear()
	registry.instance:clear()
	world:apply_default_pipeline()
end

function engine.configure_ecs(nodes)
	return world:configure_pipeline(nodes)
end

function engine.apply_default_pipeline()
	return world:apply_default_pipeline()
end

function engine.register(value)
	registry.instance:register(value)
end

function engine.deregister(id)
	registry.instance:deregister(id)
end

function engine.grant_effect(object_id, effect_id)
	local obj = world:get(object_id)
	local component = obj:get_component("actioneffectcomponent")
	if not component then
		error("world object '" .. object_id .. "' does not have an actioneffectcomponent.")
	end
	component:grant_effect_by_id(effect_id)
end

function engine.trigger_effect(object_id, effect_id, options)
	local obj = world:get(object_id)
	local component = obj:get_component("actioneffectcomponent")
	if not component then
		error("world object '" .. object_id .. "' does not have an actioneffectcomponent.")
	end
	local payload = options and options.payload or nil
	if payload ~= nil then
		return component:trigger(effect_id, { payload = payload })
	end
	return component:trigger(effect_id)
end

if $.emit == nil then
	function $.emit(name_or_event, emitter, payload)
		return eventemitter.instance:emit(name_or_event, emitter, payload)
	end
end

require("audio_router").init()

if not world._ecs_pipeline_built then
	world._ecs_pipeline_built = true
	world:apply_default_pipeline()
end

return engine
