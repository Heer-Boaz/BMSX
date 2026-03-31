-- input_action_effect_system.lua
-- input intent + input action effect ecs system

local ecs<const> = require('ecs')
local action_effects<const> = require('action_effects')
local compiler<const> = require('input_action_effect_compiler')
local dsl<const> = require('input_action_effect_dsl')
local scratchbatch<const> = require('scratchbatch')
local world_instance<const> = require('world').instance
local inputintentcomponent<const> = 'inputintentcomponent'
local inputactioneffectcomponent<const> = 'inputactioneffectcomponent'
local actioneffectcomponentid<const> = 'actioneffectcomponent'
local assigned_value_edges<const> = { ['hold'] = true, ['press'] = true }
local active_scope<const> = { scope = 'active' }

local asset_programs_validated = false

local run_effect<const> = function(effect, env)
	if not effect then
		return false
	end
	effect(env)
	return true
end

local validate_primary_assets_on_boot<const> = function()
	if asset_programs_validated then
		return
	end
	for id, value in pairs(assets.data) do
		if dsl.is_input_action_effect_program(value) then
			compiler.validate_program_effects(value, id)
		end
	end
	asset_programs_validated = true
end

local inputactioneffectsystem<const> = {}
inputactioneffectsystem.__index = inputactioneffectsystem
setmetatable(inputactioneffectsystem, { __index = ecs.ecsystem })

function inputactioneffectsystem.new(priority)
	local self<const> = setmetatable(ecs.ecsystem.new(ecs.tickgroup.input, priority or 0), inputactioneffectsystem)
	self.compiled_by_id = {}
	self.inline_compiled = setmetatable({}, { __mode = 'k' })
	self.validated_inline = setmetatable({}, { __mode = 'k' })
	self.resolved_programs = {}
	self.missing_program_ids = {}
	self.pattern_cache = {}
	self.pattern_cache_max = 256
	self.custom_match_scratch = scratchbatch.new()
	self.runtime_by_component = setmetatable({}, { __mode = 'k' })
	self.frame_serial = 0
	self.__ecs_id = 'inputactioneffectsystem'
	validate_primary_assets_on_boot()
	return self
end

function inputactioneffectsystem:update()
	self.frame_serial = self.frame_serial + 1
	self:process_input_intents()
	self:process_input_action_programs()
end

function inputactioneffectsystem:process_input_intents()
	for obj, component in world_instance:objects_with_components(inputintentcomponent, active_scope) do
		if not (obj.active) then
			goto continue
		end
		if not component.bindings or #component.bindings == 0 then
			goto continue
		end
		local player_index<const> = self:resolve_intent_player_index(component, obj)
		for i = 1, #component.bindings do
			self:evaluate_intent_binding(obj, player_index, component.bindings[i])
		end
		::continue::
	end
end

function inputactioneffectsystem:process_input_action_programs()
	for obj, component in world_instance:objects_with_components(inputactioneffectcomponent, active_scope) do
		if not (obj.active) then
			goto continue
		end
		local program<const> = self:resolve_compiled_program(component)
		local program_key<const> = self:resolve_program_key(component, obj)

		local player_index<const> = obj.player_index or 1
		local effects<const> = obj:get_component(actioneffectcomponentid)
		if (not effects) and program.uses_effect_triggers then
			error('[inputactioneffectsystem] program "' .. program_key .. '" triggers effects but object "' .. obj.id .. '" has no actioneffectcomponent.')
		end

		local owner_id<const> = effects and effects.parent.id or obj.id
		local component_runtime<const> = self:resolve_component_runtime(component)
		local env<const> = component_runtime.env
		env.owner = obj
		env.owner_id = owner_id
		env.player_index = player_index
		env.effects = effects

		self:evaluate_program(program, env, program_key, component_runtime)
		local queued_commands<const> = env.queued_commands
		for i = 1, #queued_commands do
			local command<const> = queued_commands[i]
			obj:dispatch_command(command.event, command.payload)
			queued_commands[i] = nil
		end
		local queued<const> = env.queued_events
		for i = 1, #queued do
			local evt<const> = queued[i]
			obj:emit_gameplay_fact(evt)
			queued[i] = nil
		end
		::continue::
	end
end

