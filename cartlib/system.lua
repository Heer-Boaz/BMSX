-- cartlib/system.lua
-- Cart-bundled shared library facade. This is not part of the BIOS ROM.

local world_module<const> = require('cartlib/world/index')
local ecs_builtin<const> = require('cartlib/ecs/builtin')
local ecs_pipeline<const> = require('cartlib/ecs/pipeline')
local worldobject<const> = require('cartlib/world/object')
local subsystem<const> = require('cartlib/subsystem/index')
local spriteobject<const> = require('cartlib/sprite')
local textobject<const> = require('cartlib/text/object')
local fsmlibrary<const> = require('cartlib/fsm/library')
local action_effects<const> = require('cartlib/action_effects')
local components<const> = require('cartlib/components')
local registry<const> = require('cartlib/registry')
local eventemitter_module<const> = require('cartlib/eventemitter')
local eventemitter<const> = eventemitter_module.eventemitter
eventemitter_module.eventemitter = eventemitter
eventemitter_module.instance = eventemitter.instance
local deep_clone<const> = require('bios/util/deep_clone')
local velocity<const> = require('bios/util/velocity')
local clear_map<const> = require('bios/util/clear_map')
local swap_remove<const> = require('bios/util/swap_remove')
local timeline<const> = require('cartlib/timeline/index')
local aem<const> = require('cartlib/aem')
local progression<const> = require('cartlib/progression')
local font_module<const> = require('cartlib/font')
local vdp_rpu_quads<const> = require('system/vdp_rpu_quads')
local vdp_image<const> = require('system/vdp_image')
local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('system/gx_image')
local cart_input<const> = require('cartlib/input/player')

local irq_ack_addr<const> = 0x08000108
local irq_apu<const> = 0x0200

local world_instance<const> = world_module.instance

local definitions<const> = {}
local subsystem_definitions<const> = {}
local component_definitions<const> = {}
local cart_irq_handlers<const> = {}
mem[0x0800000c] = 0xffffffff
mem[0x08000010] = 0xffffffff

local excluded_class_keys<const> = {
	def_id = true,
	class = true,
	defaults = true,
	metatable = true,
	ctor = true,
	constructor = true,
	prototype = true,
	super = true,
	__index = true,
}

local apply_defaults<const> = function(instance, defaults, skip_key)
	if not defaults then
		return
	end
	for k, v in pairs(defaults) do
		if k ~= skip_key then
			instance[k] = v
		end
	end
end

local apply_class_addons<const> = function(instance, class_table)
	if not class_table then
		return
	end
	for k, v in pairs(class_table) do
		if not excluded_class_keys[k] then
			instance[k] = v
		end
	end
end

local apply_class_prototype<const> = function(instance, class_table)
	if class_table == nil then
		return
	end
	local shared_mt<const> = getmetatable(instance)
	if shared_mt == nil then
		error('apply_class_prototype: instance is missing a metatable.')
	end
	local base_index<const> = shared_mt.__index
	if base_index == nil then
		error('apply_class_prototype: instance metatable is missing __index.')
	end
	local class_mt = getmetatable(class_table)
	if class_mt == nil then
		class_mt = { __index = base_index }
		setmetatable(class_table, class_mt)
	elseif class_mt.__index == nil then
		class_mt.__index = base_index
		setmetatable(class_table, class_mt)
	end
	local instance_mt<const> = { __index = class_table }
	for key, value in pairs(shared_mt) do
		if key ~= '__index' and type(key) == 'string' and key:sub(1, 2) == '__' then
			instance_mt[key] = value
		end
	end
	setmetatable(instance, instance_mt)
end

local apply_addons<const> = function(instance, addons, skip_keys)
	if not addons then
		return
	end
	for k, v in pairs(addons) do
		if not skip_keys[k] then
			instance[k] = v
		end
	end
end

local apply_ctor<const> = function(instance, class_table, ctor_args, def_id)
	local ctor<const> = class_table.ctor or class_table.constructor
	if ctor then
		ctor(instance, ctor_args, def_id)
	end
end

local attach_components<const> = function(instance, list)
	if not list then
		return
	end
	for i = 1, #list do
		local entry<const> = list[i]
		if type(entry) == 'string' then
			local comp<const> = components.new_component(entry, { parent = instance })
			instance:add_component(comp)
		elseif type(entry) == 'table' and entry.type_name then
			local comp<const> = entry
			comp.parent = instance
			instance:add_component(comp)
		end
	end
end

local attach_fsms<const> = function(instance, fsms)
	if not fsms then
		return
	end
	for i = 1, #fsms do
		local id<const> = fsms[i]
		instance.sc:add_statemachine(id, fsmlibrary.get(id))
	end
end

