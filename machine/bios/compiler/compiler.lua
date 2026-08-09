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
		if value ~= 0 and value ~= 1 and value ~= -1 then
			return expression
		end
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
	local ksmi_expressions
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		local statement<const> = statements[index]
		prepare_path_operands(state, statement.target)
		local ksmi_expression<const> = prepare_value_operands(state, statement.value)
		if ksmi_expression ~= nil then
			if ksmi_expressions == nil then
				ksmi_expressions = {}
			end
			ksmi_expressions[#ksmi_expressions + 1] = ksmi_expression
		end
	end
	local value_register<const> = state.parameter_count + #state.const_pool
	if ksmi_expressions ~= nil and value_register > isa.max_wide_operand then
		for index = 1, #ksmi_expressions do
			local expression<const> = ksmi_expressions[index]
			state.immediate_number_by_expression[expression] = nil
			add_constant(state, expression, state.value_by_expression[expression])
		end
	end
	return state
end

local emit_path
emit_path = function(state, instruction_words, expression, target)
	if expression.kind == syntax.identifier_expression then
		return state.parameter_register_by_expression[expression]
	end
	local base_register<const> = emit_path(
		state,
		instruction_words,
		expression.base,
		target
	)
	local immediate_index<const> = state.immediate_index_by_expression[expression]
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
			state.constant_index_by_expression[expression]
		)
	)
	return target
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
		return emit_path(state, instruction_words, expression, target)
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
		return target
	end
	return constant_register(
		state.parameter_count,
		state.constant_index_by_expression[expression]
	)
end

local emit_assignment<const> = function(
	instruction_words,
	state,
	statement,
	scratch_register
)
	local target<const> = statement.target
	local target_table_register<const> = emit_path(
		state,
		instruction_words,
		target.base,
		scratch_register
	)
	local value_target_register = scratch_register
	if target_table_register == scratch_register then
		value_target_register = value_target_register + 1
	end
	local assignment_value_register<const> = emit_value(
		state,
		instruction_words,
		statement.value,
		value_target_register
	)
	local immediate_index<const> = state.immediate_index_by_expression[target]
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
				state.constant_index_by_expression[target]
			),
			assignment_value_register
		)
	end
	return assignment_value_register > scratch_register
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
	local scratch_register<const> = parameter_count + constant_count
	local uses_second_scratch = false
	local statements<const> = state.function_expression.body.statements
	for index = 1, #statements do
		if emit_assignment(
			instruction_words,
			state,
			statements[index],
			scratch_register
		) then
			uses_second_scratch = true
		end
	end
	bytecode.emit_abc(instruction_words, isa.op_knil, scratch_register, 0, 0)
	bytecode.emit_abc(instruction_words, isa.op_ret, scratch_register, 1, 0)

	local upvalue_registers<const> = {}
	for index = 1, constant_count do
		upvalue_registers[index] = index + 1
	end
	return {
		instruction_words = instruction_words,
		parameter_count = parameter_count,
		max_stack = scratch_register + (uses_second_scratch and 2 or 1),
		upvalue_registers = upvalue_registers,
	}
end

local compile_chunk<const> = function(constant_count, captured_const_pool_register)
	local instruction_words<const> = {}
	local const_pool_register<const> = 0
	local function_address_register<const> = 1
	bytecode.emit_abc(instruction_words, isa.op_getup, const_pool_register, 0, 0)
	for index = 1, constant_count + 1 do
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
	local analysis<const> = semantic.analyze(chunk, chunk_name)
	local state<const> = prepare_codegen(analysis)
	local const_pool<const> = state.const_pool
	local constant_count<const> = #const_pool - 1
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
			{ const_index = 1, proto_index = 2 },
		},
	}
end

return compiler
