local eventemitter<const> = require('cartlib/eventemitter').eventemitter
local input<const> = require('cartlib/input/player')

local compiler<const> = {}
local no_custom_bindings<const> = {}
local compile_effect_list

local compile_effect<const> = function(owner, player_index, effect, slot)
	local trigger<const> = effect['effect.trigger']
	if trigger ~= nil then
		local id
		local payload
		if type(trigger) == 'string' then
			id = trigger
		else
			id = trigger.id
			payload = trigger.payload
		end
		return function(component)
			component.parent.actioneffects:trigger(id, payload)
		end, true, 0, 0
	end
	local consume<const> = effect['input.consume']
	if consume ~= nil then
		return function()
			input.consume(player_index, consume)
		end, false, 0, 0
	end
	local gameplay<const> = effect['emit.gameplay']
	if gameplay ~= nil then
		local event<const> = eventemitter.instance:create_gameevent({
			emitter = owner,
			type = gameplay.event,
			payload = gameplay.payload,
		})
		return function(component)
			local count<const> = component.queued_event_count + 1
			component.queued_event_count = count
			component.queued_events[count] = event
		end, false, 1, 0
	end
	local command<const> = effect['dispatch.command']
	if command ~= nil then
		return function(component)
			local count<const> = component.queued_command_count + 1
			component.queued_command_count = count
			component.queued_commands[count] = command
		end, false, 0, 1
	end
	if effect.commands ~= nil then
		return compile_effect_list(owner, player_index, effect.commands, slot)
	end
	error('unknown input effect in slot "' .. slot .. '".')
end

compile_effect_list = function(owner, player_index, spec, slot)
	if spec == nil then
		return nil, false, 0, 0
	end
	if spec[1] == nil then
		return compile_effect(owner, player_index, spec, slot)
	end
	local count<const> = #spec
	if count == 1 then
		return compile_effect(owner, player_index, spec[1], slot)
	end
	local executors<const> = {}
	local uses_effect_triggers
	local queued_event_capacity = 0
	local queued_command_capacity = 0
	for i = 1, count do
		local executor<const>, uses_trigger<const>, event_count<const>, command_count<const> = compile_effect(owner, player_index, spec[i], slot)
		executors[i] = executor
		if uses_trigger then
			uses_effect_triggers = true
		end
		queued_event_capacity = queued_event_capacity + event_count
		queued_command_capacity = queued_command_capacity + command_count
	end
	return function(component)
		for i = 1, count do
			executors[i](component)
		end
	end, uses_effect_triggers, queued_event_capacity, queued_command_capacity
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

local compile_binding<const> = function(owner, player_index, binding, source_index)
	local on<const> = binding.on
	local effects<const> = binding.go
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
	local uses_effect_triggers
	local queued_event_capacity = 0
	local queued_command_capacity = 0
	local custom = no_custom_bindings
	local custom_source<const> = on.custom
	if custom_source ~= nil and #custom_source > 0 then
		custom = {}
		for i = 1, #custom_source do
			local entry<const> = custom_source[i]
			local effect<const>, uses_trigger<const>, event_count<const>, command_count<const> = compile_effect_list(owner, player_index, effects[entry.name], entry.name)
			custom[i] = {
				input = input.bind(player_index, entry.pattern),
				effect = effect,
			}
			if uses_trigger then
				uses_effect_triggers = true
			end
			queued_event_capacity = queued_event_capacity + event_count
			queued_command_capacity = queued_command_capacity + command_count
		end
	end
	local press_effect<const>, press_uses_trigger<const>, press_events<const>, press_commands<const> = compile_effect_list(owner, player_index, effects.press, 'press')
	local hold_effect<const>, hold_uses_trigger<const>, hold_events<const>, hold_commands<const> = compile_effect_list(owner, player_index, effects.hold, 'hold')
	local release_effect<const>, release_uses_trigger<const>, release_events<const>, release_commands<const> = compile_effect_list(owner, player_index, effects.release, 'release')
	queued_event_capacity = queued_event_capacity + press_events + hold_events + release_events
	queued_command_capacity = queued_command_capacity + press_commands + hold_commands + release_commands
	return {
		order = source_index,
		priority = priority,
		modes = compile_modes(owner, binding),
		press = press,
		hold = hold,
		release = release,
		press_effect = press_effect,
		hold_effect = hold_effect,
		release_effect = release_effect,
		custom = custom,
	}, uses_effect_triggers or press_uses_trigger or hold_uses_trigger or release_uses_trigger,
		queued_event_capacity, queued_command_capacity
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
	local max_custom_count = 0
	local uses_effect_triggers
	local queued_event_capacity = 0
	local queued_command_capacity = 0
	for i = 1, #source do
		local binding<const>, uses_trigger<const>, event_count<const>, command_count<const> = compile_binding(owner, player_index, source[i], i)
		bindings[i] = binding
		local custom_count<const> = #binding.custom
		if custom_count > max_custom_count then
			max_custom_count = custom_count
		end
		if uses_trigger then
			uses_effect_triggers = true
		end
		queued_event_capacity = queued_event_capacity + event_count
		queued_command_capacity = queued_command_capacity + command_count
	end
	table.sort(bindings, binding_precedes)
	return {
		bindings = bindings,
		stop_after_match = program.eval == nil or program.eval == 'first',
		max_custom_count = max_custom_count,
		queued_event_capacity = queued_event_capacity,
		queued_command_capacity = queued_command_capacity,
	}, uses_effect_triggers
end

return compiler
