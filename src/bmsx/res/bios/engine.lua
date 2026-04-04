-- engine.lua
-- lua engine facade for system rom
--
-- NOTE FOR CART AUTHORS:
-- Do not `require('engine')` from cart code and do not call `engine.*`.
-- Carts must use cart-facing globals/helpers (`oget`, `rget`, `inst`,
-- `update`, `reset`, `add_space`, `set_space`, `get_space`, `define_fsm`, `define_effect`,
-- etc.) that are injected by the runtime.
-- Keep cart identifier strings compact. Redundant long prefixes in tags/events/effects/
-- timeline IDs are forbidden when short local IDs are sufficient (string memory + compare
-- cost is part of the console budget).
-- Do not create local aliases/copies of global constants in cart code (for example
-- `local p = constants.physics`): read constants directly from their source table/global.
-- This module is BIOS/runtime plumbing.

local world_module<const> = require('world')
local ecs_builtin<const> = require('ecs_builtin')
local ecs_pipeline<const> = require('ecs_pipeline')
local worldobject<const> = require('worldobject')
local subsystem<const> = require('subsystem')
local spriteobject<const> = require('sprite')
local textobject<const> = require('textobject')
local fsmlibrary<const> = require('fsmlibrary')
local action_effects<const> = require('action_effects')
local components<const> = require('components')
local registry<const> = require('registry')
local eventemitter_module<const> = require('eventemitter')
local eventemitter<const> = eventemitter_module.eventemitter
eventemitter_module.eventemitter = eventemitter
eventemitter_module.instance = eventemitter.instance
local quickmenu<const> = require('quickmenu')
local resource_usage_gizmo<const> = require('resource_usage_gizmo')
-- local ide_editor = require('ide_editor')
local bool01<const> = require('bool01')
local deep_clone<const> = require('deep_clone')
local velocity<const> = require('velocity')
local rect_overlaps<const> = require('rect_overlaps')
local clamp_int<const> = require('clamp_int')
local clear_map<const> = require('clear_map')
local scratchbatch<const> = require('scratchbatch')
local sorted_scratchbatch<const> = require('sorted_scratchbatch')
local div_toward_zero<const> = require('div_toward_zero')
local round_to_nearest<const> = require('round_to_nearest')
local rol8<const> = require('rol8')
local swap_remove<const> = require('swap_remove')
local timeline<const> = require('timeline')
local audio_router<const> = require('audio_router')
local progression<const> = require('progression')

local world_instance<const> = world_module.instance

local definitions<const> = {}
local subsystem_definitions<const> = {}
local component_definitions<const> = {}
local vdp_load_job_seq = 0
local vdp_load_queue<const> = {}
local vdp_load_queue_head
local vdp_load_queue_tail
local vdp_active_job
local vdp_load_handler
local cart_irq_handler
local cart_irq_handlers<const> = {}
local sys_atlas_id<const> = 254
vdp_stream_cursor = sys_vdp_stream_base
vdp_stream_limit = sys_vdp_stream_base + (sys_vdp_stream_capacity_words * sys_vdp_arg_stride)

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

local vdp_dequeue_job<const> = function()
	if vdp_load_queue_head == nil or vdp_load_queue_tail == nil then
		return nil
	end
	if vdp_load_queue_head > vdp_load_queue_tail then
		return nil
	end
	local job<const> = vdp_load_queue[vdp_load_queue_head]
	vdp_load_queue[vdp_load_queue_head] = nil
	vdp_load_queue_head = vdp_load_queue_head + 1
	if vdp_load_queue_head > vdp_load_queue_tail then
		vdp_load_queue_head = nil
		vdp_load_queue_tail = nil
	end
	return job
end

local vdp_start_job<const> = function(job)
	vdp_active_job = job
	mem[sys_img_src] = job.src
	mem[sys_img_len] = job.len
	mem[sys_img_dst] = job.dst
	mem[sys_img_cap] = job.cap
	mem[sys_img_ctrl] = img_ctrl_start
end

local vdp_try_start_next_job<const> = function()
	if vdp_active_job ~= nil then
		return
	end
	local status<const> = mem[sys_img_status]
	if (status & img_status_busy) ~= 0 then
		return
	end
	local job<const> = vdp_dequeue_job()
	if job == nil then
		return
	end
	vdp_start_job(job)
end

