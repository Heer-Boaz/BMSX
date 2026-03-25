local fsm_trace = {}

local payload_primitive_types = {
	['number'] = true,
	['boolean'] = true,
}

function fsm_trace.describe_payload(payload)
	if payload == nil then
		return 'nil'
	end
	local payload_type = type(payload)
	if payload_type == 'string' then
		return payload
	end
	if payload_primitive_types[payload_type] then
		return tostring(payload)
	end
	return tostring(payload)
end

function fsm_trace.format_guard_diagnostics(guard)
	if not guard or not guard.evaluations or #guard.evaluations == 0 then
		return nil
	end
	local parts = {}
	for i = 1, #guard.evaluations do
		local evaluation = guard.evaluations[i]
		local status = evaluation.passed and 'pass' or 'fail'
		local descriptor
		if evaluation.descriptor and evaluation.descriptor ~= '<none>' then
			descriptor = '(' .. evaluation.descriptor .. ')'
		else
			descriptor = ''
		end
		local note = evaluation.reason and not evaluation.passed and ('!' .. evaluation.reason)
		local suffix
		if note then
			suffix = '[' .. note .. ']'
		else
			suffix = ''
		end
		parts[#parts + 1] = evaluation.side .. ':' .. status .. descriptor .. suffix
	end
	return table.concat(parts, ',')
end

function fsm_trace.format_action_evaluations(context)
	if not context or not context.action_evaluations or #context.action_evaluations == 0 then
		return nil
	end
	return table.concat(context.action_evaluations, ';')
end

function fsm_trace.compose_transition_trace_message(entry)
	local parts = {}
	parts[1] = '[transition]'
	parts[#parts + 1] = 'outcome=' .. entry.outcome
	parts[#parts + 1] = 'exec=' .. entry.execution
	parts[#parts + 1] = 'to='' .. tostring(entry.to) .. '''
	if entry.from ~= nil then
		parts[#parts + 1] = 'from='' .. tostring(entry.from) .. '''
	end
	if entry.context and entry.context.trigger then
		local trigger = entry.context.event_name and (entry.context.trigger .. '(' .. entry.context.event_name .. ')') or entry.context.trigger
		parts[#parts + 1] = 'trigger=' .. trigger
	end
	if entry.context and entry.context.description then
		parts[#parts + 1] = 'desc=' .. entry.context.description
	end
	if entry.context and entry.context.handler_name then
		parts[#parts + 1] = 'handler=' .. entry.context.handler_name
	end
	if entry.context and entry.context.emitter then
		parts[#parts + 1] = 'emitter=' .. tostring(entry.context.emitter)
	end
	if entry.context and entry.context.bubbled then
		parts[#parts + 1] = 'bubbled=true'
	end
	if entry.reason then
		parts[#parts + 1] = 'reason=' .. entry.reason
	end
	local guard_summary = fsm_trace.format_guard_diagnostics(entry.guard)
	if guard_summary then
		parts[#parts + 1] = 'guards=' .. guard_summary
	end
	local action_summary = fsm_trace.format_action_evaluations(entry.context)
	if action_summary then
		parts[#parts + 1] = 'actions=' .. action_summary
	end
	if entry.context and entry.context.payload_summary then
		parts[#parts + 1] = 'payload=' .. entry.context.payload_summary
	end
	if entry.queue_size ~= nil then
		parts[#parts + 1] = 'queue=' .. tostring(entry.queue_size)
	end
	if entry.context and entry.context.timestamp then
		parts[#parts + 1] = 'ts=' .. tostring(entry.context.timestamp)
	end
	return table.concat(parts, ' ')
end

function fsm_trace.create_fallback_snapshot(trigger, description, payload)
	return {
		trigger = trigger,
		description = description,
		timestamp = clock_now(),
		payload_summary = payload ~= nil and fsm_trace.describe_payload(payload),
	}
end

function fsm_trace.create_event_context(event_name, emitter, payload)
	return {
		trigger = 'event',
		description = 'event:' .. event_name,
		event_name = event_name,
		emitter = emitter,
		timestamp = clock_now(),
		payload_summary = payload ~= nil and fsm_trace.describe_payload(payload),
	}
end

function fsm_trace.create_input_context(pattern, player_index)
	return {
		trigger = 'input',
		description = 'input:' .. pattern,
		timestamp = clock_now(),
		payload_summary = 'player=' .. tostring(player_index),
	}
end

function fsm_trace.create_update_context(handler_name)
	return {
		trigger = 'update',
		description = 'update:' .. handler_name,
		timestamp = clock_now(),
	}
end

function fsm_trace.create_enter_context(state_id)
	return {
		trigger = 'enter',
		description = 'enter:' .. tostring(state_id),
		timestamp = clock_now(),
	}
end

function fsm_trace.describe_string_handler(target_state)
	return 'transition:' .. target_state
end

function fsm_trace.describe_action_handler(spec)
	if type(spec) ~= 'table' then
		return 'handler'
	end
	if type(spec.go) == 'function' then
		return '<anonymous>'
	end
	if type(spec.go) == 'string' then
		return 'do:' .. spec.go
	end
	return 'handler'
end

function fsm_trace.describe_transition_handler(spec)
	if type(spec) == 'string' then
		return fsm_trace.describe_string_handler(spec)
	end
	if type(spec) == 'function' then
		local name = spec.name
		if name then
			return name
		end
		return '<anonymous>'
	end
	return fsm_trace.describe_action_handler(spec)
end

function fsm_trace.compose_event_dispatch_trace_message(entry)
	local transition = entry.context.last_transition
	local parts = {}
	parts[1] = '[dispatch]'
	parts[#parts + 1] = 'event=' .. entry.event_name
	parts[#parts + 1] = 'handled=' .. tostring(entry.handled)
	parts[#parts + 1] = 'bubbled=' .. tostring(entry.bubbled)
	if entry.depth > 0 then
		parts[#parts + 1] = 'depth=' .. tostring(entry.depth)
	end
	parts[#parts + 1] = 'emitter=' .. tostring(entry.emitter)
	if entry.context.handler_name then
		parts[#parts + 1] = 'handler=' .. entry.context.handler_name
	end
	parts[#parts + 1] = 'state=' .. tostring(entry.current_id)
	if transition then
		parts[#parts + 1] = 'target=' .. tostring(transition.to)
		parts[#parts + 1] = 'transition=' .. tostring(transition.execution)
		if transition.guard_summary then
			parts[#parts + 1] = 'guards=' .. transition.guard_summary
		end
	else
		parts[#parts + 1] = 'target=' .. tostring(entry.current_id)
		parts[#parts + 1] = 'transition=none'
	end
	local payload_summary = entry.context.payload_summary or (entry.detail ~= nil and fsm_trace.describe_payload(entry.detail))
	if payload_summary then
		parts[#parts + 1] = 'payload=' .. payload_summary
	end
	if entry.context.timestamp then
		parts[#parts + 1] = 'ts=' .. tostring(entry.context.timestamp)
	end
	return table.concat(parts, ' ')
end

return fsm_trace
