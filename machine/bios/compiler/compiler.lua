local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local syntax<const> = require('compiler/syntax')

local compiler<const> = {}

local fail<const> = function(chunk_name, message, node)
	error('[load:' .. chunk_name .. '] ' .. message .. ' at '
		.. tostring(node.line) .. ':' .. tostring(node.column))
end

local returned_function<const> = function(chunk, chunk_name)
	local statements<const> = chunk.body.statements
	if #statements ~= 1 or statements[1].kind ~= syntax.return_statement then
		fail(chunk_name, 'chunk must contain exactly one returned function', chunk)
	end
	local expressions<const> = statements[1].expressions
	if #expressions ~= 1 or expressions[1].kind ~= syntax.function_expression then
		fail(chunk_name, 'chunk must contain exactly one returned function', statements[1])
	end
	return expressions[1]
end

local bind_parameters<const> = function(function_expression, chunk_name)
	local register_by_name<const> = {}
	local parameters<const> = function_expression.parameters
	for index = 1, #parameters do
		local parameter<const> = parameters[index]
		if register_by_name[parameter.name] ~= nil then
			fail(chunk_name, "duplicate function parameter '" .. parameter.name .. "'", parameter)
		end
		register_by_name[parameter.name] = index - 1
	end
	return register_by_name
end

local add_constant<const> = function(state, value)
	local index = state.const_index_by_value[value]
	if index ~= nil then
		return index
	end
	index = #state.const_pool + 1
	state.const_pool[index] = value
	state.const_index_by_value[value] = index
	return index
end

local constant_register<const> = function(parameter_count, const_index)
	return parameter_count + const_index - 2
end

local literal_value<const> = function(state, expression, path_key)
	local kind<const> = expression.kind
	if kind == syntax.number_literal_expression or kind == syntax.string_literal_expression then
		return expression.value
	end
	if kind == syntax.unary_expression then
		local operand<const> = expression.operand
		if expression.operator == syntax.unary_negate
			and operand.kind == syntax.number_literal_expression then
			return -operand.value
		end
		if expression.operator == syntax.unary_string_id
			and operand.kind == syntax.string_literal_expression then
			return operand.value
		end
	end
	fail(
		state.chunk_name,
		path_key and 'path keys must be string or numeric literals'
			or 'unsupported literal expression',
		expression
	)
end

local bind_path
bind_path = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression then
		local register<const> = state.parameter_register_by_name[expression.name]
		if register == nil then
			fail(state.chunk_name, "unknown function parameter '" .. expression.name .. "'", expression)
		end
		state.binding[expression] = register
		return
	end
	if kind == syntax.member_expression then
		bind_path(state, expression.base)
		state.binding[expression] = add_constant(state, expression.identifier)
		return
	end
	if kind == syntax.index_expression then
		bind_path(state, expression.base)
		state.binding[expression] = add_constant(
			state,
			literal_value(state, expression.index, true)
		)
		return
	end
	fail(state.chunk_name, 'paths must start at a function parameter', expression)
end

local bind_value<const> = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		bind_path(state, expression)
		return
	end
	if kind == syntax.nil_literal_expression or kind == syntax.boolean_literal_expression then
		return
	end
	state.binding[expression] = add_constant(
		state,
		literal_value(state, expression, false)
	)
end

local bind_assignment<const> = function(state, statement)
	if statement.kind ~= syntax.assignment_statement then
		fail(state.chunk_name, 'function body only supports assignments', statement)
	end
	local target<const> = statement.target
	bind_path(state, target)
	if target.kind == syntax.identifier_expression then
		fail(state.chunk_name, 'direct parameter assignment is unsupported', target)
	end
	bind_value(state, statement.value)
end

local emit_path
emit_path = function(state, words, expression, target)
	if expression.kind == syntax.identifier_expression then
		bytecode.emit_abc(words, isa.op_mov, target, state.binding[expression], 0)
		return
	end
	emit_path(state, words, expression.base, target)
	bytecode.emit_abc(
		words,
		isa.op_gett,
		target,
		target,
		constant_register(state.parameter_count, state.binding[expression])
	)