local attach_effects<const> = function(instance, effects)
	if not effects or #effects == 0 then
		return
	end
	local component<const> = action_effects.actioneffectcomponent.new({ parent = instance })
	instance:add_component(component)
	for i = 1, #effects do
		component:grant_effect(effects[i])
	end
	instance.actioneffects = component
end

local attach_bts<const> = function(instance, bts)
	if not bts then
		return
	end
	for i = 1, #bts do
		instance:add_btree(bts[i])
	end
end

local apply_definition<const> = function(instance, def, addons, skip_key)
	local class_table<const> = def.class
	apply_defaults(instance, def.defaults, skip_key)
	apply_class_prototype(instance, class_table)
	attach_components(instance, def.components)
	attach_fsms(instance, def.fsms)
	attach_effects(instance, def.effects)
	attach_bts(instance, def.bts)
	local skip_keys<const> = { pos = true }
	if skip_key then
		skip_keys[skip_key] = true
	end
	apply_addons(instance, addons, skip_keys)
	apply_ctor(instance, class_table, addons, def.def_id)
end

local apply_subsystem_definition<const> = function(instance, def, addons)
	local class_table<const> = def.class
	apply_defaults(instance, def.defaults)
	apply_class_prototype(instance, class_table)
	attach_fsms(instance, def.fsms)
	apply_addons(instance, addons, {})
	apply_ctor(instance, class_table, addons, def.def_id)
end

local system<const> = {}
system.clear_map = clear_map
system.vdp_stream_claim = vdp_stream_claim
system.vdp_stream_finish = vdp_rpu_quads.finish_frame
system.vdp_clear_color = vdp_rpu_quads.clear_color
system.vdp_fill_rect_color = vdp_rpu_quads.fill_rect_color
system.vdp_draw_line_color = vdp_rpu_quads.draw_line_color
system.vdp_tile_run_sources = vdp_rpu_quads.tile_run_sources
system.vdp_load_atlas = vdp_image.load_atlas
system.gx_reset_320x240_pal = gx_gpu.reset_320x240_pal
system.gx_reset_256x192_pal = gx_gpu.reset_256x192_pal
system.gx_load_atlas = gx_image.load_atlas
system.gx_upload_atlas = gx_image.upload_atlas
system.gx_blit_img_color = gx_image.blit_img_color
system.gx_img_rect = gx_image.rect
system.gx_clear_color = gx_gpu.clear_color
system.gx_fill_rect_color = gx_gpu.fill_rect_color
system.gx_set_draw_mode = gx_gpu.set_draw_mode
system.gx_fill_rect_semitrans_color = gx_gpu.fill_rect_semitrans_color
system.gx_draw_mode_blend_half = gx_gpu.draw_mode_blend_half
system.gx_draw_mode_blend_add = gx_gpu.draw_mode_blend_add
system.gx_draw_mode_blend_subtract = gx_gpu.draw_mode_blend_subtract
system.gx_draw_mode_blend_quarter = gx_gpu.draw_mode_blend_quarter
system.gx_draw_line_color = gx_gpu.draw_line_color
system.gx_display_width = gx_gpu.display_width
system.gx_display_height = gx_gpu.display_height
function system.vdp_blit_img_color(imgid, x, y, z, layer, scale_x, scale_y, flip_flags, color)
	local rect<const> = vdp_image.rect(imgid)
	vdp_rpu_quads.blit_source_color(rect.atlas_id, rect.u, rect.v, rect.w, rect.h, x, y, z, layer, scale_x, scale_y, flip_flags, color)
end
function system.vdp_blit_img_affine_color(imgid, origin_x, origin_y, z, layer, axis_xx, axis_xy, axis_yx, axis_yy, flip_flags, color)
	local rect<const> = vdp_image.rect(imgid)
	vdp_rpu_quads.blit_source_affine_color(rect.atlas_id, rect.u, rect.v, rect.w, rect.h, origin_x, origin_y, z, layer, axis_xx, axis_xy, axis_yx, axis_yy, flip_flags, color)
end
function system.vdp_glyph_color(glyph, x, y, z, layer, color)
	local rect<const> = vdp_image.rect(glyph.imgid)
	vdp_rpu_quads.blit_source_color(rect.atlas_id, rect.u, rect.v, rect.w, rect.h, x, y, z, layer, 1, 1, 0, color)
end
system.vdp_img_rect = vdp_image.rect
system.vdp_write_source = vdp_image.write_source
system.font = font_module
system.input = cart_input
system.consume_axis_accum = velocity.consume_axis_accum
system.deep_clone = deep_clone
system.set_velocity = velocity.set_velocity
system.move_with_velocity = velocity.move_with_velocity
system.swap_remove = swap_remove
system.timeline = timeline

function system.define_fsm(id, blueprint)
	fsmlibrary.register(id, blueprint)
end

