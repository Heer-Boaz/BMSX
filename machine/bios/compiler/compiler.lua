local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local semantic<const> = require('compiler/semantic')
local syntax<const> = require('compiler/syntax')

local compiler<const> = {}

local constant_register<const> = function(parameter_count, const_index)
	return parameter_count + const_index - 2
end

local immediate_table_index<const> = function(expression, value)
	if expression.kind == syntax.number_literal_expression
		and value >= 1
		and value <= isa.max_ext_register_bc
		and value % 1 == 0 then
		return value
	end
end

local is_number_literal<const> = function(expression)
	return expression.kind == syntax.number_literal_expression
		or (
			expression.kind == syntax.unary_expression
			and expression.operator == syntax.unary_negate
		)
end

local add_constant<const> = function(state, expression, value)
	local index = state.constant_index_by_value[value]
	if index == nil then
		index = #state.const_pool + 1
		state.const_pool[index] = value
		state.constant_index_by_value[value] = index
	end
	state.constant_index_by_expression[expression] = index
end

local prepare_path_operands
prepare_path_operands = function(state, expression)
	if expression.kind == syntax.identifier_expression then
		return
	end
	prepare_path_operands(state, expression.base)
	local key_value<const> = state.key_value_by_expression[expression]
	if expression.kind == syntax.index_expression then
		local immediate_index<const> = immediate_table_index(
			expression.index,
			key_value
		)
		if immediate_index ~= nil then
			state.immediate_index_by_expression[expression] = immediate_index
			return
		end
	end
	add_constant(state, expression, key_value)
end

local prepare_value_operands<const> = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		prepare_path_operands(state, expression)
		return
	end
	if kind == syntax.nil_literal_expression
		or kind == syntax.boolean_literal_expression then
		return
	end
	local value<const> = state.value_by_expression[expression]
	if is_number_literal(expression)
		and value >= isa.min_signed_bx
		and value <= isa.max_signed_bx
		and value % 1 == 0 then
		state.immediate_number_by_expression[expression] = value
		return
	end
	add_constant(state, expression, value)
end

local prepare_codegen<const> = function(analysis)
	local state<const> = {
		function_expression = analysis.function_expression,
		parameter_count = analysis.parameter_count,
		parameter_register_by_expression = analysis.parameter_register_by_expression,
		key_value_by_expression = analysis.key_value_by_expression,
		value_by_expression = analysis.value_by_expression,
		constant_index_by_expression = {},
		immediate_index_by_expression = {},
		immediate_number_by_expression = {},
		const_pool = { 0 },
		constant_index_by_value = {},
	}
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		local statement<const> = statements[index]
		prepare_path_operands(state, statement.target)
		prepare_value_operands(state, statement.value)
	end
	return state
end

local emit_path
emit_path = function(state, instruction_words, expression, target)
	if expression.kind == syntax.identifier_expression then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			state.parameter_register_by_expression[expression],
			0
		)
		return
	end
	emit_path(state, instruction_words, expression.base, target)
	local immediate_index<const> = state.immediate_index_by_expression[expression]
	if immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_geti,
			target,
			target,
			immediate_index
		)
		return
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_gett,
		target,
		target,
		constant_register(
			state.parameter_count,
			state.constant_index_by_expression[expression]
		)
	)
end

local emit_value<const> = function(
	state,
	instruction_words,
	expression,
	target
)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		emit_path(state, instruction_words, expression, target)
		return
	end
	if kind == syntax.nil_literal_expression then
		bytecode.emit_abc(instruction_words, isa.op_knil, target, 0, 0)
		return
	end
	if kind == syntax.boolean_literal_expression then
		bytecode.emit_abc(
			instruction_words,
			expression.value and isa.op_ktrue or isa.op_kfalse,
			target,
			0,
			0
		)
		return
	end
	local immediate_number<const> = state.immediate_number_by_expression[expression]
	if immediate_number ~= nil then
		if immediate_number == 0 then
			bytecode.emit_abc(instruction_words, isa.op_k0, target, 0, 0)
		elseif immediate_number == 1 then
			bytecode.emit_abc(instruction_words, isa.op_k1, target, 0, 0)
		elseif immediate_number == -1 then
			bytecode.emit_abc(instruction_words, isa.op_km1, target, 0, 0)
		else
			bytecode.emit_signed_abx(
				instruction_words,
				isa.op_ksmi,
				target,
				immediate_number
			)
		end
		return
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_mov,
		target,
		constant_register(
			state.parameter_count,
			state.constant_index_by_expression[expression]
		),
		0
	)
end

local emit_assignment<const> = function(
	instruction_words,
	state,
	statement,
	target_register,
	value_register
)
	local target<const> = statement.target
	emit_path(state, instruction_words, target.base, target_register)
	emit_value(state, instruction_words, statement.value, value_register)
	local immediate_index<const> = state.immediate_index_by_expression[target]
	if immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_seti,
			target_register,
			immediate_index,
			value_register
		)
		return
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_sett,
		target_register,
		constant_register(
			state.parameter_count,
			state.constant_index_by_expression[target]
		),
		value_register
	)
end

local compile_function<const> = function(state)
	local parameter_count<const> = state.parameter_count
	local constant_count<const> = #state.const_pool - 1
	local instruction_words<const> = {}
	for index = 0, constant_count - 1 do
		bytecode.emit_abc(
			instruction_words,
			isa.op_getup,
			parameter_count + index,
			index,
			0
		)
	end
	local target_register<const> = parameter_count + constant_count
	local value_register<const> = target_register + 1
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		emit_assignment(
			instruction_words,
			state,
			statements[index],
			target_register,
			value_register
		)
	end
	bytecode.emit_abc(instruction_words, isa.op_knil, target_register, 0, 0)
	bytecode.emit_abc(instruction_words, isa.op_ret, target_register, 1, 0)

	local upvalue_registers<const> = {}
	for index = 1, constant_count do
		upvalue_registers[index] = index + 1
	end
	return {
		instruction_words = instruction_words,
		parameter_count = parameter_count,
		max_stack = value_register + 1,
		upvalue_registers = upvalue_registers,
	}
end

local compile_chunk<const> = function(constant_count, const_pool_register)
	local instruction_words<const> = {}
	bytecode.emit_abc(instruction_words, isa.op_getup, 0, 0, 0)
	for index = 1, constant_count + 1 do
		bytecode.emit_abc(instruction_words, isa.op_geti, index, 0, index)
	end
	local closure_register<const> = constant_count + 2
	bytecode.emit_closure_address_register(
		instruction_words,
		closure_register,
		1
	)
	bytecode.emit_abc(instruction_words, isa.op_ret, closure_register, 1, 0)
	return {
		instruction_words = instruction_words,
		parameter_count = 0,
		max_stack = closure_register + 1,
		upvalue_registers = { const_pool_register },
	}
end

function compiler.compile(chunk, chunk_name, root_const_pool_register)
	local analysis<const> = semantic.analyze(chunk, chunk_name)
	local state<const> = prepare_codegen(analysis)
	local const_pool<const> = state.const_pool
	return {
		protos = {
			compile_chunk(#const_pool - 1, root_const_pool_register),
			compile_function(state),
		},
		root_proto_index = 1,
		const_pool = const_pool,
		const_relocations = {
			{ const_index = 1, proto_index = 2 },
		},
	}
end

return compiler
