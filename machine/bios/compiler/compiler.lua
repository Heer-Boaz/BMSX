local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local semantic<const> = require('compiler/semantic')
local syntax<const> = require('compiler/syntax')

local compiler<const> = {}
local function_address_pool_index<const> = 1
local first_value_pool_index<const> = 2

local opcode_by_binary_operator<const> = {
	[syntax.binary_add] = isa.op_add,
	[syntax.binary_subtract] = isa.op_sub,
	[syntax.binary_multiply] = isa.op_mul,
	[syntax.binary_divide] = isa.op_div,
	[syntax.binary_floor_divide] = isa.op_floor_divide,
	[syntax.binary_modulus] = isa.op_mod,
}

local constant_register<const> = function(parameter_count, const_index)
	return parameter_count + const_index - first_value_pool_index
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
			and expression.operand.kind == syntax.number_literal_expression
		)
end

local add_constant<const> = function(state, expression, value)
	local index = state.constant_index_by_value[value]
	if index == nil then
		index = #state.const_pool + 1
		state.const_pool[index] = value
		state.constant_index_by_value[value] = index
	end
	expression.constant_index = index
end

local prepare_path_operands
prepare_path_operands = function(state, expression)
	if expression.kind == syntax.identifier_expression then
		return
	end
	prepare_path_operands(state, expression.base)
	local key_value<const> = expression.key_value
	if expression.kind == syntax.index_expression then
		local immediate_index<const> = immediate_table_index(
			expression.index,
			key_value
		)
		if immediate_index ~= nil then
			expression.immediate_index = immediate_index
			return
		end
	end
	add_constant(state, expression, key_value)
end

local prepare_value_operands
prepare_value_operands = function(state, expression)
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
	if kind == syntax.binary_expression then
		prepare_value_operands(state, expression.left)
		prepare_value_operands(state, expression.right)
		return
	end
	if kind == syntax.unary_expression
		and expression.constant_value == nil then
		prepare_value_operands(state, expression.operand)
		return
	end
	local value<const> = expression.constant_value
	if is_number_literal(expression)
		and value >= isa.min_signed_bx
		and value <= isa.max_signed_bx
		and value % 1 == 0 then
		expression.immediate_number = value
		if value ~= 0 and value ~= 1 and value ~= -1 then
			return
		end
		return
	end
	add_constant(state, expression, value)
end

local materialize_wide_immediates
materialize_wide_immediates = function(state, expression)
	if expression.kind == syntax.binary_expression then
		materialize_wide_immediates(state, expression.left)
		materialize_wide_immediates(state, expression.right)
		return
	end
	if expression.kind == syntax.unary_expression
		and expression.constant_value == nil then
		materialize_wide_immediates(state, expression.operand)
		return
	end
	local value<const> = expression.immediate_number
	if value ~= nil and value ~= 0 and value ~= 1 and value ~= -1 then
		expression.immediate_number = nil
		add_constant(state, expression, value)
	end
end

local prepare_codegen<const> = function(function_expression)
	local state<const> = {
		function_expression = function_expression,
		parameter_count = #function_expression.parameters,
		const_pool = { 0 },
		constant_index_by_value = {},
	}
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		local statement<const> = statements[index]
		prepare_path_operands(state, statement.target)
		prepare_value_operands(state, statement.value)
	end
	local first_temporary_register<const> = state.parameter_count
		+ #state.const_pool
		- function_address_pool_index
	if first_temporary_register > isa.max_wide_operand then
		for index = 1, #statements do
			materialize_wide_immediates(state, statements[index].value)
		end
	end
	return state
end

local reserve_register<const> = function(state)
	local register<const> = state.free_register
	local free_register<const> = register + 1
	state.free_register = free_register
	if free_register > state.max_stack then
		state.max_stack = free_register
	end
	return register
end

local emit_path
emit_path = function(state, instruction_words, expression, target)
	if expression.kind == syntax.identifier_expression then
		return expression.parameter_register
	end
	local base_register<const> = emit_path(
		state,
		instruction_words,
		expression.base,
		target
	)
	local immediate_index<const> = expression.immediate_index
	if immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_geti,
			target,
			base_register,
			immediate_index
		)
		return target
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_gett,
		target,
		base_register,
		constant_register(
			state.parameter_count,
			expression.constant_index
		)
	)
	return target
end

local emit_value

local emit_binary_expression<const> = function(
	state,
	instruction_words,
	expression,
	target
)
	local left_register<const> = emit_value(
		state,
		instruction_words,
		expression.left,
		target
	)
	local right_target = target
	if left_register == target then
		right_target = reserve_register(state)
	end
	local right_register<const> = emit_value(
		state,
		instruction_words,
		expression.right,
		right_target
	)
	bytecode.emit_abc(
		instruction_words,
		opcode_by_binary_operator[expression.operator],
		target,
		left_register,
		right_register
	)
	if right_target ~= target then
		state.free_register = right_target
	end
	return target
