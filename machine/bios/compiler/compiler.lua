local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local semantic<const> = require('compiler/semantic')
local syntax<const> = require('compiler/syntax')

local compiler<const> = {}

local op_getup<const> = isa.op_getup

local opcode_by_binary_operator<const> = {
	[syntax.binary_add] = isa.op_add,
	[syntax.binary_subtract] = isa.op_sub,
	[syntax.binary_multiply] = isa.op_mul,
	[syntax.binary_divide] = isa.op_div,
	[syntax.binary_floor_divide] = isa.op_floor_divide,
	[syntax.binary_modulus] = isa.op_mod,
	[syntax.binary_bitwise_and] = isa.op_band,
}

local opcode_by_comparison_operator<const> = {
	[syntax.binary_equal] = isa.op_eq,
	[syntax.binary_not_equal] = isa.op_eq,
	[syntax.binary_less] = isa.op_lt,
	[syntax.binary_less_equal] = isa.op_le,
	[syntax.binary_greater] = isa.op_lt,
	[syntax.binary_greater_equal] = isa.op_le,
}

local opcode_by_unary_operator<const> = {
	[syntax.unary_negate] = isa.op_unm,
	[syntax.unary_not] = isa.op_not,
	[syntax.unary_length] = isa.op_len,
}

local constant_register<const> = function(state, const_index)
	return state.constant_register_by_index[const_index]
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

local add_constant<const> = function(state, value)
	local index = state.program.constant_index_by_value[value]
	if index == nil then
		local const_pool<const> = state.program.const_pool
		index = #const_pool + 1
		const_pool[index] = value
		state.program.constant_index_by_value[value] = index
	end
	state.direct_constant_by_index[index] = true
	return index
end

local prepare_path_operands
local prepare_value_operands

prepare_path_operands = function(state, expression)
	if expression.kind == syntax.identifier_expression then
		if expression.environment_key ~= nil then
			state.environment_constant_index = add_constant(
				state,
				state.program.environment
			)
			expression.constant_index = add_constant(
				state,
				expression.environment_key
			)
		end
		return
	end
	prepare_path_operands(state, expression.base)
	local key_value<const> = expression.key_value
	if expression.kind == syntax.index_expression and key_value == nil then
		prepare_value_operands(state, expression.index)
		return
	end
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
	expression.constant_index = add_constant(state, key_value)
end

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
	if kind == syntax.function_expression then
		return
	end
	if kind == syntax.binary_expression then
		prepare_value_operands(state, expression.left)
		prepare_value_operands(state, expression.right)
		return
	end
	if kind == syntax.call_expression then
		prepare_value_operands(state, expression.callee)
		local method_name<const> = expression.method_name
		if method_name ~= nil then
			expression.method_constant_index = add_constant(state, method_name)
		end
		local arguments<const> = expression.arguments
		for index = 1, #arguments do
			prepare_value_operands(state, arguments[index])
		end
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
	expression.constant_index = add_constant(state, value)
end

local materialize_wide_immediates
materialize_wide_immediates = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression then
		return
	end
	if kind == syntax.function_expression then
		return
	end
	if kind == syntax.member_expression or kind == syntax.index_expression then
		materialize_wide_immediates(state, expression.base)
		if kind == syntax.index_expression and expression.key_value == nil then
			materialize_wide_immediates(state, expression.index)
		end
		return
	end
	if kind == syntax.binary_expression then
		materialize_wide_immediates(state, expression.left)
		materialize_wide_immediates(state, expression.right)
		return
	end
	if kind == syntax.call_expression then
		materialize_wide_immediates(state, expression.callee)
		local arguments<const> = expression.arguments
		for index = 1, #arguments do
			materialize_wide_immediates(state, arguments[index])
		end
		return
	end
	if kind == syntax.unary_expression
		and expression.constant_value == nil then
		materialize_wide_immediates(state, expression.operand)
		return
	end
	local value<const> = expression.immediate_number
	if value ~= nil and value ~= 0 and value ~= 1 and value ~= -1 then
		expression.immediate_number = nil
		expression.constant_index = add_constant(state, value)
	end
end

local prepare_statement_operands
local prepare_block_operands<const> = function(state, block)
	local statements<const> = block.statements
	for index = 1, #statements do
		prepare_statement_operands(state, statements[index])
	end
end