end

local emit_value<const> = function(state, words, expression, target)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		emit_path(state, words, expression, target)
		return
	end
	if kind == syntax.nil_literal_expression then
		bytecode.emit_abc(words, isa.op_knil, target, 0, 0)
		return
	end
	if kind == syntax.boolean_literal_expression then
		bytecode.emit_abc(
			words,
			expression.value and isa.op_ktrue or isa.op_kfalse,
			target,
			0,
			0
		)
		return
	end
	bytecode.emit_abc(
		words,
		isa.op_mov,
		target,
		constant_register(state.parameter_count, state.binding[expression]),
		0
	)
end

local emit_assignment<const> = function(
	words,
	state,
	statement,
	target_register,
	value_register
)
	local target<const> = statement.target
	emit_path(state, words, target.base, target_register)
	emit_value(state, words, statement.value, value_register)
	bytecode.emit_abc(
		words,
		isa.op_sett,
		target_register,
		constant_register(state.parameter_count, state.binding[target]),
		value_register
	)
end

local compile_function<const> = function(function_expression, chunk_name)
	local const_pool<const> = { 0 }
	local parameter_count<const> = #function_expression.parameters
	local state<const> = {
		chunk_name = chunk_name,
		parameter_count = parameter_count,
		parameter_register_by_name = bind_parameters(function_expression, chunk_name),
		const_pool = const_pool,
		const_index_by_value = {},
		binding = {},
	}
	local statements<const> = function_expression.body.statements
	for index = 1, #statements do
		bind_assignment(state, statements[index])
	end

	local value_count<const> = #const_pool - 1
	local words<const> = {}
	for index = 0, value_count - 1 do
		bytecode.emit_abc(words, isa.op_getup, parameter_count + index, index, 0)
	end
	local target_register<const> = parameter_count + value_count
	local value_register<const> = target_register + 1
	for index = 1, #statements do
		emit_assignment(
			words,
			state,
			statements[index],
			target_register,
			value_register
		)
	end
	bytecode.emit_abc(words, isa.op_knil, target_register, 0, 0)
	bytecode.emit_abc(words, isa.op_ret, target_register, 1, 0)

	local upvalue_registers<const> = {}
	for index = 1, value_count do
		upvalue_registers[index] = index + 1
	end
	return {
		words = words,
		parameter_count = parameter_count,
		max_stack = value_register + 1,
		upvalue_registers = upvalue_registers,
	}, const_pool
end

local compile_chunk<const> = function(const_pool, const_pool_register)
	local value_count<const> = #const_pool - 1
	local words<const> = {}
	bytecode.emit_abc(words, isa.op_getup, 0, 0, 0)
	bytecode.emit_abc(words, isa.op_geti, 1, 0, 1)
	for index = 0, value_count - 1 do
		bytecode.emit_abc(words, isa.op_geti, index + 2, 0, index + 2)
	end
	local closure_register<const> = value_count + 2
	bytecode.emit_closure_address_register(words, closure_register, 1)
	bytecode.emit_abc(words, isa.op_ret, closure_register, 1, 0)
	return {
		words = words,
		parameter_count = 0,
		max_stack = closure_register + 1,
		upvalue_registers = { const_pool_register },
	}
end

function compiler.compile(chunk, chunk_name, root_const_pool_register)
	local function_expression<const> = returned_function(chunk, chunk_name)
	local function_proto<const>, const_pool<const> = compile_function(
		function_expression,
		chunk_name
	)
	return {
		protos = {
			compile_chunk(const_pool, root_const_pool_register),
			function_proto,
		},
		root_proto_index = 1,
		const_pool = const_pool,
		const_relocations = {
			{ const_index = 1, proto_index = 2 },
		},
	}
end

return compiler