end

emit_value = function(
	state,
	instruction_words,
	expression,
	target
)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		return emit_path(state, instruction_words, expression, target)
	end
	if kind == syntax.binary_expression then
		return emit_binary_expression(
			state,
			instruction_words,
			expression,
			target
		)
	end
	if kind == syntax.unary_expression
		and expression.constant_value == nil then
		local operand_register<const> = emit_value(
			state,
			instruction_words,
			expression.operand,
			target
		)
		bytecode.emit_abc(
			instruction_words,
			isa.op_unm,
			target,
			operand_register,
			0
		)
		return target
	end
	if kind == syntax.nil_literal_expression then
		bytecode.emit_abc(instruction_words, isa.op_knil, target, 0, 0)
		return target
	end
	if kind == syntax.boolean_literal_expression then
		bytecode.emit_abc(
			instruction_words,
			expression.value and isa.op_ktrue or isa.op_kfalse,
			target,
			0,
			0
		)
		return target
	end
	local immediate_number<const> = expression.immediate_number
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
		return target
	end
	return constant_register(
		state.parameter_count,
		expression.constant_index
	)
end

local emit_assignment<const> = function(
	state,
	instruction_words,
	statement
)
	local temporary_base<const> = reserve_register(state)
	local target<const> = statement.target
	local target_table_register<const> = emit_path(
		state,
		instruction_words,
		target.base,
		temporary_base
	)
	local value_target_register = temporary_base
	if target_table_register == temporary_base then
		value_target_register = reserve_register(state)
	end
	local assignment_value_register<const> = emit_value(
		state,
		instruction_words,
		statement.value,
		value_target_register
	)
	local immediate_index<const> = target.immediate_index
	if immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_seti,
			target_table_register,
			immediate_index,
			assignment_value_register
		)
	else
		bytecode.emit_abc(
			instruction_words,
			isa.op_sett,
			target_table_register,
			constant_register(
				state.parameter_count,
				target.constant_index
			),
			assignment_value_register
		)
	end
	state.free_register = temporary_base
end

local compile_function<const> = function(state)
	local parameter_count<const> = state.parameter_count
	local constant_count<const> = #state.const_pool - function_address_pool_index
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
	local first_temporary_register<const> = parameter_count + constant_count
	state.free_register = first_temporary_register
	state.max_stack = first_temporary_register
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		emit_assignment(
			state,
			instruction_words,
			statements[index]
		)
	end
	local return_register<const> = reserve_register(state)
	bytecode.emit_abc(instruction_words, isa.op_knil, return_register, 0, 0)
	bytecode.emit_abc(instruction_words, isa.op_ret, return_register, 1, 0)

	local upvalue_registers<const> = {}
	for index = 1, constant_count do
		upvalue_registers[index] = first_value_pool_index + index - 1
	end
	return {
		instruction_words = instruction_words,
		parameter_count = parameter_count,
		max_stack = state.max_stack,
		upvalue_registers = upvalue_registers,
	}
end

local compile_chunk<const> = function(constant_count, captured_const_pool_register)
	local instruction_words<const> = {}
	local const_pool_register<const> = 0
	local function_address_register<const> = function_address_pool_index
	local last_pool_index<const> = constant_count + function_address_pool_index
	bytecode.emit_abc(instruction_words, isa.op_getup, const_pool_register, 0, 0)
	for index = function_address_pool_index, last_pool_index do
		bytecode.emit_abc(instruction_words, isa.op_geti, index, const_pool_register, index)
	end
	bytecode.emit_closure_address_register(
		instruction_words,
		const_pool_register,
		function_address_register
	)
	bytecode.emit_abc(instruction_words, isa.op_ret, const_pool_register, 1, 0)
	return {
		instruction_words = instruction_words,
		parameter_count = 0,
		max_stack = constant_count + 2,
		upvalue_registers = { captured_const_pool_register },
	}
end

function compiler.compile(chunk, chunk_name, root_const_pool_register)
	local function_expression<const> = semantic.bind(chunk, chunk_name)
	local state<const> = prepare_codegen(function_expression)
	local const_pool<const> = state.const_pool
	local constant_count<const> = #const_pool - function_address_pool_index
	local max_stack<const> = isa.max_ext_register_a + 1
	if constant_count + 2 > max_stack
		or state.parameter_count + constant_count + 1 > max_stack then
		error('[load:' .. chunk_name .. '] function or expression needs too many registers')
	end
	local chunk_proto<const> = compile_chunk(constant_count, root_const_pool_register)
	local function_proto<const> = compile_function(state)
	if function_proto.max_stack > max_stack then
		error('[load:' .. chunk_name .. '] function or expression needs too many registers')
	end
	return {
		protos = {
			chunk_proto,
			function_proto,
		},
		root_proto_index = 1,
		const_pool = const_pool,
		const_relocations = {
			{ const_index = function_address_pool_index, proto_index = 2 },
		},
	}
end

return compiler