prepare_statement_operands = function(state, statement)
	local kind<const> = statement.kind
	if kind == syntax.assignment_statement then
		prepare_path_operands(state, statement.target)
		prepare_value_operands(state, statement.value)
		return
	end
	if kind == syntax.call_statement then
		prepare_value_operands(state, statement.expression)
		return
	end
	if kind == syntax.local_statement then
		if statement.initializer ~= nil then
			prepare_value_operands(state, statement.initializer)
		end
		return
	end
	if kind == syntax.if_statement then
		local clauses<const> = statement.clauses
		for index = 1, #clauses do
			local clause<const> = clauses[index]
			if clause.condition ~= nil then
				prepare_value_operands(state, clause.condition)
			end
			prepare_block_operands(state, clause.block)
		end
		return
	end
	if kind == syntax.while_statement then
		prepare_value_operands(state, statement.condition)
		prepare_block_operands(state, statement.block)
		return
	end
	if kind == syntax.numeric_for_statement then
		prepare_value_operands(state, statement.start_expression)
		prepare_value_operands(state, statement.limit_expression)
		local step_expression<const> = statement.step_expression
		if step_expression ~= nil then
			prepare_value_operands(state, step_expression)
			if not is_number_literal(step_expression) then
				statement.zero_constant_index = add_constant(state, 0)
			end
		end
		prepare_block_operands(state, statement.block)
		return
	end
	if kind == syntax.break_statement then
		return
	end
	local expressions<const> = statement.expressions
	for index = 1, #expressions do
		prepare_value_operands(state, expressions[index])
	end
end

local materialize_statement_immediates
local materialize_block_immediates<const> = function(state, block)
	local statements<const> = block.statements
	for index = 1, #statements do
		materialize_statement_immediates(state, statements[index])
	end
end

materialize_statement_immediates = function(state, statement)
	local kind<const> = statement.kind
	if kind == syntax.assignment_statement then
		materialize_wide_immediates(state, statement.target)
		materialize_wide_immediates(state, statement.value)
		return
	end
	if kind == syntax.call_statement then
		materialize_wide_immediates(state, statement.expression)
		return
	end
	if kind == syntax.local_statement then
		if statement.initializer ~= nil then
			materialize_wide_immediates(state, statement.initializer)
		end
		return
	end
	if kind == syntax.if_statement then
		local clauses<const> = statement.clauses
		for index = 1, #clauses do
			local clause<const> = clauses[index]
			if clause.condition ~= nil then
				materialize_wide_immediates(state, clause.condition)
			end
			materialize_block_immediates(state, clause.block)
		end
		return
	end
	if kind == syntax.while_statement then
		materialize_wide_immediates(state, statement.condition)
		materialize_block_immediates(state, statement.block)
		return
	end
	if kind == syntax.numeric_for_statement then
		materialize_wide_immediates(state, statement.start_expression)
		materialize_wide_immediates(state, statement.limit_expression)
		if statement.step_expression ~= nil then
			materialize_wide_immediates(state, statement.step_expression)
		end
		materialize_block_immediates(state, statement.block)
		return
	end
	if kind == syntax.break_statement then
		return
	end
	local expressions<const> = statement.expressions
	for index = 1, #expressions do
		materialize_wide_immediates(state, expressions[index])
	end
end

local prepare_codegen<const> = function(program, function_expression)
	local state<const> = {
		program = program,
		function_expression = function_expression,
		parameter_count = #function_expression.parameters,
		local_count = function_expression.local_count,
		direct_constant_by_index = {},
		required_constant_by_index = {},
		constant_register_by_index = {},
		constant_upvalue_by_index = {},
		immutable_upvalue_register_by_index = {},
	}
	prepare_block_operands(state, state.function_expression.body)
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

local identifier_register<const> = function(state, expression)
	local binding<const> = expression.binding
	if binding.kind == 'parameter' then
		return binding.register
	end
	return state.local_register_base + binding.slot
end

local environment_register<const> = function(state)
	return constant_register(
		state,
		state.environment_constant_index
	)
end

local emit_value
local emit_value_register
local emit_path

-- Temporary destinations may be reused while their operands are evaluated.
-- Fixed destinations remain readable until the expression's final write.
-- A single-use immutable capture loads into that destination directly; reused
-- or loop-carried captures retain one fixed register for the function call.
emit_path = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	if expression.kind == syntax.identifier_expression then
		if expression.upvalue ~= nil then
			local upvalue<const> = expression.upvalue
			if not upvalue.binding.is_const
			or (upvalue.direct_use_count == 1 and not upvalue.used_in_loop) then
				bytecode.emit_abc(
					instruction_words,
					op_getup,
					target,
					upvalue.upvalue_index,
					0
				)
				return target
			end
			return state.immutable_upvalue_register_by_index[
				upvalue.upvalue_index
			]
		end
		if expression.environment_key ~= nil then
			bytecode.emit_abc(
				instruction_words,
				isa.op_gett,
				target,
				environment_register(state),
				constant_register(
					state,
					expression.constant_index
				)
			)
			return target
		end
		return identifier_register(state, expression)
	end
	local temporary_base<const> = state.free_register
	local base_register
	if target_is_temporary then
		base_register = emit_path(
			state,
			instruction_words,
			expression.base,
			target,
			true
		)
	else
		base_register = emit_value_register(
			state,
			instruction_words,
			expression.base
		)
	end
	if expression.kind == syntax.index_expression
		and expression.key_value == nil then
		local index_register
		if base_register == target then
			index_register = emit_value_register(
				state,
				instruction_words,
				expression.index
			)
		else
			index_register = emit_value(
				state,
				instruction_words,
				expression.index,
				target,
				target_is_temporary
			)
		end
		bytecode.emit_abc(
			instruction_words,
			isa.op_gett,
			target,
			base_register,
			index_register
		)
		state.free_register = temporary_base
		return target
	end
	local immediate_index<const> = expression.immediate_index
	if immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_geti,
			target,
			base_register,
			immediate_index
		)
		state.free_register = temporary_base
		return target
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_gett,
		target,
		base_register,
		constant_register(
			state,
			expression.constant_index
		)
	)
	state.free_register = temporary_base
	return target