local vdp_stream_capacity_bytes<const> = sys_vdp_stream_capacity_words * sys_vdp_arg_stride
local vdp_stream_claim_words<const> = function(word_count)
	local base<const> = vdp_stream_cursor
	local bytes<const> = word_count * sys_vdp_arg_stride
	local next<const> = base + bytes
	if next > sys_vdp_stream_base + vdp_stream_capacity_bytes then
		error('vdp_stream overflow (' .. tostring(next - sys_vdp_stream_base) .. ' > ' .. tostring(vdp_stream_capacity_bytes) .. ')')
	end
	vdp_stream_cursor = next
	return base
end

local ensure_component_type<const> = function(def_id, def)
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
		local class_table<const> = def.class
		apply_class_addons(self, class_table)
		apply_ctor(self, class_table, opts, def_id)
		return self
	end
	components.register_component(def_id, luacomponent)
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

local engine<const> = {}
engine.bool01 = bool01
engine.clear_map = clear_map
engine.scratchbatch = scratchbatch
engine.sorted_scratchbatch = sorted_scratchbatch
engine.vdp_stream_claim_words = vdp_stream_claim_words
engine.consume_axis_accum = velocity.consume_axis_accum
engine.deep_clone = deep_clone
engine.set_velocity = velocity.set_velocity
engine.move_with_velocity = velocity.move_with_velocity
engine.rect_overlaps = rect_overlaps
engine.clamp_int = clamp_int
engine.div_toward_zero = div_toward_zero
engine.round_to_nearest = round_to_nearest
engine.rol8 = rol8
engine.swap_remove = swap_remove
engine.timeline = timeline

function engine.define_fsm(id, blueprint)
	fsmlibrary.register(id, blueprint)
end

function engine.define_prefab(definition)
	if type(definition.class) ~= 'table' then
		error('define_prefab: definition.class must be a table for "' .. tostring(definition.def_id) .. '".')
	end
	definitions[definition.def_id] = definition
end

function engine.define_subsystem(definition)
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

function engine.define_component(definition)
	if type(definition.class) ~= 'table' then
		error('define_component: definition.class must be a table for "' .. tostring(definition.def_id) .. '".')
	end
	component_definitions[definition.def_id] = definition
	ensure_component_type(definition.def_id, definition)
end

function engine.define_effect(definition, opts)
	action_effects.register_effect(definition, opts)
end

function engine.vdp_map_slot(slot, atlas_id)
	if atlas_id == nil then
		atlas_id = sys_vdp_atlas_none
	end
	if slot == 0 then
		mem[sys_vdp_primary_atlas_id] = atlas_id
		return
	end
	if slot == 1 then
		mem[sys_vdp_secondary_atlas_id] = atlas_id
		return
	end
	error('vdp_map_slot: invalid slot ' .. tostring(slot))
end

function engine.vdp_load_slot(slot, atlas_id)
	if vdp_load_queue_head == nil then
		vdp_load_queue_head = 1
		vdp_load_queue_tail = 0
	end
	local atlas_name<const> = string.format('_atlas_%02d', atlas_id)
	local rom_base<const>, start<const>, finish<const> = resolve_cart_rom_asset_range(atlas_name)
	local src<const> = rom_base + start
	local len<const> = finish - start
	local dst
	local cap
	if slot == 0 then
		dst = sys_vram_primary_atlas_base
		cap = sys_vram_primary_atlas_size
	elseif slot == 1 then
		dst = sys_vram_secondary_atlas_base
		cap = sys_vram_secondary_atlas_size
	else
		error('vdp_load_slot: invalid slot ' .. tostring(slot))
	end
	vdp_load_job_seq = vdp_load_job_seq + 1
	vdp_load_queue_tail = vdp_load_queue_tail + 1
	vdp_load_queue[vdp_load_queue_tail] = {
		job_id = vdp_load_job_seq,
		slot = slot,
		atlas_id = atlas_id,
		allow_handler = true,
		src = src,
		len = len,
		dst = dst,
		cap = cap,
	}
	vdp_try_start_next_job()
	return vdp_load_job_seq
end