function inputactioneffectsystem:evaluate_intent_binding(owner, player_index, binding)
	local action<const> = binding.action
	if not action then
		return
	end
	local state<const> = $.get_action_state(player_index, action)
	if state.justpressed and binding.press then
		self:run_intent_assignments(owner, player_index, binding, 'press', binding.press)
	end
	if state.pressed and binding.hold then
		self:run_intent_assignments(owner, player_index, binding, 'hold', binding.hold)
	end
	if state.justreleased and binding.release then
		self:run_intent_assignments(owner, player_index, binding, 'release', binding.release)
	end
end

function inputactioneffectsystem:run_intent_assignments(owner, player_index, binding, edge, spec)
	local assignments
	if type(spec) ~= 'table' or spec.path then
		assignments = { spec }
	else
		assignments = spec
	end
	for i = 1, #assignments do
		local assignment<const> = assignments[i]
		local path<const> = assignment.path
		local should_clear<const> = assignment.clear or (assignment.value == nil and edge == 'release')
			local resolved_value<const> = should_clear and nil or (assignment.value == nil and assigned_value_edges[edge] or assignment.value)
		self:assign_owner_path(owner, path, resolved_value, should_clear)
		if (assignment.consume) then
			consume_action(player_index, binding.action)
		end
	end
end

