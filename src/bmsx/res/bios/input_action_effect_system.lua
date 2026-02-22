-- input_action_effect_system.lua
-- input intent + input action effect ecs system

local ecs = require("ecs")
local action_effects = require("action_effects")
local compiler = require("input_action_effect_compiler")
local dsl = require("input_action_effect_dsl")
local romdir = require("romdir")
local world_instance = require("world").instance
local inputintentcomponent = "inputintentcomponent"
local inputactioneffectcomponent = "inputactioneffectcomponent"
local actioneffectcomponentid = "actioneffectcomponent"
local assigned_value_edges = { ['hold'] = true, ['press'] = true }

local asset_programs_validated = false

local function validate_primary_assets_on_boot()
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

local inputactioneffectsystem = {}
inputactioneffectsystem.__index = inputactioneffectsystem
setmetatable(inputactioneffectsystem, { __index = ecs.ecsystem })

function inputactioneffectsystem.new(priority)
	local self = setmetatable(ecs.ecsystem.new(ecs.tickgroup.input, priority or 0), inputactioneffectsystem)
	self.compiled_by_id = {}
	self.inline_compiled = setmetatable({}, { __mode = "k" })
	self.validated_inline = setmetatable({}, { __mode = "k" })
	self.resolved_programs = {}
	self.missing_program_ids = {}
	self.pattern_cache = {}
	self.pattern_cache_max = 256
	self.custom_match_scratch = {}
	self.binding_latch = {}
	self.frame_latch_touched = {}
	self.__ecs_id = "inputactioneffectsystem"
	validate_primary_assets_on_boot()
	return self
end

function inputactioneffectsystem:update()
	self.frame_latch_touched = {}
	self:process_input_intents()
	self:process_input_action_programs()
	for key in pairs(self.binding_latch) do
		if not self.frame_latch_touched[key] then
			self.binding_latch[key] = nil
		end
	end
end

function inputactioneffectsystem:process_input_intents()
	for obj, component in world_instance:objects_with_components(inputintentcomponent, { scope = "active" }) do
		if not (obj.tick_enabled) then
			goto continue
		end
		if not component.bindings or #component.bindings == 0 then
			goto continue
		end
		local player_index = self:resolve_intent_player_index(component, obj)
		for i = 1, #component.bindings do
			self:evaluate_intent_binding(obj, player_index, component.bindings[i])
		end
		::continue::
	end
end

function inputactioneffectsystem:process_input_action_programs()
	for obj, component in world_instance:objects_with_components(inputactioneffectcomponent, { scope = "active" }) do
		if not (obj.tick_enabled) then
			goto continue
		end
		local program = self:resolve_compiled_program(component)
		local program_key = self:resolve_program_key(component, obj)

		local player_index = obj.player_index or 1
		local effects = obj:get_component(actioneffectcomponentid)
		if (not effects) and program.uses_effect_triggers then
			error("[inputactioneffectsystem] program '" .. program_key .. "' triggers effects but object '" .. obj.id .. "' has no actioneffectcomponent.")
		end

		local owner_id = effects and effects.parent.id or obj.id
		local env = {
			owner = obj,
			owner_id = owner_id,
			player_index = player_index,
			effects = effects,
			queued_commands = {},
			queued_events = {},
		}

		self:evaluate_program(program, env, program_key)
		local queued_commands = env.queued_commands
		for i = 1, #queued_commands do
			local command = queued_commands[i]
			obj:dispatch_command(command.event, command.payload)
		end
		local queued = env.queued_events
		for i = 1, #queued do
			local evt = queued[i]
			obj:emit_gameplay_fact(evt)
		end
		::continue::
	end
end

function inputactioneffectsystem:evaluate_intent_binding(owner, player_index, binding)
	local action = binding.action
	if not action then
		return
	end
	local state = $.get_action_state(player_index, action)
	if state.justpressed and binding.press then
		self:run_intent_assignments(owner, player_index, binding, "press", binding.press)
	end
	if state.pressed and binding.hold then
		self:run_intent_assignments(owner, player_index, binding, "hold", binding.hold)
	end
	if state.justreleased and binding.release then
		self:run_intent_assignments(owner, player_index, binding, "release", binding.release)
	end
end

function inputactioneffectsystem:run_intent_assignments(owner, player_index, binding, edge, spec)
	local assignments
	if type(spec) ~= "table" or spec.path then
		assignments = { spec }
	else
		assignments = spec
	end
	for i = 1, #assignments do
		local assignment = assignments[i]
		local path = assignment.path
		local should_clear = assignment.clear or (assignment.value == nil and edge == "release")
			local resolved_value = should_clear and nil or (assignment.value == nil and assigned_value_edges[edge] or assignment.value)
		self:assign_owner_path(owner, path, resolved_value, should_clear)
		if (assignment.consume) then
			consume_action(player_index, binding.action)
		end
	end