end

local emit_logical_expression<const> = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	local temporary_base<const> = state.free_register
	local result_target = target
	if not target_is_temporary then
		result_target = reserve_register(state)
	end
	local expression_temporary_base<const> = state.free_register
	local left_register<const> = emit_value(
		state,
		instruction_words,
		expression.left,
		result_target,
		true
	)
	if left_register ~= result_target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			result_target,
			left_register,
			0
		)
	end
	local operator<const> = expression.operator
	local jump_index<const> = bytecode.emit_signed_abx(
		instruction_words,
		operator == syntax.binary_and and isa.op_jmpifnot or isa.op_jmpif,
		result_target,
		0
	)
	state.free_register = expression_temporary_base
	local right_register<const> = emit_value(
		state,
		instruction_words,
		expression.right,
		result_target,
		true
	)
	if right_register ~= result_target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			result_target,
			right_register,
			0
		)
	end
	bytecode.patch_branch(
		instruction_words,
		jump_index,
		#instruction_words - jump_index
	)
	if result_target ~= target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			result_target,
			0
		)
	end
	state.free_register = temporary_base
	return target
end

local emit_call_expression<const> = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	local temporary_base<const> = state.free_register
	local use_target<const> = target_is_temporary
		and target >= state.temporary_register_base
		and target + 1 == temporary_base
	local call_base = target
	if not use_target then
		call_base = reserve_register(state)
	end
	local method_name<const> = expression.method_name
	if method_name ~= nil then
		local self_register<const> = reserve_register(state)
		local receiver_register<const> = emit_value(
			state,
			instruction_words,
			expression.callee,
			self_register,
			true
		)
		if receiver_register ~= self_register then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				self_register,
				receiver_register,
				0
			)
		end
		bytecode.emit_abc(
			instruction_words,
			isa.op_gett,
			call_base,
			self_register,
			constant_register(state, expression.method_constant_index)
		)
	else
		local callee_register<const> = emit_value(
			state,
			instruction_words,
			expression.callee,
			call_base,
			true
		)
		if callee_register ~= call_base then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				call_base,
				callee_register,
				0
			)
		end
	end
	local arguments<const> = expression.arguments
	for index = 1, #arguments do
		local argument_target<const> = reserve_register(state)
		local argument_register<const> = emit_value(
			state,
			instruction_words,
			arguments[index],
			argument_target,
			true
		)
		if argument_register ~= argument_target then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				argument_target,
				argument_register,
				0
			)
		end
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_call,
		call_base,
		#arguments + isa.fixed_call_arg_count_bias
			+ (method_name ~= nil and 1 or 0),
		1
	)
	if not use_target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			call_base,
			0
		)
	end
	state.free_register = temporary_base
	return target
end

local prepare_comparison_operands<const> = function(
	state,
	instruction_words,
	expression
)
	local left_register = emit_value_register(
		state,
		instruction_words,
		expression.left
	)
	local right_register = emit_value_register(
		state,
		instruction_words,
		expression.right
	)
	local operator<const> = expression.operator
	if operator == syntax.binary_greater
		or operator == syntax.binary_greater_equal then
		left_register, right_register = right_register, left_register
	end
	return left_register, right_register
end

local emit_comparison_expression<const> = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	local temporary_base<const> = state.free_register
	local left_register<const>, right_register<const>
		= prepare_comparison_operands(
			state,
			instruction_words,
			expression
		)
	local result_target = target
	if not target_is_temporary
		and (left_register == target or right_register == target) then
		result_target = reserve_register(state)
	end
	local operator<const> = expression.operator
	bytecode.emit_abc(instruction_words, isa.op_kfalse, result_target, 0, 0)
	bytecode.emit_abc(
		instruction_words,
		opcode_by_comparison_operator[operator],
		operator == syntax.binary_not_equal and 0 or 1,
		left_register,
		right_register
	)
	bytecode.emit_abc(instruction_words, isa.op_ktrue, result_target, 0, 0)
	if result_target ~= target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			result_target,
			0
		)
	end
	state.free_register = temporary_base
	return target
end

local emit_binary_expression<const> = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	local operator<const> = expression.operator
	if operator == syntax.binary_and or operator == syntax.binary_or then
		return emit_logical_expression(
			state,
			instruction_words,
			expression,
			target,
			target_is_temporary
		)
	end
	local opcode<const> = opcode_by_binary_operator[operator]
	if opcode == nil then
		return emit_comparison_expression(
			state,
			instruction_words,
			expression,
			target,
			target_is_temporary
		)
	end
	local temporary_base<const> = state.free_register
	local left_register<const> = emit_value_register(
		state,
		instruction_words,
		expression.left
	)
	local right_register
	if left_register == target then
		right_register = emit_value_register(
			state,
			instruction_words,
			expression.right
		)
	else
		right_register = emit_value(
			state,
			instruction_words,
			expression.right,
			target,
			target_is_temporary
		)
	end
	bytecode.emit_abc(
		instruction_words,
		opcode,
		target,
		left_register,
		right_register
	)
	state.free_register = temporary_base
	return target