function system.define_prefab(definition)
	if type(definition.class) ~= 'table' then
		error('define_prefab: definition.class must be a table for "' .. tostring(definition.def_id) .. '".')
	end
	definitions[definition.def_id] = definition
end

function system.define_subsystem(definition)
	if type(definition.class) ~= 'table' then
		error('define_subsystem: definition.class must be a table for "' .. tostring(definition.def_id) .. '".')
	end
	if definition.components ~= nil then
		error('define_subsystem: subsystem "' .. tostring(definition.def_id) .. '" cannot declare components.')
	end
	if definition.effects ~= nil then
		error('define_subsystem: subsystem "' .. tostring(definition.def_id) .. '" cannot declare effects.')
	end
	if definition.bts ~= nil then
		error('define_subsystem: subsystem "' .. tostring(definition.def_id) .. '" cannot declare behaviour trees.')
	end
	subsystem_definitions[definition.def_id] = definition
end

function system.define_component(definition)
	if type(definition.class) ~= 'table' then
		error('define_component: definition.class must be a table for "' .. tostring(definition.def_id) .. '".')
	end
	if definition.class.update ~= nil then
		error('define_component: component "' .. tostring(definition.def_id) .. '" cannot declare update(); move frame work into an ECS system or FSM.')
	end
	local def_id<const> = definition.def_id
	component_definitions[def_id] = definition
	if components.componentregistry[def_id] then
		return
	end
	local luacomponent<const> = {}
	luacomponent.__index = luacomponent
	setmetatable(luacomponent, { __index = components.component })
	function luacomponent.new(opts)
		opts = opts or {}
		opts.type_name = def_id
		local self<const> = setmetatable(components.component.new(opts), luacomponent)
		local class_table<const> = definition.class
		apply_class_addons(self, class_table)
		apply_ctor(self, class_table, opts, def_id)
		return self
	end
	components.register_component(def_id, luacomponent)
end

function system.define_effect(definition, opts)
	action_effects.register_effect(definition, opts)
end

function system.inst(definition_id, addons)
	local def<const> = definitions[definition_id]
	local object_type<const> = def.type
	if object_type == 'sprite' then
		local class_table<const> = def.class
		local instance_id<const> = (addons and addons.id) or class_table.id
		local instance<const> = spriteobject.new({ id = instance_id })
		instance.type_name = definition_id
		apply_definition(instance, def, addons, 'imgid')
		local defaults<const> = def.defaults
		local imgid<const> = (addons and addons.imgid) or (defaults and defaults.imgid)
		if imgid then
			instance:gfx(imgid)
		end
		world_instance:spawn(instance, addons and addons.pos)
		return instance
	end
	if object_type == 'textobject' then
		local class_table<const> = def.class
		local instance_id<const> = (addons and addons.id) or class_table.id
		local ctor_opts<const> = {}
		local defaults<const> = def.defaults
		apply_defaults(ctor_opts, defaults)
		apply_addons(ctor_opts, addons, { pos = true })
		ctor_opts.id = instance_id
		local instance<const> = textobject.new(ctor_opts)
		instance.type_name = definition_id
		apply_definition(instance, def, addons, 'dimensions')
		local dimensions<const> = (addons and addons.dimensions) or (defaults and defaults.dimensions)
		if dimensions then
			instance:set_dimensions(dimensions)
		end
		world_instance:spawn(instance, addons and addons.pos)
		return instance
	end
	local class_table<const> = def.class
	local instance_id<const> = (addons and addons.id) or class_table.id
	local instance<const> = worldobject.new({ id = instance_id })
	instance.type_name = definition_id
	apply_definition(instance, def, addons)
	world_instance:spawn(instance, addons and addons.pos)
	return instance
end

function system.inst_subsystem(definition_id, addons)
	local def<const> = subsystem_definitions[definition_id]
	local class_table<const> = def.class
	local instance_id<const> = (addons and addons.id) or class_table.id or definition_id
	local instance<const> = subsystem.subsystem.new({ id = instance_id, type_name = definition_id })
	apply_subsystem_definition(instance, def, addons)
	world_instance:spawn_subsystem(instance)
	return instance
end

-- Runtime binds global `oget(id)` to this function.
-- Cart code must call `oget(id)` and must not call `system.oget(id)` directly.
function system.oget(id)
	return world_instance:get(id)
end

-- Runtime binds global `rget(id)` to this function.
-- Cart code must call `rget(id)` and must not call `system.rget(id)` directly.
function system.rget(id)
	return registry.instance:get(id)
end

function system.subsystem(id)
	return world_instance:get_subsystem(id)
end

function system.add_space(space_id)
	return world_instance:add_space(space_id)
end

function system.set_space(space_id)
	return world_instance:set_space(space_id)
end

function system.get_space()
	return world_instance.active_space_id
end

