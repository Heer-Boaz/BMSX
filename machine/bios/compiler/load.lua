local arena<const> = require('compiler/arena')
local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local lexer<const> = require('compiler/lexer')

local load_compiler<const> = {}
local byte<const> = __bmsx_string_byte

local context_parameter_register<const> = 1

local value_literal_token<const> = {
	number = true,
	string = true,
}

local path_suffix_token<const> = {
	['.'] = true,
	['['] = true,
}

local fail<const> = function(state, message, token)
	local at<const> = token or state.token
	error('[load:' .. state.chunk_name .. '] ' .. message .. ' at '
		.. tostring(at.line) .. ':' .. tostring(at.column))
end

local advance<const> = function(state)
	local token<const> = state.token
	state.token = lexer.next(state.lexer)
	return token
end

local expect<const> = function(state, kind)
	if state.token.kind ~= kind then
		fail(state, "expected '" .. kind .. "'")
	end
	return advance(state)
end

local add_context_value<const> = function(state, value)
	local index = state.context_index[value]
	if index ~= nil then
		return index
	end
	index = #state.context + 1
	state.context[index] = value
	state.context_index[value] = index
	return index
end

local parse_literal<const> = function(state, path_key)
	local token<const> = state.token
	if token.kind == '-' then
		advance(state)
		local number<const> = expect(state, 'number').value
		return 'value', -number
	end
	if token.kind == '&' then
		advance(state)
		return 'value', expect(state, 'string').value
	end
	if value_literal_token[token.kind] then
		advance(state)
		return 'value', token.value
	end
	if not path_key then
		if token.kind == 'nil' then
			advance(state)
			return 'nil'
		end
		if token.kind == 'false' then
			advance(state)
			return 'false'
		end
		if token.kind == 'true' then
			advance(state)
			return 'true'
		end
	end
	fail(state, path_key and 'path keys must be string or numeric literals'
		or 'unsupported literal expression')
end