end

emit_value = function(
	state,
	instruction_words,
	expression,
	target,
	target_is_temporary
)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		return emit_path(
			state,
			instruction_words,
			expression,
			target,
			target_is_temporary
		)
	end
	if kind == syntax.binary_expression then
		return emit_binary_expression(
			state,
			instruction_words,
			expression,
			target,
			target_is_temporary
		)
	end
	if kind == syntax.function_expression then
		bytecode.emit_closure_address_register(
			instruction_words,
			target,
			constant_register(state, expression.function_address_constant_index)
		)
		return target
	end
	if kind == syntax.call_expression then
		return emit_call_expression(
			state,
			instruction_words,
			expression,
			target,
			target_is_temporary
		)
	end
	if kind == syntax.unary_expression
		and expression.constant_value == nil then
		local operand_register<const> = emit_value(
			state,
			instruction_words,
			expression.operand,
			target,
			target_is_temporary
		)
		bytecode.emit_abc(
			instruction_words,
			opcode_by_unary_operator[expression.operator],
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
		state,
		expression.constant_index
	)
end

emit_value_register = function(state, instruction_words, expression)
	if expression.kind == syntax.identifier_expression
		and expression.environment_key == nil then
		local upvalue<const> = expression.upvalue
		if upvalue == nil then
			return identifier_register(state, expression)
		end
		if upvalue.binding.is_const
		and (upvalue.direct_use_count > 1 or upvalue.used_in_loop) then
			return state.immutable_upvalue_register_by_index[
				upvalue.upvalue_index
			]
		end
	end
	if expression.constant_value ~= nil
		and expression.immediate_number == nil then
		return constant_register(
			state,
			expression.constant_index
		)
	end
	local target<const> = reserve_register(state)
	return emit_value(state, instruction_words, expression, target, true)
end

local emit_assignment<const> = function(
	state,
	instruction_words,
	statement
)
	local target<const> = statement.target
	if target.kind == syntax.identifier_expression then
		if target.upvalue ~= nil then
			local value_register<const> = emit_value_register(
				state,
				instruction_words,
				statement.value
			)
			bytecode.emit_abc(
				instruction_words,
				isa.op_setup,
				value_register,
				target.upvalue.upvalue_index,
				0
			)
			return
		end
		if target.environment_key ~= nil then
			local temporary_base<const> = reserve_register(state)
			local value_register<const> = emit_value(
				state,
				instruction_words,
				statement.value,
				temporary_base,
				true
			)
			bytecode.emit_abc(
				instruction_words,
				isa.op_sett,
				environment_register(state),
				constant_register(
					state,
					target.constant_index
				),
				value_register
			)
			state.free_register = temporary_base
			return
		end
		local target_register<const> = identifier_register(state, target)
		local value_register<const> = emit_value(
			state,
			instruction_words,
			statement.value,
			target_register,
			false
		)
		if value_register ~= target_register then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				target_register,
				value_register,
				0
			)
		end
		return
	end
	local temporary_base<const> = reserve_register(state)
	local target_table_register<const> = emit_path(
		state,
		instruction_words,
		target.base,
		temporary_base,
		true
	)
	local target_index_register
	if target.kind == syntax.index_expression
		and target.key_value == nil then
		local index_target = temporary_base
		if target_table_register == temporary_base then
			index_target = reserve_register(state)
		end
		target_index_register = emit_value(
			state,
			instruction_words,
			target.index,
			index_target,
			true
		)
		if index_target ~= temporary_base
			and target_index_register ~= index_target then
			state.free_register = index_target
		end
	end
	local value_target_register = temporary_base
	if target_table_register == temporary_base
		or target_index_register == temporary_base then
		value_target_register = reserve_register(state)
	end
	local assignment_value_register<const> = emit_value(
		state,
		instruction_words,
		statement.value,
		value_target_register,
		true
	)
	if target_index_register ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_sett,
			target_table_register,
			target_index_register,
			assignment_value_register
		)
	elseif target.immediate_index ~= nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_seti,
			target_table_register,
			target.immediate_index,
			assignment_value_register
		)
	else
		bytecode.emit_abc(
			instruction_words,
			isa.op_sett,
			target_table_register,
			constant_register(
				state,
				target.constant_index
			),
			assignment_value_register
		)
	end
	state.free_register = temporary_base
end

local emit_local_statement<const> = function(state, instruction_words, statement)
	local target_register<const> = identifier_register(state, statement.name)
	local initializer<const> = statement.initializer
	if initializer == nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_knil,
			target_register,
			0,
			0
		)
		return
	end
	local value_register<const> = emit_value(
		state,
		instruction_words,
		initializer,
		target_register,
		true
	)
	if value_register ~= target_register then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target_register,
			value_register,
			0
		)
	end