end

function inputactioneffectsystem:assign_owner_path(owner, path, value, clear)
	local segments = {}
	for part in string.gmatch(path, "[^%.]+") do
		segments[#segments + 1] = part
	end
	local target = owner
	for i = 1, #segments - 1 do
		local key = segments[i]
		local next_table = target[key]
		if type(next_table) ~= "table" then
			next_table = {}
			target[key] = next_table
		end
		target = next_table
	end
	local final_key = segments[#segments]
	if clear then
		target[final_key] = nil
		return
	end
	target[final_key] = value
end

function inputactioneffectsystem:resolve_intent_player_index(component, owner)
	local explicit = component.player_index or 0
	local fallback = owner.player_index or 0
	local resolved = explicit > 0 and explicit or fallback
	if resolved <= 0 then
		error("[inputactioneffectsystem] unable to resolve player index for object '" .. (owner.id or "<unknown>") .. "'.")
	end
	return resolved
end

function inputactioneffectsystem:resolve_program_key(component, owner)
	if component.program_id then
		return component.program_id
	end
	return "inline:" .. owner.id
end

function inputactioneffectsystem:describe_inline_program(component)
	local owner_id = component.parent and component.parent.id or "<unattached>"
	local component_id = component.id or component.id_local or component.type_name or "component"
	return "inline:" .. owner_id .. ":" .. component_id
end

function inputactioneffectsystem:evaluate_program(program, env, program_key)
	local bindings = program.bindings
	for i = 1, #bindings do
		local binding = bindings[i]
		if not binding.predicate(env) then
			goto continue
		end

		local binding_key = self:make_binding_key(env.owner_id, program_key, env.player_index, binding, i)
		local armed = (self.binding_latch[binding_key])
		if armed then
			self.frame_latch_touched[binding_key] = true
		end

		local press_matched = binding.press and binding.press(env) or false
		local hold_matched = binding.hold and binding.hold(env) or false
		local release_matched = binding.release and binding.release(env) or false
		local custom_edges = binding.custom_edges
		if not armed and not press_matched and not hold_matched and not release_matched and #custom_edges == 0 then
			goto continue
		end

		local scratch = self:ensure_scratch(#custom_edges)
		for j = 1, #custom_edges do
			scratch[j] = custom_edges[j].match(env)
		end

		local matched
		local function run_effect(effect)
			if not effect then
				return false
			end
			effect(env)
			return true
		end

		if press_matched then
			matched = true
			if binding.press_effect then
				if run_effect(binding.press_effect) then
					self.binding_latch[binding_key] = true
					self.frame_latch_touched[binding_key] = true
				end
			else
				self.binding_latch[binding_key] = true
				self.frame_latch_touched[binding_key] = true
			end
		end
		if hold_matched then
			matched = true
			if binding.hold_effect then
				run_effect(binding.hold_effect)
			end
			self.binding_latch[binding_key] = true
			self.frame_latch_touched[binding_key] = true
		end
		if release_matched and armed then
			if binding.release_effect and run_effect(binding.release_effect) then
				matched = true
			elseif binding.release_effect == nil then
				matched = true
			end
			self.binding_latch[binding_key] = nil
		end

		for j = 1, #custom_edges do
			if scratch[j] then
				local effect = custom_edges[j].effect
				if effect then
					if run_effect(effect) then
						matched = true
					end
				else
					matched = true
				end
			end
		end

		if matched and program.eval_mode == "first" then
			return
		end

		::continue::
	end
end

function inputactioneffectsystem:make_binding_key(owner_id, program_key, player_index, binding, index)
	local name = binding.name or ("#" .. index)
	return owner_id .. "|" .. program_key .. "|p" .. player_index .. "|" .. name .. "|" .. index
end

function inputactioneffectsystem:ensure_scratch(size)
	local scratch = self.custom_match_scratch
	while #scratch < size do
		scratch[#scratch + 1] = false
	end
	return scratch
end

function inputactioneffectsystem:resolve_compiled_program(component)
	if component.program then
		local program = component.program
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

	local program_id = component.program_id
	if not program_id then
		error("[inputactioneffectsystem] component on '" .. (component.parent and component.parent.id or "<unknown>") .. "' is missing program_id.")
	end

	local compiled = self.compiled_by_id[program_id]
	if compiled then
		return compiled
	end

	local program = self:resolve_program_by_id(program_id)
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
		error("[inputactioneffectsystem] program '" .. program_id .. "' is marked as missing.")
	end
	local data = assets.data[romdir.token(program_id)]
	if not dsl.is_input_action_effect_program(data) then
		self.missing_program_ids[program_id] = true
		error("[inputactioneffectsystem] program '" .. program_id .. "' not found or invalid.")
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
