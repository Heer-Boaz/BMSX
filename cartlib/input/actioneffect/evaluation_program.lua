local input<const> = require('cartlib/input/input')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local evaluation_program_syntax<const> = require('cartlib/input/actioneffect/evaluation_program_syntax')
local compile_syntax<const> = lua_compiler.compile_syntax

local evaluation_program<const> = {}
local effect_kind<const> = evaluation_program_syntax.effect_kind

local add_operand<const> = function(program, value)
	if value == nil then
		return 0
	end
	local operands<const> = program.operands
	local index<const> = #operands + 1
	operands[index] = value
	return index
end

local compile_effect<const> = function(program, effect, slot)
	local trigger<const> = effect['effect.trigger']
	if trigger ~= nil then
		local id = trigger
		local payload
		if type(trigger) == 'table' then
			id = trigger.id
			payload = trigger.payload
		end
		program.uses_effect_triggers = true
		program.environment.trigger = actioneffect_component.trigger
		return {
			kind = effect_kind.trigger,
			id_operand_index = add_operand(program, id),
			payload_operand_index = add_operand(program, payload),
		}
	end
	local consume<const> = effect['input.consume']
	if consume ~= nil then
		program.environment.input_consume = input.consume
		return {
			kind = effect_kind.consume,
			operand_index = add_operand(program, consume),
		}
	end
	local gameplay<const> = effect['emit.gameplay']
	if gameplay ~= nil then
		program.queued_event_capacity = program.queued_event_capacity + 1
		return {
			kind = effect_kind.gameplay,
			event_operand_index = add_operand(program, gameplay.event),
			payload_operand_index = add_operand(program, gameplay.payload),
		}
	end
	local command<const> = effect['dispatch.command']
	if command ~= nil then
		program.queued_command_capacity = program.queued_command_capacity + 1
		return {
			kind = effect_kind.command,
			operand_index = add_operand(program, command),
		}
	end
	error('unknown input effect in slot "' .. slot .. '".')
end

local compile_effect_range<const> = function(program, source, first, last, slot)
	if last == nil then
		return
	end
	local effects<const> = program.effects
	for index = first, last do
		effects[index] = compile_effect(program, source[index], slot)
	end
end

local compile_effects<const> = function(bindings, source)
	local program<const> = {
		effects = {},
		operands = {},
		environment = {},
		uses_effect_triggers = false,
		queued_event_capacity = 0,
		queued_command_capacity = 0,
	}
	for binding_index = 1, #bindings do
		local binding<const> = bindings[binding_index]
		compile_effect_range(program, source, binding.press_effect_start, binding.press_effect_end, 'press')
		compile_effect_range(program, source, binding.hold_effect_start, binding.hold_effect_end, 'hold')
		compile_effect_range(program, source, binding.release_effect_start, binding.release_effect_end, 'release')
		compile_effect_range(program, source, binding.combo_effect_start, binding.combo_effect_end, 'combo')
		local custom<const> = binding.custom
		for custom_index = 1, #custom do
			local entry<const> = custom[custom_index]
			compile_effect_range(program, source, entry.effect_start, entry.effect_end, entry.slot)
		end
	end
	return program
end

function evaluation_program.compile(program, effects, player_index, clock_source)
	local effect_program<const> = compile_effects(program.bindings, effects)
	local environment<const> = effect_program.environment
	environment.action_bindings = program.bindings
	if #effect_program.operands > 0 then
		environment.effect_operands = effect_program.operands
	end
	return compile_syntax(
		evaluation_program_syntax.build(program, effect_program, player_index, clock_source),
		'[input.actioneffect]',
		environment
	)(), effect_program.uses_effect_triggers,
		effect_program.queued_event_capacity,
		effect_program.queued_command_capacity
end

return evaluation_program