end

local emit_return_statement<const> = function(state, instruction_words, statement)
	local return_target<const> = reserve_register(state)
	local expressions<const> = statement.expressions
	local expression_count<const> = #expressions
	if expression_count == 0 then
		bytecode.emit_abc(
			instruction_words,
			isa.op_knil,
			return_target,
			0,
			0
		)
		bytecode.emit_abc(instruction_words, isa.op_ret, return_target, 1, 0)
		return
	end
	for index = 2, expression_count do
		reserve_register(state)
	end
	for index = 1, expression_count do
		local target_register<const> = return_target + index - 1
		local value_register<const> = emit_value(
			state,
			instruction_words,
			expressions[index],
			target_register,
			true
		)
		if value_register ~= target_register then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				target_register,
				value_register,
				0
			)
		end
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_ret,
		return_target,
		expression_count,
		0
	)
end

local emit_statement
local emit_block

local patch_jumps<const> = function(instruction_words, jumps)
	local target_index<const> = #instruction_words + 1
	for index = 1, #jumps do
		local jump_index<const> = jumps[index]
		bytecode.patch_branch(
			instruction_words,
			jump_index,
			target_index - jump_index - 1
		)
	end
end

local emit_condition_jumps
emit_condition_jumps = function(
	state,
	instruction_words,
	expression,
	jump_on_truthy,
	jumps
)
	local kind<const> = expression.kind
	if kind == syntax.unary_expression
		and expression.operator == syntax.unary_not then
		emit_condition_jumps(
			state,
			instruction_words,
			expression.operand,
			not jump_on_truthy,
			jumps
		)
		return
	end
	if kind == syntax.binary_expression then
		local operator<const> = expression.operator
		if operator == syntax.binary_and then
			if jump_on_truthy then
				local false_jumps<const> = {}
				emit_condition_jumps(
					state,
					instruction_words,
					expression.left,
					false,
					false_jumps
				)
				emit_condition_jumps(
					state,
					instruction_words,
					expression.right,
					true,
					jumps
				)
				patch_jumps(instruction_words, false_jumps)
				return
			end
			emit_condition_jumps(
				state,
				instruction_words,
				expression.left,
				false,
				jumps
			)
			emit_condition_jumps(
				state,
				instruction_words,
				expression.right,
				false,
				jumps
			)
			return
		end
		if operator == syntax.binary_or then
			if jump_on_truthy then
				emit_condition_jumps(
					state,
					instruction_words,
					expression.left,
					true,
					jumps
				)
				emit_condition_jumps(
					state,
					instruction_words,
					expression.right,
					true,
					jumps
				)
				return
			end
			local true_jumps<const> = {}
			emit_condition_jumps(
				state,
				instruction_words,
				expression.left,
				true,
				true_jumps
			)
			emit_condition_jumps(
				state,
				instruction_words,
				expression.right,
				false,
				jumps
			)
			patch_jumps(instruction_words, true_jumps)
			return
		end
		local comparison_opcode<const> = opcode_by_comparison_operator[operator]
		if comparison_opcode ~= nil then
			local temporary_base<const> = state.free_register
			local left_register<const>, right_register<const>
				= prepare_comparison_operands(
					state,
					instruction_words,
					expression
				)
			local expected_result = jump_on_truthy
			if operator == syntax.binary_not_equal then
				expected_result = not expected_result
			end
			bytecode.emit_abc(
				instruction_words,
				comparison_opcode,
				expected_result and 1 or 0,
				left_register,
				right_register
			)
			jumps[#jumps + 1] = bytecode.emit_signed_abx(
				instruction_words,
				isa.op_jmp,
				0,
				0
			)
			state.free_register = temporary_base
			return
		end
	end
	local temporary_base<const> = state.free_register
	local condition_register<const> = reserve_register(state)
	local value_register<const> = emit_value(
		state,
		instruction_words,
		expression,
		condition_register,
		true
	)
	if value_register ~= condition_register then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			condition_register,
			value_register,
			0
		)
	end
	jumps[#jumps + 1] = bytecode.emit_signed_abx(
		instruction_words,
		jump_on_truthy and isa.op_jmpif or isa.op_jmpifnot,
		condition_register,
		0
	)
	state.free_register = temporary_base
end

local emit_if_statement<const> = function(state, instruction_words, statement)
	local end_jumps<const> = {}
	local clauses<const> = statement.clauses
	for index = 1, #clauses do
		local clause<const> = clauses[index]
		if clause.condition ~= nil then
			local next_clause_jumps<const> = {}
			emit_condition_jumps(
				state,
				instruction_words,
				clause.condition,
				false,
				next_clause_jumps
			)
			emit_block(state, instruction_words, clause.block)
			if index < #clauses then
				end_jumps[#end_jumps + 1] = bytecode.emit_signed_abx(
					instruction_words,
					isa.op_jmp,
					0,
					0
				)
			end
			patch_jumps(instruction_words, next_clause_jumps)
		else
			emit_block(state, instruction_words, clause.block)
		end
	end
	patch_jumps(instruction_words, end_jumps)