function inputactioneffectsystem:assign_owner_path(owner, path, value, clear)
	local segments<const> = {}
	for part in string.gmatch(path, '[^%.]+') do
		segments[#segments + 1] = part
	end
	local target = owner
	for i = 1, #segments - 1 do
		local key<const> = segments[i]
		local next_table = target[key]
		if type(next_table) ~= 'table' then
			next_table = {}
			target[key] = next_table
		end
		target = next_table
	end
	local final_key<const> = segments[#segments]
	if clear then
		target[final_key] = nil
		return
	end
	target[final_key] = value
end

function inputactioneffectsystem:resolve_intent_player_index(component, owner)
	local resolved<const> = component.player_index or owner.player_index
	if not resolved then
		error('[inputactioneffectsystem] unable to resolve player index for object "' .. (owner.id or '<unknown>') .. '".')
	end
	return resolved
end

function inputactioneffectsystem:resolve_program_key(component, owner)
	if component.program_id then
		return component.program_id
	end
	return 'inline:' .. owner.id
end

function inputactioneffectsystem:describe_inline_program(component)
	local owner_id<const> = component.parent and component.parent.id or '<unattached>'
	local component_id<const> = component.id or component.id_local or component.type_name or 'component'
	return 'inline:' .. owner_id .. ':' .. component_id
end

function inputactioneffectsystem:resolve_component_runtime(component)
	local component_runtime = self.runtime_by_component[component]
	if component_runtime then
		return component_runtime
	end
	local queued_commands<const> = {}
	local queued_events<const> = {}
	component_runtime = {
		binding_latch = {},
		binding_touched = {},
		binding_count = 0,
		last_frame = 0,
		queued_commands = queued_commands,
		queued_events = queued_events,
		env = {
			queued_commands = queued_commands,
			queued_events = queued_events,
		},
	}
	self.runtime_by_component[component] = component_runtime
	return component_runtime
end

function inputactioneffectsystem:reset_component_runtime(component_runtime, binding_count)
	local latch<const> = component_runtime.binding_latch
	local touched<const> = component_runtime.binding_touched
	local clear_count = component_runtime.binding_count
	if clear_count < binding_count then
		clear_count = binding_count
	end
	for i = 1, clear_count do
		latch[i] = false
		touched[i] = 0
	end
	component_runtime.binding_count = binding_count
end

function inputactioneffectsystem:prepare_component_runtime(component_runtime, program, program_key, env)
	local binding_count<const> = #program.bindings
	if component_runtime.last_frame ~= self.frame_serial - 1
		or component_runtime.program ~= program
		or component_runtime.program_key ~= program_key
		or component_runtime.owner_id ~= env.owner_id
		or component_runtime.player_index ~= env.player_index
		or component_runtime.binding_count ~= binding_count then
		self:reset_component_runtime(component_runtime, binding_count)
	end
	component_runtime.last_frame = self.frame_serial
	component_runtime.program = program
	component_runtime.program_key = program_key
	component_runtime.owner_id = env.owner_id
	component_runtime.player_index = env.player_index
	component_runtime.binding_count = binding_count
end

function inputactioneffectsystem:evaluate_program(program, env, program_key, component_runtime)
	self:prepare_component_runtime(component_runtime, program, program_key, env)
	local bindings<const> = program.bindings
	local frame<const> = self.frame_serial
	local latch<const> = component_runtime.binding_latch
	local touched<const> = component_runtime.binding_touched
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if not binding.predicate(env) then
			goto continue
		end

		local armed<const> = latch[i]
		if armed then
			touched[i] = frame
		end

		local press_matched<const> = binding.press and binding.press(env) or false
		local hold_matched<const> = binding.hold and binding.hold(env) or false
		local release_matched<const> = binding.release and binding.release(env) or false
		local custom_edges<const> = binding.custom_edges
		if not armed and not press_matched and not hold_matched and not release_matched and #custom_edges == 0 then
			goto continue
		end

		local scratch<const> = self.custom_match_scratch:reserve(#custom_edges, false)
		for j = 1, #custom_edges do
			scratch[j] = custom_edges[j].match(env)
		end

		local matched

		if press_matched then
			matched = true
			if binding.press_effect then
				if run_effect(binding.press_effect, env) then
					latch[i] = true
					touched[i] = frame
				end
			else
				latch[i] = true
				touched[i] = frame
			end
		end
		if hold_matched then
			matched = true
			if binding.hold_effect then
				run_effect(binding.hold_effect, env)
			end
			latch[i] = true
			touched[i] = frame
		end
		if release_matched and armed then
			if binding.release_effect and run_effect(binding.release_effect, env) then
				matched = true
			elseif binding.release_effect == nil then
				matched = true
			end
			latch[i] = false
			touched[i] = 0
		end

		for j = 1, #custom_edges do
			if scratch[j] then
				local effect<const> = custom_edges[j].effect
				if effect then
					if run_effect(effect, env) then
						matched = true
					end
				else
					matched = true
				end
			end
		end

		if matched and program.eval_mode == 'first' then
			break
		end

		::continue::
	end
	for i = 1, component_runtime.binding_count do
		if latch[i] and touched[i] ~= frame then
			latch[i] = false
		end
	end
end

function inputactioneffectsystem:resolve_compiled_program(component)
	if component.program then
		local program<const> = component.program
		if not self.validated_inline[program] then
			compiler.validate_program_effects(program, self:describe_inline_program(component))
			self.validated_inline[program] = true
		end
		local compiled = self.inline_compiled[program]
		if not compiled then
			compiled = compiler.compile_program(program, function(pattern)
				return self:parse_pattern(pattern)
			end)
			self.inline_compiled[program] = compiled
		end
		return compiled
	end

	local program_id<const> = component.program_id
	if not program_id then
		error('[inputactioneffectsystem] component on "' .. (component.parent and component.parent.id or '<unknown>') .. '" is missing program_id.')
	end

	local compiled = self.compiled_by_id[program_id]
	if compiled then
		return compiled
	end

	local program<const> = self:resolve_program_by_id(program_id)
	compiled = compiler.compile_program(program, function(pattern)
		return self:parse_pattern(pattern)
	end)
	self.compiled_by_id[program_id] = compiled
	return compiled
end

function inputactioneffectsystem:resolve_program_by_id(program_id)
	if self.resolved_programs[program_id] then
		return self.resolved_programs[program_id]
	end
	if self.missing_program_ids[program_id] then
		error('[inputactioneffectsystem] program "' .. program_id .. '" is marked as missing.')
	end
	local data<const> = assets.data[program_id]
	if not dsl.is_input_action_effect_program(data) then
		self.missing_program_ids[program_id] = true
		error('[inputactioneffectsystem] program "' .. program_id .. '" not found or invalid.')
	end
	self.resolved_programs[program_id] = data
	return data
end

function inputactioneffectsystem:parse_pattern(pattern)
	local predicate = self.pattern_cache[pattern]
	if predicate then
		return predicate
	end
	predicate = function(env)
		return action_triggered(pattern, env.player_index)
	end
	self.pattern_cache[pattern] = predicate
	if self.pattern_cache_max and (function()
		local count = 0
		for _ in pairs(self.pattern_cache) do
			count = count + 1
		end
		return count
	end)() > self.pattern_cache_max then
		for key in pairs(self.pattern_cache) do
			if key ~= pattern then
				self.pattern_cache[key] = nil
				break
			end
		end
	end
	return predicate
end

return {
	inputactioneffectsystem = inputactioneffectsystem,
}