function engine.vdp_load_sys_atlas()
	if vdp_load_queue_head == nil then
		vdp_load_queue_head = 1
		vdp_load_queue_tail = 0
	end
	local atlas_name<const> = string.format('_atlas_%02d', sys_atlas_id)
	local rom_base<const>, start<const>, finish<const> = resolve_sys_rom_asset_range(atlas_name)
	local src<const> = rom_base + start
	local len<const> = finish - start
	vdp_load_job_seq = vdp_load_job_seq + 1
	vdp_load_queue_tail = vdp_load_queue_tail + 1
	vdp_load_queue[vdp_load_queue_tail] = {
		job_id = vdp_load_job_seq,
		slot = nil,
		atlas_id = sys_atlas_id,
		allow_handler = false,
		src = src,
		len = len,
		dst = sys_vram_system_atlas_base,
		cap = sys_vram_system_atlas_size,
	}
	vdp_try_start_next_job()
	return vdp_load_job_seq
end

function engine.inst(definition_id, addons)
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

function engine.inst_subsystem(definition_id, addons)
	local def<const> = subsystem_definitions[definition_id]
	local class_table<const> = def.class
	local instance_id<const> = (addons and addons.id) or class_table.id or definition_id
	local instance<const> = subsystem.subsystem.new({ id = instance_id, type_name = definition_id })
	apply_subsystem_definition(instance, def, addons)
	world_instance:spawn_subsystem(instance)
	return instance
end

-- Runtime binds global `oget(id)` to this function.
-- Cart code must call `oget(id)` and must not call `engine.oget(id)` directly.
function engine.oget(id)
	return world_instance:get(id)
end

-- Runtime binds global `rget(id)` to this function.
-- Cart code must call `rget(id)` and must not call `engine.rget(id)` directly.
function engine.rget(id)
	return registry.instance:get(id)
end

function engine.subsystem(id)
	return world_instance:get_subsystem(id)
end

function engine.add_space(space_id)
	return world_instance:add_space(space_id)
end

function engine.set_space(space_id)
	return world_instance:set_space(space_id)
end

function engine.get_space()
	return world_instance:get_space()
end

function engine.objects_by_type(type_name, opts)
	return world_instance:objects_by_type(type_name, opts)
end

function engine.objects_by_tag(tag, opts)
	return world_instance:objects_by_tag(tag, opts)
end

function engine.find_by_type(type_name, opts)
	return world_instance:find_by_type(type_name, opts)
end

function engine.find_by_tag(tag, opts)
	return world_instance:find_by_tag(tag, opts)
end

function engine.attach_component(object_or_id, component_or_type)
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

function engine.update()
	-- if ide_editor.is_enabled() then
	-- 	ide_editor.update()
	-- 	if ide_editor.is_open() then
	-- 		ide_editor.draw()
	-- 		return
	-- 	end
	-- end
	quickmenu.update()
	if not quickmenu.is_open() then
		world_instance:update()
	end
	world_instance:draw()
	if not quickmenu.is_open() then
		resource_usage_gizmo.draw()
	end
	quickmenu.draw()
end

function engine.irq(flags)
	local ack = 0
	local fatal
	if (flags & irq_img_done) ~= 0 then
		ack = ack | irq_img_done
		if vdp_active_job == nil then
			fatal = 'irq: img_DONE without pending atlas load'
		else
			local skip_map
			local allow_handler = vdp_active_job.allow_handler
			if allow_handler == nil then
				allow_handler = true
			end
			if allow_handler and vdp_load_handler ~= nil then
				local should_skip<const> = vdp_load_handler(vdp_active_job.job_id, vdp_active_job.slot, vdp_active_job.atlas_id, 'done')
				if should_skip then
					skip_map = true
				end
			end
			if vdp_active_job.slot ~= nil and not skip_map then
				vdp_map_slot(vdp_active_job.slot, vdp_active_job.atlas_id)
			end
			vdp_active_job = nil
			vdp_try_start_next_job()
		end
	end
	if (flags & irq_img_error) ~= 0 then
		ack = ack | irq_img_error
		if vdp_active_job == nil then
			fatal = 'irq: img_ERROR without pending atlas load'
		else
			local allow_handler = vdp_active_job.allow_handler
			if allow_handler == nil then
				allow_handler = true
			end
			if allow_handler and vdp_load_handler ~= nil then
				vdp_load_handler(vdp_active_job.job_id, vdp_active_job.slot, vdp_active_job.atlas_id, 'error')
			end
			vdp_active_job = nil
			fatal = 'irq: IMGDEC failed while loading atlas'
		end
	end
	ack = ack | (flags & ~(irq_img_done | irq_img_error))
	if fatal == nil then
		if cart_irq_handler ~= nil then
			cart_irq_handler(flags)
		end
		for mask, handler in pairs(cart_irq_handlers) do
			if mask ~= irq_reinit and mask ~= irq_newgame and (flags & mask) ~= 0 then
				handler(flags & mask, flags)
			end
		end
		if (flags & irq_reinit) ~= 0 then
			local reinit_handler<const> = cart_irq_handlers[irq_reinit]
			if reinit_handler ~= nil then
				reinit_handler(flags & irq_reinit, flags)
			else
				init()
			end
		end
		if (flags & irq_newgame) ~= 0 then
			local newgame_handler<const> = cart_irq_handlers[irq_newgame]
			if newgame_handler ~= nil then
				newgame_handler(flags & irq_newgame, flags)
			else
				engine.reset()
				new_game()
			end
		end
	end
	if ack ~= 0 then
		mem[sys_irq_ack] = ack
	end
	if fatal ~= nil then
		error(fatal)
	end