end

local emit_while_statement<const> = function(state, instruction_words, statement)
	local loop_start<const> = #instruction_words + 1
	local exit_jumps<const> = {}
	emit_condition_jumps(
		state,
		instruction_words,
		statement.condition,
		false,
		exit_jumps
	)
	local break_jumps<const> = {}
	local loop_stack<const> = state.loop_stack
	loop_stack[#loop_stack + 1] = break_jumps
	emit_block(state, instruction_words, statement.block)
	loop_stack[#loop_stack] = nil
	local back_jump<const> = bytecode.emit_signed_abx(
		instruction_words,
		isa.op_jmp,
		0,
		0
	)
	bytecode.patch_branch(
		instruction_words,
		back_jump,
		loop_start - back_jump - 1
	)
	patch_jumps(instruction_words, exit_jumps)
	patch_jumps(instruction_words, break_jumps)
end

local emit_numeric_for_statement<const> = function(
	state,
	instruction_words,
	statement
)
	local index_register<const> = identifier_register(state, statement.variable)
	local limit_register<const> = state.local_register_base
		+ statement.limit_local_slot
	local step_register<const> = state.local_register_base
		+ statement.step_local_slot
	local start_register<const> = emit_value(
		state,
		instruction_words,
		statement.start_expression,
		index_register,
		true
	)
	if start_register ~= index_register then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			index_register,
			start_register,
			0
		)
	end
	local limit_value_register<const> = emit_value(
		state,
		instruction_words,
		statement.limit_expression,
		limit_register,
		true
	)
	if limit_value_register ~= limit_register then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			limit_register,
			limit_value_register,
			0
		)
	end
	local step_expression<const> = statement.step_expression
	if step_expression == nil then
		bytecode.emit_abc(
			instruction_words,
			isa.op_k1,
			step_register,
			0,
			0
		)
	else
		local step_value_register<const> = emit_value(
			state,
			instruction_words,
			step_expression,
			step_register,
			true
		)
		if step_value_register ~= step_register then
			bytecode.emit_abc(
				instruction_words,
				isa.op_mov,
				step_register,
				step_value_register,
				0
			)
		end
	end

	local positive_step
	if step_expression == nil then
		positive_step = true
	elseif is_number_literal(step_expression) then
		positive_step = step_expression.constant_value > 0
	end
	local loop_start<const> = #instruction_words + 1
	local exit_jumps<const> = {}
	if positive_step ~= nil then
		local exit_left_register = index_register
		local exit_right_register = limit_register
		if positive_step then
			exit_left_register = limit_register
			exit_right_register = index_register
		end
		bytecode.emit_abc(
			instruction_words,
			isa.op_lt,
			1,
			exit_left_register,
			exit_right_register
		)
		exit_jumps[1] = bytecode.emit_signed_abx(
			instruction_words,
			isa.op_jmp,
			0,
			0
		)
	else
		local zero_register<const> = constant_register(
			state,
			statement.zero_constant_index
		)
		bytecode.emit_abc(
			instruction_words,
			isa.op_lt,
			0,
			zero_register,
			step_register
		)
		local negative_check_jump<const> = bytecode.emit_signed_abx(
			instruction_words,
			isa.op_jmp,
			0,
			0
		)
		bytecode.emit_abc(
			instruction_words,
			isa.op_lt,
			1,
			limit_register,
			index_register
		)
		exit_jumps[1] = bytecode.emit_signed_abx(
			instruction_words,
			isa.op_jmp,
			0,
			0
		)
		local body_jump<const> = bytecode.emit_signed_abx(
			instruction_words,
			isa.op_jmp,
			0,
			0
		)
		bytecode.patch_branch(
			instruction_words,
			negative_check_jump,
			#instruction_words - negative_check_jump
		)
		bytecode.emit_abc(
			instruction_words,
			isa.op_lt,
			1,
			index_register,
			limit_register
		)
		exit_jumps[2] = bytecode.emit_signed_abx(
			instruction_words,
			isa.op_jmp,
			0,
			0
		)
		bytecode.patch_branch(
			instruction_words,
			body_jump,
			#instruction_words - body_jump
		)
	end

	local break_jumps<const> = {}
	local loop_stack<const> = state.loop_stack
	loop_stack[#loop_stack + 1] = break_jumps
	emit_block(state, instruction_words, statement.block)
	loop_stack[#loop_stack] = nil
	bytecode.emit_abc(
		instruction_words,
		isa.op_add,
		index_register,
		index_register,
		step_register
	)
	local back_jump<const> = bytecode.emit_signed_abx(
		instruction_words,
		isa.op_jmp,
		0,
		0
	)
	bytecode.patch_branch(
		instruction_words,
		back_jump,
		loop_start - back_jump - 1
	)
	patch_jumps(instruction_words, exit_jumps)
	patch_jumps(instruction_words, break_jumps)
end

local emit_break_statement<const> = function(state, instruction_words)
	local loop_stack<const> = state.loop_stack
	local break_jumps<const> = loop_stack[#loop_stack]
	break_jumps[#break_jumps + 1] = bytecode.emit_signed_abx(
		instruction_words,
		isa.op_jmp,
		0,
		0
	)
end

emit_statement = function(state, instruction_words, statement)
	local kind<const> = statement.kind
	if kind == syntax.assignment_statement then
		emit_assignment(state, instruction_words, statement)
	elseif kind == syntax.call_statement then
		local target<const> = reserve_register(state)
		emit_call_expression(
			state,
			instruction_words,
			statement.expression,
			target,
			true
		)
	elseif kind == syntax.local_statement then
		emit_local_statement(state, instruction_words, statement)
	elseif kind == syntax.if_statement then
		emit_if_statement(state, instruction_words, statement)
	elseif kind == syntax.while_statement then
		emit_while_statement(state, instruction_words, statement)
	elseif kind == syntax.numeric_for_statement then
		emit_numeric_for_statement(state, instruction_words, statement)
	elseif kind == syntax.break_statement then
		emit_break_statement(state, instruction_words)
	else
		emit_return_statement(state, instruction_words, statement)
	end
end

emit_block = function(state, instruction_words, block)
	local statements<const> = block.statements
	for index = 1, #statements do
		emit_statement(state, instruction_words, statements[index])
		state.free_register = state.temporary_register_base
	end
end

local compile_function<const> = function(state)
	local parameter_count<const> = state.parameter_count
	local instruction_words<const> = {}
	local semantic_state<const> = state.function_expression.semantic_state
	local upvalues<const> = semantic_state.upvalues
	local fixed_register_count = parameter_count
	for index = 1, #upvalues do
		local upvalue<const> = upvalues[index]
		if upvalue.binding.is_const
		and (upvalue.direct_use_count > 1 or upvalue.used_in_loop) then
			state.immutable_upvalue_register_by_index[
				upvalue.upvalue_index
			] = fixed_register_count
			fixed_register_count = fixed_register_count + 1
		end
	end
	state.local_register_base = fixed_register_count
	fixed_register_count = fixed_register_count + state.local_count
	local constant_indices<const> = state.constant_indices
	for index = 1, #constant_indices do
		local const_index<const> = constant_indices[index]
		state.constant_register_by_index[const_index] = fixed_register_count
		fixed_register_count = fixed_register_count + 1
	end
	if state.is_root or #semantic_state.children > 0 then
		state.owner_register = fixed_register_count
		fixed_register_count = fixed_register_count + 1
	end
	local first_temporary_register<const> = fixed_register_count
	state.temporary_register_base = first_temporary_register
	state.free_register = first_temporary_register
	state.max_stack = first_temporary_register
	state.loop_stack = {}
	for index = 1, #upvalues do
		local upvalue<const> = upvalues[index]
		if upvalue.binding.is_const
		and (upvalue.direct_use_count > 1 or upvalue.used_in_loop) then
			local register<const> = state.immutable_upvalue_register_by_index[
				upvalue.upvalue_index
			]
			bytecode.emit_abc(
				instruction_words,
				op_getup,
				register,
				upvalue.upvalue_index,
				0
			)
		end
	end
	if state.is_root then
		bytecode.emit_abc(
			instruction_words,
			op_getup,
			state.owner_register,
			state.owner_upvalue_index,
			0
		)
		for index = 1, #constant_indices do
			local const_index<const> = constant_indices[index]
			bytecode.emit_abc(
				instruction_words,
				isa.op_geti,
				state.constant_register_by_index[const_index],
				state.owner_register,
				const_index
			)
		end
	else
		for index = 1, #constant_indices do
			local const_index<const> = constant_indices[index]
			bytecode.emit_abc(
				instruction_words,
				op_getup,
				state.constant_register_by_index[const_index],
				state.constant_upvalue_by_index[const_index],
				0
			)
		end
		if state.owner_register ~= nil then
			bytecode.emit_abc(
				instruction_words,
				op_getup,
				state.owner_register,
				state.owner_upvalue_index,
				0
			)
		end
	end
	local statements<const> = state.function_expression.body.statements
	emit_block(state, instruction_words, state.function_expression.body)
	if #statements == 0
		or statements[#statements].kind ~= syntax.return_statement then
		local return_register<const> = reserve_register(state)
		bytecode.emit_abc(instruction_words, isa.op_knil, return_register, 0, 0)
		bytecode.emit_abc(instruction_words, isa.op_ret, return_register, 1, 0)
	end

	return {
		instruction_words = instruction_words,
		parameter_count = parameter_count,
		max_stack = state.max_stack,
		upvalue_records = state.upvalue_records,
	}
end

local collect_functions
collect_functions = function(function_expression, out)
	out[#out + 1] = function_expression
	local children<const> = function_expression.semantic_state.children
	for index = 1, #children do
		collect_functions(children[index], out)
	end
end

local binding_register<const> = function(state, binding)
	if binding.kind == 'parameter' then
		return binding.register
	end
	return state.local_register_base + binding.slot
end

local sort_numbers<const> = function(values)
	for index = 2, #values do
		local value<const> = values[index]
		local insertion_index = index
		while insertion_index > 1 and values[insertion_index - 1] > value do
			values[insertion_index] = values[insertion_index - 1]
			insertion_index = insertion_index - 1
		end
		values[insertion_index] = value
	end
end

local collect_required_constants<const> = function(state)
	local indices<const> = {}
	local required<const> = state.required_constant_by_index
	for const_index in pairs(required) do
		indices[#indices + 1] = const_index
	end
	sort_numbers(indices)
	state.constant_indices = indices
end

local fixed_register_count<const> = function(state)
	local count = state.parameter_count + state.local_count
	local upvalues<const> = state.function_expression.semantic_state.upvalues
	for index = 1, #upvalues do
		local upvalue<const> = upvalues[index]
		if upvalue.binding.is_const
		and (upvalue.direct_use_count > 1 or upvalue.used_in_loop) then
			count = count + 1
		end
	end
	for _ in pairs(state.required_constant_by_index) do
		count = count + 1
	end
	if state.parent == nil
		or #state.function_expression.semantic_state.children > 0 then
		count = count + 1
	end
	return count
end

local prepare_required_constants<const> = function(states)
	for index = 1, #states do
		local state<const> = states[index]
		local required<const> = {}
		for const_index in pairs(state.direct_constant_by_index) do
			required[const_index] = true
		end
		state.required_constant_by_index = required
	end
	for index = #states, 1, -1 do
		local state<const> = states[index]
		if fixed_register_count(state) > isa.max_wide_operand then
			materialize_block_immediates(
				state,
				state.function_expression.body
			)
			for const_index in pairs(state.direct_constant_by_index) do
				state.required_constant_by_index[const_index] = true
			end
		end
		collect_required_constants(state)
		local parent<const> = state.parent
		if parent ~= nil then
			local parent_required<const> = parent.required_constant_by_index
			for const_index in pairs(state.required_constant_by_index) do
				parent_required[const_index] = true
			end
		end
	end
end

local build_upvalue_records<const> = function(state)
	local records<const> = {}
	local semantic_state<const> = state.function_expression.semantic_state
	local parent<const> = state.parent
	local upvalues<const> = semantic_state.upvalues
	for index = 1, #upvalues do
		local upvalue<const> = upvalues[index]
		if upvalue.in_stack then
			records[index] = {
				in_stack = true,
				index = binding_register(parent, upvalue.index),
			}
		else
			records[index] = {
				in_stack = false,
				index = upvalue.index,
			}
		end
	end
	local constant_indices<const> = state.constant_indices
	for index = 1, #constant_indices do
		local const_index<const> = constant_indices[index]
		local record_index<const> = #records
		state.constant_upvalue_by_index[const_index] = record_index
		records[record_index + 1] = {
			in_stack = true,
			index = parent.constant_register_by_index[const_index],
		}
	end
	state.owner_upvalue_index = #records
	records[state.owner_upvalue_index + 1] = {
		in_stack = true,
		index = parent.owner_register,
	}
	state.upvalue_records = records
end

function compiler.compile(chunk, chunk_name, root_const_pool_register, environment)
	local root_function<const> = semantic.bind(
		chunk,
		chunk_name,
		environment ~= nil
	)
	local function_expressions<const> = {}
	collect_functions(root_function, function_expressions)
	local program<const> = {
		const_pool = {},
		constant_index_by_value = {},
		environment = environment,
	}
	local states<const> = {}
	local state_by_semantic<const> = {}
	for index = 1, #function_expressions do
		local function_expression<const> = function_expressions[index]
		local state<const> = prepare_codegen(program, function_expression)
		states[index] = state
		state_by_semantic[function_expression.semantic_state] = state
	end
	local const_pool<const> = program.const_pool
	local const_relocations<const> = {}
	for index = 2, #states do
		local state<const> = states[index]
		local function_expression<const> = state.function_expression
		local const_index<const> = #const_pool + 1
		const_pool[const_index] = false
		function_expression.function_address_constant_index = const_index
		const_relocations[#const_relocations + 1] = {
			const_index = const_index,
			proto_index = index,
		}
	end
	for index = 2, #states do
		local state<const> = states[index]
		local parent<const> = state_by_semantic[state.function_expression.semantic_state.parent]
		state.parent = parent
		parent.direct_constant_by_index[
			state.function_expression.function_address_constant_index
		] = true
	end
	prepare_required_constants(states)
	local max_stack<const> = isa.max_ext_register_a + 1
	local root_state<const> = states[1]
	root_state.is_root = true
	root_state.owner_upvalue_index = 0
	root_state.upvalue_records = {
		{
			in_stack = true,
			index = root_const_pool_register,
		},
	}
	local protos<const> = {}
	for index = 1, #states do
		local state<const> = states[index]
		if index > 1 then
			build_upvalue_records(state)
		end
		local proto<const> = compile_function(state)
		if proto.max_stack > max_stack then
			error('[load:' .. chunk_name .. '] function or expression needs too many registers')
		end
		protos[index] = proto
	end
	program.protos = protos
	program.root_proto_index = 1
	program.const_relocations = const_relocations
	return program
end

return compiler
