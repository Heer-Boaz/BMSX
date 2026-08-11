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

local add_constant<const> = function(state, value)
	local index = state.constant_index_by_value[value]
	if index == nil then
		index = #state.const_pool + 1
		state.const_pool[index] = value
		state.constant_index_by_value[value] = index
	end
	return index
end

local prepare_path_operands
local prepare_value_operands
prepare_path_operands = function(state, expression)
	if expression.kind == syntax.identifier_expression then
		if expression.environment_key ~= nil then
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
	if kind == syntax.binary_expression then
		prepare_value_operands(state, expression.left)
		prepare_value_operands(state, expression.right)
		return
	end
	if kind == syntax.call_expression then
		prepare_value_operands(state, expression.callee)
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
	if kind == syntax.break_statement then
		return
	end
	local expressions<const> = statement.expressions
	for index = 1, #expressions do
		materialize_wide_immediates(state, expressions[index])
	end
end

local prepare_codegen<const> = function(function_expression, environment)
	local state<const> = {
		function_expression = function_expression,
		parameter_count = #function_expression.parameters,
		local_count = function_expression.local_count,
		const_pool = { 0 },
		constant_index_by_value = {},
	}
	if environment ~= nil then
		state.environment_constant_index = add_constant(state, environment)
	end
	prepare_block_operands(state, state.function_expression.body)
	local first_temporary_register<const> = state.parameter_count
		+ #state.const_pool
		- function_address_pool_index
		+ state.local_count
	if first_temporary_register > isa.max_wide_operand then
		materialize_block_immediates(state, state.function_expression.body)
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

local identifier_register<const> = function(state, expression)
	if expression.parameter_register ~= nil then
		return expression.parameter_register
	end
	return state.local_register_base + expression.local_slot
end

local environment_register<const> = function(state)
	return constant_register(
		state.parameter_count,
		state.environment_constant_index
	)
end

local emit_value
local emit_path
emit_path = function(state, instruction_words, expression, target)
	if expression.kind == syntax.identifier_expression then
		if expression.environment_key ~= nil then
			bytecode.emit_abc(
				instruction_words,
				isa.op_gett,
				target,
				environment_register(state),
				constant_register(
					state.parameter_count,
					expression.constant_index
				)
			)
			return target
		end
		return identifier_register(state, expression)
	end
	local base_register<const> = emit_path(
		state,
		instruction_words,
		expression.base,
		target
	)
	if expression.kind == syntax.index_expression
		and expression.key_value == nil then
		local index_target = target
		if base_register == target then
			index_target = reserve_register(state)
		end
		local index_register<const> = emit_value(
			state,
			instruction_words,
			expression.index,
			index_target
		)
		bytecode.emit_abc(
			instruction_words,
			isa.op_gett,
			target,
			base_register,
			index_register
		)
		if index_target ~= target then
			state.free_register = index_target
		end
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

local emit_logical_expression<const> = function(
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
	if left_register ~= target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			left_register,
			0
		)
	end
	local operator<const> = expression.operator
	local jump_opcode<const> = operator == syntax.binary_and
		and isa.op_jmpifnot
		or isa.op_jmpif
	local jump_index<const> = bytecode.emit_signed_abx(
		instruction_words,
		jump_opcode,
		target,
		0
	)
	local right_register<const> = emit_value(
		state,
		instruction_words,
		expression.right,
		target
	)
	if right_register ~= target then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			right_register,
			0
		)
	end
	bytecode.patch_branch(
		instruction_words,
		jump_index,
		#instruction_words - jump_index
	)
	return target
end