local parse_path<const> = function(state)
	local root<const> = expect(state, 'identifier')
	local root_index<const> = state.parameter_index[root.value]
	if root_index == nil then
		fail(state, "unknown function parameter '" .. root.value .. "'", root)
	end
	local path<const> = {}
	while path_suffix_token[state.token.kind] do
		local value
		if state.token.kind == '.' then
			advance(state)
			value = expect(state, 'identifier').value
		else
			advance(state)
			local _<const>, path_value<const> = parse_literal(state, true)
			value = path_value
			expect(state, ']')
		end
		path[#path + 1] = add_context_value(state, value)
	end
	return root_index, path
end

local parse_value<const> = function(state)
	if state.token.kind == 'identifier' then
		local root<const>, path<const> = parse_path(state)
		return { kind = 'path', root = root, path = path }
	end
	local kind<const>, value<const> = parse_literal(state, false)
	if kind == 'value' then
		return { kind = 'upvalue', index = add_context_value(state, value) }
	end
	return { kind = kind }
end

local parse_assignment<const> = function(state)
	local root<const>, path<const> = parse_path(state)
	if #path == 0 then
		fail(state, 'direct parameter assignment is unsupported')
	end
	expect(state, '=')
	state.assignments[#state.assignments + 1] = {
		root = root,
		path = path,
		value = parse_value(state),
	}
	if state.token.kind == ';' then
		advance(state)
	end
end

local parse_function<const> = function(state)
	expect(state, 'function')
	expect(state, '(')
	local parameter_count = 0
	if state.token.kind ~= ')' then
		while true do
			local parameter<const> = expect(state, 'identifier')
			if state.parameter_index[parameter.value] ~= nil then
				fail(state, "duplicate function parameter '" .. parameter.value .. "'", parameter)
			end
			state.parameter_index[parameter.value] = parameter_count
			parameter_count = parameter_count + 1
			if state.token.kind ~= ',' then
				break
			end
			advance(state)
		end
	end
	expect(state, ')')
	state.parameter_count = parameter_count
	while state.token.kind ~= 'end' do
		if state.token.kind == 'eof' then
			fail(state, "expected 'end'")
		end
		parse_assignment(state)
	end
	advance(state)
end

local parse_chunk<const> = function(source, chunk_name)
	local lexer_state<const> = lexer.new(source, chunk_name)
	local state<const> = {
		chunk_name = chunk_name,
		lexer = lexer_state,
		token = lexer.next(lexer_state),
		parameter_index = {},
		parameter_count = 0,
		assignments = {},
		context = { 0 },
		context_index = {},
	}
	expect(state, 'return')
	parse_function(state)
	if state.token.kind ~= 'eof' then
		fail(state, 'chunk must contain exactly one returned function')
	end
	return state
end

local context_register<const> = function(parameter_count, context_index)
	return parameter_count + context_index - 2
end

local emit_path<const> = function(words, root, path, context_base, target)
	bytecode.emit_abc(words, isa.op_mov, target, root, 0)
	for index = 1, #path do
		bytecode.emit_abc(
			words,
			isa.op_gett,
			target,
			target,
			context_base + path[index] - 2
		)
	end
end

local emit_assignment<const> = function(words, assignment, parameter_count, value_count)
	local context_base<const> = parameter_count
	local target_node<const> = context_base + value_count
	local value_register<const> = target_node + 1
	local target_path<const> = assignment.path
	local value<const> = assignment.value
	bytecode.emit_abc(words, isa.op_mov, target_node, assignment.root, 0)
	for index = 1, #target_path - 1 do
		bytecode.emit_abc(
			words,
			isa.op_gett,
			target_node,
			target_node,
			context_register(parameter_count, target_path[index])
		)
	end
	if value.kind == 'path' then
		emit_path(words, value.root, value.path, context_base, value_register)
	elseif value.kind == 'upvalue' then
		bytecode.emit_abc(
			words,
			isa.op_mov,
			value_register,
			context_register(parameter_count, value.index),
			0
		)
	elseif value.kind == 'nil' then
		bytecode.emit_abc(words, isa.op_knil, value_register, 0, 0)
	elseif value.kind == 'false' then
		bytecode.emit_abc(words, isa.op_kfalse, value_register, 0, 0)
	else
		bytecode.emit_abc(words, isa.op_ktrue, value_register, 0, 0)
	end
	bytecode.emit_abc(
		words,
		isa.op_sett,
		target_node,
		context_register(parameter_count, target_path[#target_path]),
		value_register
	)
end

local compile_inner<const> = function(parsed)
	local words<const> = {}
	local value_count<const> = #parsed.context - 1
	for index = 0, value_count - 1 do
		bytecode.emit_abc(
			words,
			isa.op_getup,
			parsed.parameter_count + index,
			index,
			0
		)
	end
	for index = 1, #parsed.assignments do
		emit_assignment(words, parsed.assignments[index], parsed.parameter_count, value_count)
	end
	local return_register<const> = parsed.parameter_count + value_count
	bytecode.emit_abc(words, isa.op_knil, return_register, 0, 0)
	bytecode.emit_abc(words, isa.op_ret, return_register, 1, 0)
	return words, return_register + 2
end

local compile_outer<const> = function(value_count)
	local words<const> = {}
	bytecode.emit_abc(words, isa.op_getup, 0, 0, 0)
	bytecode.emit_abc(words, isa.op_geti, 1, 0, 1)
	for index = 0, value_count - 1 do
		bytecode.emit_abc(words, isa.op_geti, index + 2, 0, index + 2)
	end
	local closure_register<const> = value_count + 2
	bytecode.emit_closure_address_register(words, closure_register, 1)
	bytecode.emit_abc(words, isa.op_ret, closure_register, 1, 0)
	return words, closure_register + 1
end

local mode_accepts_text<const> = function(mode)
	if mode == nil then
		return true
	end
	for index = 1, #mode do
		if byte(mode, index) == 116 then
			return true
		end
	end
	return false
end

local create_context_closure<const> = function(function_address, context)
	-- The generated record captures this function's context parameter.
	return blua32.closure(function_address)
end

function load_compiler.compile(source, chunk_name, mode, _environment)
	if not mode_accepts_text(mode) then
		error("attempt to load a text chunk (mode is '" .. mode .. "')")
	end
	chunk_name = chunk_name or '=(load)'
	local parsed<const> = parse_chunk(source, chunk_name)
	local inner_words<const>, inner_max_stack<const> = compile_inner(parsed)
	local value_count<const> = #parsed.context - 1
	local outer_words<const>, outer_max_stack<const> = compile_outer(value_count)
	local upvalue_bytes<const> = isa.upvalue_record_size * (value_count + 1)
	local code_offset<const> = (isa.function_record_size * 2 + upvalue_bytes + 3) & -4
	local outer_code_bytes<const> = #outer_words * isa.instruction_bytes
	local inner_code_bytes<const> = #inner_words * isa.instruction_bytes
	local block_bytes<const> = code_offset + outer_code_bytes + inner_code_bytes
	local outer_record<const> = arena.allocate(block_bytes, isa.function_alignment)
	local inner_record<const> = outer_record + isa.function_record_size
	local outer_upvalues<const> = inner_record + isa.function_record_size
	local inner_upvalues<const> = outer_upvalues + isa.upvalue_record_size
	local outer_code<const> = outer_record + code_offset
	local inner_code<const> = outer_code + outer_code_bytes

	parsed.context[1] = inner_record
	bytecode.write_stack_upvalue(outer_upvalues, context_parameter_register)
	for index = 0, value_count - 1 do
		bytecode.write_stack_upvalue(
			inner_upvalues + index * isa.upvalue_record_size,
			index + 2
		)
	end
	bytecode.write_function_record(
		outer_record,
		outer_code,
		outer_code_bytes,
		0,
		outer_max_stack,
		outer_upvalues,
		1
	)
	bytecode.write_function_record(
		inner_record,
		inner_code,
		inner_code_bytes,
		parsed.parameter_count,
		inner_max_stack,
		inner_upvalues,
		value_count
	)
	bytecode.write(outer_words, outer_code)
	bytecode.write(inner_words, inner_code)

	return create_context_closure(outer_record, parsed.context)
end

return load_compiler
