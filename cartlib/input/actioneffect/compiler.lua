local input<const> = require('cartlib/input/input')
local evaluation_program<const> = require('cartlib/input/actioneffect/evaluation_program')

local compiler<const> = {}
local no_custom_bindings<const> = {}

local append_effects<const> = function(target, source)
	if source == nil then
		return nil
	end
	local commands<const> = source.commands or source
	if commands[1] == nil then
		target[#target + 1] = commands
		return #target
	end
	for index = 1, #commands do
		target[#target + 1] = commands[index]
	end
	return #target
end

local compile_mode<const> = function(owner, entry)
	local path
	if entry.path ~= nil then
		path = owner.state_machines:bind_state_path(entry.path)
	end
	return { path = path, tag = entry.tag, negated = not not entry['not'] }
end

local compile_modes<const> = function(owner, binding)
	local when<const> = binding.when
	if when == nil or when.mode == nil then
		return nil
	end
	local source<const> = when.mode
	local modes<const> = {}
	if source[1] == nil then
		modes[1] = compile_mode(owner, source)
		return modes
	end
	for i = 1, #source do
		modes[i] = compile_mode(owner, source[i])
	end
	return modes
end

local compile_binding<const> = function(owner, player_index, binding, source_index, effects)
	local on<const> = binding.on
	local binding_effects<const> = binding.go
	local priority = binding.priority
	if priority == nil then
		priority = 0
	end
	local press
	if on.press ~= nil then
		press = input.bind(player_index, on.press)
	end
	local hold
	if on.hold ~= nil then
		hold = input.bind(player_index, on.hold)
	end
	local release
	if on.release ~= nil then
		release = input.bind(player_index, on.release)
	end
	local combo
	local combo_reset
	if on.combo ~= nil then
		combo, combo_reset = input.bind_combo(player_index, on.combo)
	end
	local custom = no_custom_bindings
	local custom_source<const> = on.custom
	if custom_source ~= nil and #custom_source > 0 then
		custom = {}
		for i = 1, #custom_source do
			local entry<const> = custom_source[i]
			local effect_start<const> = #effects + 1
			custom[i] = {
				input = input.bind(player_index, entry.pattern),
				effect_start = effect_start,
				effect_end = append_effects(effects, binding_effects[entry.name]),
				slot = entry.name,
			}
		end
	end
	local press_effect_start<const> = #effects + 1
	local press_effect_end<const> = append_effects(effects, binding_effects.press)
	local hold_effect_start<const> = #effects + 1
	local hold_effect_end<const> = append_effects(effects, binding_effects.hold)
	local release_effect_start<const> = #effects + 1
	local release_effect_end<const> = append_effects(effects, binding_effects.release)
	local combo_effect_start<const> = #effects + 1
	local combo_effect_end<const> = append_effects(effects, binding_effects.combo)
	return {
		order = source_index,
		priority = priority,
		modes = compile_modes(owner, binding),
		press = press,
		hold = hold,
		release = release,
		combo = combo,
		combo_reset = combo_reset,
		press_effect_start = press_effect_start,
		press_effect_end = press_effect_end,
		hold_effect_start = hold_effect_start,
		hold_effect_end = hold_effect_end,
		release_effect_start = release_effect_start,
		release_effect_end = release_effect_end,
		combo_effect_start = combo_effect_start,
		combo_effect_end = combo_effect_end,
		custom = custom,
	}
end

local binding_precedes<const> = function(left, right)
	if left.priority ~= right.priority then
		return left.priority > right.priority
	end
	return left.order < right.order
end

function compiler.compile_program(owner, program)
	local player_index<const> = owner.player_index
	local source<const> = program.bindings
	local bindings<const> = {}
	local effects<const> = {}
	local max_custom_count = 0
	local release_binding_count = 0
	local combo_resets<const> = {}
	local has_press
	local has_hold
	local has_combo
	for i = 1, #source do
		local binding<const> = compile_binding(owner, player_index, source[i], i, effects)
		bindings[i] = binding
		if binding.press ~= nil then
			has_press = true
		end
		if binding.hold ~= nil then
			has_hold = true
		end
		if binding.release ~= nil then
			release_binding_count = release_binding_count + 1
		end
		if binding.combo ~= nil then
			has_combo = true
			combo_resets[#combo_resets + 1] = binding.combo_reset
		end
		local custom_count<const> = #binding.custom
		if custom_count > max_custom_count then
			max_custom_count = custom_count
		end
	end
	table.sort(bindings, binding_precedes)
	local compiled<const> = {
		bindings = bindings,
		stop_after_match = program.eval == nil or program.eval == 'first',
		has_press = has_press,
		has_hold = has_hold,
		has_combo = has_combo,
		release_binding_count = release_binding_count,
		combo_resets = combo_resets,
		max_custom_count = max_custom_count,
	}
	local evaluate<const>, uses_effect_triggers<const>, queued_event_capacity<const>, queued_command_capacity<const>
		= evaluation_program.compile(compiled, effects, player_index)
	compiled.evaluate = evaluate
	compiled.queued_event_capacity = queued_event_capacity
	compiled.queued_command_capacity = queued_command_capacity
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		binding.order = nil
		binding.priority = nil
		binding.press_effect_start = nil
		binding.press_effect_end = nil
		binding.hold_effect_start = nil
		binding.hold_effect_end = nil
		binding.release_effect_start = nil
		binding.release_effect_end = nil
		binding.combo_effect_start = nil
		binding.combo_effect_end = nil
		binding.combo_reset = nil
		local custom<const> = binding.custom
		for custom_index = 1, #custom do
			custom[custom_index].effect_start = nil
			custom[custom_index].effect_end = nil
			custom[custom_index].slot = nil
		end
	end
	return compiled, uses_effect_triggers
end

return compiler