local emit_call_expression<const> = function(
	state,
	instruction_words,
	expression,
	target
)
	local temporary_base<const> = state.free_register
	local use_target<const> = target >= state.temporary_register_base
		and target + 1 == temporary_base
	local call_base = target
	if not use_target then
		call_base = reserve_register(state)
	end
	local callee_register<const> = emit_value(
		state,
		instruction_words,
		expression.callee,
		call_base
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
	local arguments<const> = expression.arguments
	for index = 1, #arguments do
		local argument_target<const> = reserve_register(state)
		local argument_register<const> = emit_value(
			state,
			instruction_words,
			arguments[index],
			argument_target
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
		#arguments + isa.fixed_call_arg_count_bias,
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
	expression,
	target,
	target_will_be_overwritten
)
	local left_register = emit_value(
		state,
		instruction_words,
		expression.left,
		target
	)
	local right_target = target
	if left_register == target then
		right_target = reserve_register(state)
	end
	local right_register = emit_value(
		state,
		instruction_words,
		expression.right,
		right_target
	)
	if target_will_be_overwritten and left_register == target then
		local copy_register<const> = reserve_register(state)
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			copy_register,
			left_register,
			0
		)
		left_register = copy_register
	end
	if target_will_be_overwritten and right_register == target then
		local copy_register<const> = reserve_register(state)
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			copy_register,
			right_register,
			0
		)
		right_register = copy_register
	end
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
	target
)
	local temporary_base<const> = state.free_register
	local left_register<const>, right_register<const>
		= prepare_comparison_operands(
			state,
			instruction_words,
			expression,
			target,
			true
		)
	local operator<const> = expression.operator
	bytecode.emit_abc(instruction_words, isa.op_kfalse, target, 0, 0)
	bytecode.emit_abc(
		instruction_words,
		opcode_by_comparison_operator[operator],
		operator == syntax.binary_not_equal and 0 or 1,
		left_register,
		right_register
	)
	bytecode.emit_abc(instruction_words, isa.op_ktrue, target, 0, 0)
	state.free_register = temporary_base
	return target
end

local emit_binary_expression<const> = function(
	state,
	instruction_words,
	expression,
	target
)
	local operator<const> = expression.operator
	if operator == syntax.binary_and or operator == syntax.binary_or then
		return emit_logical_expression(
			state,
			instruction_words,
			expression,
			target
		)
	end
	local opcode<const> = opcode_by_binary_operator[operator]
	if opcode == nil then
		return emit_comparison_expression(
			state,
			instruction_words,
			expression,
			target
		)
	end
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
		opcode,
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
	if kind == syntax.call_expression then
		return emit_call_expression(
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
		state.parameter_count,
		expression.constant_index
	)
end

local emit_assignment<const> = function(
	state,
	instruction_words,
	statement
)
	local target<const> = statement.target
	if target.kind == syntax.identifier_expression then
		if target.environment_key ~= nil then
			local temporary_base<const> = reserve_register(state)
			local value_register<const> = emit_value(
				state,
				instruction_words,
				statement.value,
				temporary_base
			)
			bytecode.emit_abc(
				instruction_words,
				isa.op_sett,
				environment_register(state),
				constant_register(
					state.parameter_count,
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
			target_register
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
		temporary_base
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
			index_target
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
		value_target_register
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
				state.parameter_count,
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
		target_register
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
	if #expressions == 0 then
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
	local return_register<const> = emit_value(
		state,
		instruction_words,
		expressions[1],
		return_target
	)
	bytecode.emit_abc(instruction_words, isa.op_ret, return_register, 1, 0)
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
			local target<const> = reserve_register(state)
			local left_register<const>, right_register<const>
				= prepare_comparison_operands(
					state,
					instruction_words,
					expression,
					target,
					false
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
		condition_register
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
	elseif kind == syntax.local_statement then
		emit_local_statement(state, instruction_words, statement)
	elseif kind == syntax.if_statement then
		emit_if_statement(state, instruction_words, statement)
	elseif kind == syntax.while_statement then
		emit_while_statement(state, instruction_words, statement)
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
	state.local_register_base = parameter_count + constant_count
	local first_temporary_register<const> = state.local_register_base
		+ state.local_count
	state.temporary_register_base = first_temporary_register
	state.free_register = first_temporary_register
	state.max_stack = first_temporary_register
	state.loop_stack = {}
	local statements<const> = state.function_expression.body.statements
	emit_block(state, instruction_words, state.function_expression.body)
	if #statements == 0
		or statements[#statements].kind ~= syntax.return_statement then
		local return_register<const> = reserve_register(state)
		bytecode.emit_abc(instruction_words, isa.op_knil, return_register, 0, 0)
		bytecode.emit_abc(instruction_words, isa.op_ret, return_register, 1, 0)
	end

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

function compiler.compile(chunk, chunk_name, root_const_pool_register, environment)
	local function_expression<const> = semantic.bind(
		chunk,
		chunk_name,
		environment ~= nil
	)
	local state<const> = prepare_codegen(function_expression, environment)
	local const_pool<const> = state.const_pool
	local constant_count<const> = #const_pool - function_address_pool_index
	local max_stack<const> = isa.max_ext_register_a + 1
	if constant_count + 2 > max_stack
		or state.parameter_count + constant_count
			+ state.local_count + 1 > max_stack then
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