end

function engine.on_irq(mask_or_handler, handler)
	if type(mask_or_handler) == 'number' then
		local mask<const> = mask_or_handler
		if handler == nil then
			cart_irq_handlers[mask] = nil
			return
		end
		if type(handler) ~= 'function' then
			error('on_irq: handler must be a function')
		end
		cart_irq_handlers[mask] = handler
		return
	end
	if mask_or_handler == nil then
		cart_irq_handler = nil
		return
	end
	if type(mask_or_handler) ~= 'function' then
		error('on_irq: handler must be a function')
	end
	cart_irq_handler = mask_or_handler
end

function engine.on_vdp_load(handler)
	if handler == nil then
		vdp_load_handler = nil
		return
	end
	if type(handler) ~= 'function' then
		error('on_vdp_load: handler must be a function')
	end
	vdp_load_handler = handler
end

function engine.reset()
	world_instance:clear()
	registry.instance:clear()
	ecs_builtin.register_builtin_ecs()
	ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())
end

function engine.configure_ecs(nodes)
	return ecs_pipeline.defaultecspipelineregistry:build(world_instance, nodes)
end

function engine.apply_default_pipeline()
	ecs_builtin.register_builtin_ecs()
	return ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())
end

function engine.enlist(value)
	registry.instance:register(value)
end

function engine.delist(id)
	registry.instance:deregister(id)
end

function engine.get_definitions()
	return definitions
end

function engine.get_definition(def_id)
	return definitions[def_id]
end

function engine.get_subsystem_definitions()
	return subsystem_definitions
end

function engine.get_subsystem_definition(def_id)
	return subsystem_definitions[def_id]
end

function engine.get_component_definitions()
	return component_definitions
end

function engine.get_component_definition(def_id)
	return component_definitions[def_id]
end

function engine.get_fsm_definitions()
	return fsmlibrary.definitions()
end

function engine.get_fsm_definition(fsm_id)
	return fsmlibrary.get(fsm_id)
end

function engine.grant_effect(object_id, effect_id)
	local obj<const> = world_instance:get(object_id)
	local component<const> = obj:get_component('actioneffectcomponent')
	if not component then
		error('world object "' .. object_id .. '" does not have an actioneffectcomponent.')
	end
	component:grant_effect(effect_id)
end

function engine.trigger_effect(object_id, effect_id, options)
	local obj<const> = world_instance:get(object_id)
	local component<const> = obj:get_component('actioneffectcomponent')
	if not component then
		error('world object "' .. object_id .. '" does not have an actioneffectcomponent.')
	end
	local payload<const> = options and options.payload
	if payload ~= nil then
		return component:trigger(effect_id, { payload = payload })
	end
	return component:trigger(effect_id)
end

audio_router.init()
progression.init()

-- Register BIOS singletons as persistent registry entries.
-- This mirrors the TS engine where all subsystems (PhysicsWorld, SoundMaster,
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
register_singleton(audio_router, 'audiorouter', 'audiorouter')
register_singleton(action_effects, 'actioneffects', 'actioneffects')

if not world_instance._ecs_pipeline_built then
	world_instance._ecs_pipeline_built = true
	ecs_builtin.register_builtin_ecs()
	ecs_pipeline.defaultecspipelineregistry:build(world_instance, ecs_builtin.default_pipeline_spec())
end

engine.eventemitter = eventemitter_module
engine.eventemitter_module = eventemitter_module

return engine
