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
local quickmenu = require("quickmenu")

local world = world_module.instance

local definitions = {}
local service_definitions = {}
local component_definitions = {}
local vdp_load_job_seq = 0
local vdp_load_queue = {}
local vdp_load_queue_head = 1
local vdp_load_queue_tail = 0
local vdp_active_job = nil
local vdp_load_handler = nil
local cart_irq_handler = nil

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

local function vdp_dequeue_job()
	if vdp_load_queue_head > vdp_load_queue_tail then
		return nil
	end
	local job = vdp_load_queue[vdp_load_queue_head]
	vdp_load_queue[vdp_load_queue_head] = nil
	vdp_load_queue_head = vdp_load_queue_head + 1
	if vdp_load_queue_head > vdp_load_queue_tail then
		vdp_load_queue_head = 1
		vdp_load_queue_tail = 0
	end
	return job
end

local function vdp_start_job(job)
	vdp_active_job = job
	poke(SYS_IMG_SRC, job.src)
	poke(SYS_IMG_LEN, job.len)
	poke(SYS_IMG_DST, job.dst)
	poke(SYS_IMG_CAP, job.cap)
	poke(SYS_IMG_CTRL, IMG_CTRL_START)
end

local function vdp_try_start_next_job()
	if vdp_active_job ~= nil then
		return
	end
	local status = peek(SYS_IMG_STATUS)
	if (status & IMG_STATUS_BUSY) ~= 0 then
		return
	end
	local job = vdp_dequeue_job()
	if job == nil then
		return
	end
	vdp_start_job(job)
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

function engine.vdp_map_slot(slot, atlas_id)
	if atlas_id == nil then
		atlas_id = SYS_VDP_ATLAS_NONE
	end
	if slot == 0 then
		poke(SYS_VDP_PRIMARY_ATLAS_ID, atlas_id)
		return
	end
	if slot == 1 then
		poke(SYS_VDP_SECONDARY_ATLAS_ID, atlas_id)
		return
	end
	error("vdp_map_slot: invalid slot " .. tostring(slot))
end

function engine.vdp_load_slot(slot, atlas_id)
	if type(atlas_id) ~= "number" then
		error("vdp_load_slot: atlas_id must be a number")
	end
	local atlas_id_int = math.floor(atlas_id)
	local atlas_name = string.format("_atlas_%02d", atlas_id_int)
	local asset = assets.img[atlas_name]
	local start = asset.start
	local finish = asset["end"]
	if start == nil or finish == nil then
		error("vdp_load_slot: atlas asset missing ROM range")
	end
	local payload_id = asset.payload_id
	local base = SYS_CART_ROM_BASE
	if payload_id == "system" then
		base = SYS_ENGINE_ROM_BASE
	elseif payload_id == "overlay" then
		base = SYS_OVERLAY_ROM_BASE
	elseif payload_id ~= nil and payload_id ~= "cart" then
		error("vdp_load_slot: unsupported payload_id " .. tostring(payload_id))
	end
	local src = base + start
	local len = finish - start
	local dst
	local cap
	if slot == 0 then
		dst = SYS_VRAM_PRIMARY_ATLAS_BASE
		cap = SYS_VRAM_PRIMARY_ATLAS_SIZE
	elseif slot == 1 then
		dst = SYS_VRAM_SECONDARY_ATLAS_BASE
		cap = SYS_VRAM_SECONDARY_ATLAS_SIZE
	else
		error("vdp_load_slot: invalid slot " .. tostring(slot))
	end
	vdp_load_job_seq = vdp_load_job_seq + 1
	vdp_load_queue_tail = vdp_load_queue_tail + 1
	vdp_load_queue[vdp_load_queue_tail] = {
		job_id = vdp_load_job_seq,
		slot = slot,
		atlas_id = atlas_id_int,
		src = src,
		len = len,
		dst = dst,
		cap = cap,
	}
	vdp_try_start_next_job()
	return vdp_load_job_seq
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
	quickmenu.update(dt)
	if quickmenu.is_open() then
		return
	end
	world:update(dt)
end

function engine.irq(flags)
	if (flags & IRQ_IMG_DONE) ~= 0 then
		poke(SYS_IRQ_ACK, IRQ_IMG_DONE)
		if vdp_active_job == nil then
			error("irq: IMG_DONE without pending atlas load")
		end
		local skip_map = false
		if vdp_load_handler ~= nil then
			local should_skip = vdp_load_handler(vdp_active_job.job_id, vdp_active_job.slot, vdp_active_job.atlas_id, "done")
			if should_skip == true then
				skip_map = true
			end
		end
		if not skip_map then
			vdp_map_slot(vdp_active_job.slot, vdp_active_job.atlas_id)
		end
		vdp_active_job = nil
		vdp_try_start_next_job()
	end
	if (flags & IRQ_IMG_ERROR) ~= 0 then
		poke(SYS_IRQ_ACK, IRQ_IMG_ERROR)
		if vdp_active_job == nil then
			error("irq: IMG_ERROR without pending atlas load")
		end
		if vdp_load_handler ~= nil then
			vdp_load_handler(vdp_active_job.job_id, vdp_active_job.slot, vdp_active_job.atlas_id, "error")
		end
		vdp_active_job = nil
		error("irq: IMGDEC failed while loading atlas")
	end
	if cart_irq_handler ~= nil then
		cart_irq_handler(flags)
	end
end

function engine.on_irq(handler)
	if handler == nil then
		cart_irq_handler = nil
		return
	end
	if type(handler) ~= "function" then
		error("on_irq: handler must be a function")
	end
	cart_irq_handler = handler
end

function engine.on_vdp_load(handler)
	if handler == nil then
		vdp_load_handler = nil
		return
	end
	if type(handler) ~= "function" then
		error("on_vdp_load: handler must be a function")
	end
	vdp_load_handler = handler
end

function engine.draw()
	world:draw()
	quickmenu.draw()
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

function engine.enlist(value)
	registry.instance:register(value)
end

function engine.delist(id)
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

function $.emit(name_or_event, emitter, payload, ...)
	if type(name_or_event) == "native" and name_or_event.type == nil then
		name_or_event, emitter, payload = emitter, payload, select(1, ...)
	end
	local kind = type(name_or_event)
	if kind == "table" then
		if name_or_event.type == nil then
			error("engine.emit: event is missing type")
		end
		return eventemitter.instance:emit(name_or_event)
	end
	if kind == "native" then
		local event_type = name_or_event.type
		if event_type == nil then
			error("engine.emit: event is missing type")
		end
		local event = {}
		event.type = tostring(event_type)
		for k, v in pairs(name_or_event) do
			if k ~= "type" then
				event[k] = v
			end
		end
		return eventemitter.instance:emit(event)
	end
	return eventemitter.instance:emit(name_or_event, emitter, payload)
end

require("audio_router").init()

if not world._ecs_pipeline_built then
	world._ecs_pipeline_built = true
	world:apply_default_pipeline()
end

return engine