function system.objects_by_type(type_name)
	return world_instance:objects_by_type(type_name)
end

function system.all_objects_by_type(type_name)
	return world_instance:all_objects_by_type(type_name)
end

function system.objects_by_tag(tag)
	return world_instance:objects_by_tag(tag)
end

function system.all_objects_by_tag(tag)
	return world_instance:all_objects_by_tag(tag)
end

function system.find_by_type(type_name)
	return world_instance:find_by_type(type_name)
end

function system.find_any_by_type(type_name)
	return world_instance:find_any_by_type(type_name)
end

function system.find_by_tag(tag)
	return world_instance:find_by_tag(tag)
end

function system.find_any_by_tag(tag)
	return world_instance:find_any_by_tag(tag)
end

function system.attach_component(object_or_id, component_or_type)
	local obj<const> = type(object_or_id) == 'string' and world_instance:get(object_or_id) or object_or_id
	if type(component_or_type) == 'table' and component_or_type.type_name then
		obj:add_component(component_or_type)
		return component_or_type
	end
	if type(component_or_type) == 'string' then
		local comp<const> = components.new_component(component_or_type, { parent = obj })
		obj:add_component(comp)
		return comp
	end
	error('attach_component expects a component instance or type name')
end

function system.update_world()
	world_instance:update()
end

function system.draw_world()
	world_instance:draw()
end

function system.irq(flags)
	local ack = 0
	for mask, handler in pairs(cart_irq_handlers) do
		if (flags & mask) ~= 0 then
			handler(flags & mask, flags)
			ack = ack | (flags & mask)
		end
	end
	if ack ~= 0 then
		mem[irq_ack_addr] = ack
	end
end

function system.on_irq(mask, handler)
	if type(mask) ~= 'number' then
		error('on_irq: mask must be a number')
	end
	if handler == nil then
		cart_irq_handlers[mask] = nil
		return
	end
	if type(handler) ~= 'function' then
		error('on_irq: handler must be a function')
	end
	cart_irq_handlers[mask] = handler
end

function system.reset()
	world_instance:clear()
	registry.instance:clear()
	ecs_builtin.register_builtin_ecs()
	ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())
end

function system.configure_ecs(nodes)
	return ecs_pipeline.defaultecspipelineregistry:build(world_instance, nodes)
end

function system.apply_default_pipeline()
	ecs_builtin.register_builtin_ecs()
	return ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())
end

function system.enlist(value)
	registry.instance:register(value)
end

function system.delist(id)
	registry.instance:deregister(id)
end

function system.get_definitions()
	return definitions
end

function system.get_definition(def_id)
	return definitions[def_id]
end

function system.get_subsystem_definitions()
	return subsystem_definitions
end

function system.get_subsystem_definition(def_id)
	return subsystem_definitions[def_id]
end

function system.get_component_definitions()
	return component_definitions
end

function system.get_component_definition(def_id)
	return component_definitions[def_id]
end

function system.get_fsm_definitions()
	return fsmlibrary.definitions()
end

function system.get_fsm_definition(fsm_id)
	return fsmlibrary.get(fsm_id)
end

function system.grant_effect(object_id, effect_id)
	local obj<const> = world_instance:get(object_id)
	local component<const> = obj:get_component('actioneffectcomponent')
	if not component then
		error('world object "' .. object_id .. '" does not have an actioneffectcomponent.')
	end
	component:grant_effect(effect_id)
end

function system.trigger_effect(object_id, effect_id, options)
	local obj<const> = world_instance:get(object_id)
	local component<const> = obj:get_component('actioneffectcomponent')
	if not component then
		error('world object "' .. object_id .. '" does not have an actioneffectcomponent.')
	end
	return component:trigger(effect_id, options and options.payload)
end

system.on_irq(irq_apu, function()
	aem.on_apu_irq()
end)
aem.reload()

-- Register BIOS singletons as persistent registry entries.
-- This mirrors the TS system where all subsystems (PhysicsWorld, SoundMaster,
-- Input, Services, etc.) are registered so they are discoverable and inspectable.
local registry_instance<const> = registry.instance
local register_singleton<const> = function(obj, id, tn)
	obj.id = id
	obj.type_name = tn
	obj.registrypersistent = true
	registry_instance:register(obj)
end
register_singleton(ecs_pipeline.defaultecspipelineregistry, 'ecspipeline', 'ecspipeline')
register_singleton(fsmlibrary, 'fsmlibrary', 'fsmlibrary')
register_singleton(progression, 'progression', 'progression')
register_singleton(aem, 'aem', 'aem')
register_singleton(action_effects, 'actioneffects', 'actioneffects')

ecs_builtin.register_builtin_ecs()
ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())

system.eventemitter = eventemitter_module
system.eventemitter_module = eventemitter_module

return system
