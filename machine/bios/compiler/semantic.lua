local syntax<const> = require('compiler/syntax')

local semantic<const> = {}

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

local bind_parameters<const> = function(state, function_expression)
	local parameters<const> = function_expression.parameters
	for index = 1, #parameters do
		local parameter<const> = parameters[index]
		if state.parameter_register_by_name[parameter.name] ~= nil then
			fail(
				state.chunk_name,
				"duplicate function parameter '" .. parameter.name .. "'",
				parameter
			)
		end
		state.parameter_register_by_name[parameter.name] = index - 1
	end
end

local literal_value<const> = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.number_literal_expression
		or kind == syntax.string_literal_expression then
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
		'unsupported literal expression',
		expression
	)
end

local bind_value
local bind_path
local bind_statement
local bind_block
local value_reads_identifier

local begin_scope<const> = function(state)
	local scope<const> = {
		previous = state.scope,
		local_base = state.active_local_count,
		bindings = {},
	}
	state.scope = scope
	return scope
end

local end_scope<const> = function(state, scope)
	local bindings<const> = scope.bindings
	for index = #bindings, 1, -1 do
		local binding<const> = bindings[index]
		state.local_binding_by_name[binding.name] = binding.previous
	end
	state.active_local_count = scope.local_base
	state.scope = scope.previous
end

local reserve_local_slot<const> = function(state)
	local slot<const> = state.active_local_count
	local active_local_count<const> = slot + 1
	state.active_local_count = active_local_count
	if active_local_count > state.max_local_count then
		state.max_local_count = active_local_count
	end
	return slot
end

local bind_local_identifier<const> = function(state, identifier)
	local slot<const> = reserve_local_slot(state)
	identifier.local_slot = slot
	local name<const> = identifier.name
	local binding<const> = {
		name = name,
		slot = slot,
		previous = state.local_binding_by_name[name],
	}
	state.local_binding_by_name[name] = binding
	local bindings<const> = state.scope.bindings
	bindings[#bindings + 1] = binding
end

local bind_identifier<const> = function(state, expression)
	local local_binding<const> = state.local_binding_by_name[expression.name]
	if local_binding ~= nil then
		expression.local_slot = local_binding.slot
		return
	end
	local register<const> = state.parameter_register_by_name[expression.name]
	if register ~= nil then
		expression.parameter_register = register
		return
	end
	if state.has_environment then
		expression.environment_key = expression.name
		return
	end
	fail(
		state.chunk_name,
		"unknown local or function parameter '" .. expression.name .. "'",
		expression
	)
end

bind_path = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression then
		bind_identifier(state, expression)
		return
	end
	if kind == syntax.member_expression then
		bind_path(state, expression.base)
		expression.key_value = expression.identifier
		return
	end
	if kind == syntax.index_expression then
		bind_path(state, expression.base)
		local index<const> = expression.index
		bind_value(state, index)
		if index.constant_value ~= nil then
			expression.key_value = index.constant_value
		end
		return
	end
	fail(state.chunk_name, 'paths must start at a function parameter', expression)
end

bind_value = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		bind_path(state, expression)
		return
	end
	if kind == syntax.nil_literal_expression
		or kind == syntax.boolean_literal_expression then
		return
	end
	if kind == syntax.binary_expression then
		bind_value(state, expression.left)
		bind_value(state, expression.right)
		return
	end
	if kind == syntax.call_expression then
		bind_value(state, expression.callee)
		local arguments<const> = expression.arguments
		for index = 1, #arguments do
			bind_value(state, arguments[index])
		end
		return
	end
	if kind == syntax.unary_expression then
		local operator<const> = expression.operator
		local operand_kind<const> = expression.operand.kind
		if (operator == syntax.unary_negate
				and operand_kind == syntax.number_literal_expression)
			or (operator == syntax.unary_string_id
				and operand_kind == syntax.string_literal_expression) then
			expression.constant_value = literal_value(state, expression)
		else
			bind_value(state, expression.operand)
		end
		return
	end
	expression.constant_value = literal_value(
		state,
		expression
	)
end

value_reads_identifier = function(expression, identifier)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression then
		if identifier.parameter_register ~= nil then
			return expression.parameter_register == identifier.parameter_register
		end
		return expression.local_slot == identifier.local_slot
	end
	if kind == syntax.member_expression then
		return value_reads_identifier(expression.base, identifier)
	end
	if kind == syntax.index_expression then
		return value_reads_identifier(expression.base, identifier)
			or value_reads_identifier(expression.index, identifier)
	end
	if kind == syntax.binary_expression then
		return value_reads_identifier(expression.left, identifier)
			or value_reads_identifier(expression.right, identifier)
	end
	if kind == syntax.call_expression then
		if value_reads_identifier(expression.callee, identifier) then
			return true
		end
		local arguments<const> = expression.arguments
		for index = 1, #arguments do
			if value_reads_identifier(arguments[index], identifier) then
				return true
			end
		end
		return false
	end
	if kind == syntax.unary_expression then
		return value_reads_identifier(expression.operand, identifier)
	end
	return false
end

local bind_assignment<const> = function(state, statement)
	local target<const> = statement.target
	bind_path(state, target)
	bind_value(state, statement.value)
	if target.kind == syntax.identifier_expression
		and target.environment_key == nil then
		statement.value_reads_target = value_reads_identifier(
			statement.value,
			target
		)
	end
end

local bind_local_statement<const> = function(state, statement)
	local initializer<const> = statement.initializer
	if initializer ~= nil then
		bind_value(state, initializer)
	end
	bind_local_identifier(state, statement.name)
end

local bind_return_statement<const> = function(state, statement)
	local expressions<const> = statement.expressions
	for index = 1, #expressions do
		bind_value(state, expressions[index])
	end
end

local bind_if_statement<const> = function(state, statement)
	local clauses<const> = statement.clauses
	for index = 1, #clauses do
		local clause<const> = clauses[index]
		if clause.condition ~= nil then
			bind_value(state, clause.condition)
		end
		bind_block(state, clause.block)
	end
end

local bind_while_statement<const> = function(state, statement)
	bind_value(state, statement.condition)
	state.loop_depth = state.loop_depth + 1
	bind_block(state, statement.block)
	state.loop_depth = state.loop_depth - 1
end

local bind_numeric_for_statement<const> = function(state, statement)
	bind_value(state, statement.start_expression)
	bind_value(state, statement.limit_expression)
	local step_expression<const> = statement.step_expression
	if step_expression ~= nil then
		bind_value(state, step_expression)
	end
	local scope<const> = begin_scope(state)
	bind_local_identifier(state, statement.variable)
	statement.limit_local_slot = reserve_local_slot(state)
	statement.step_local_slot = reserve_local_slot(state)
	state.loop_depth = state.loop_depth + 1
	bind_block(state, statement.block)
	state.loop_depth = state.loop_depth - 1
	end_scope(state, scope)
end

bind_statement = function(state, statement)
	local kind<const> = statement.kind
	if kind == syntax.assignment_statement then
		bind_assignment(state, statement)
	elseif kind == syntax.call_statement then
		bind_value(state, statement.expression)
	elseif kind == syntax.local_statement then
		bind_local_statement(state, statement)
	elseif kind == syntax.return_statement then
		bind_return_statement(state, statement)
	elseif kind == syntax.if_statement then
		bind_if_statement(state, statement)
	elseif kind == syntax.while_statement then
		bind_while_statement(state, statement)
	elseif kind == syntax.numeric_for_statement then
		bind_numeric_for_statement(state, statement)
	elseif kind == syntax.break_statement then
		if state.loop_depth == 0 then
			fail(state.chunk_name, 'break outside loop', statement)
		end
	else
		fail(state.chunk_name, 'unsupported function statement', statement)
	end
end

bind_block = function(state, block)
	local scope<const> = begin_scope(state)
	local statements<const> = block.statements
	for index = 1, #statements do
		local statement<const> = statements[index]
		if statement.kind == syntax.return_statement and index ~= #statements then
			fail(state.chunk_name, 'return must be the final block statement', statement)
		end
		bind_statement(state, statement)
	end
	end_scope(state, scope)
end

function semantic.bind(chunk, chunk_name, has_environment)
	local function_expression<const> = returned_function(chunk, chunk_name)
	local state<const> = {
		chunk_name = chunk_name,
		parameter_register_by_name = {},
		local_binding_by_name = {},
		active_local_count = 0,
		max_local_count = 0,
		scope = nil,
		has_environment = has_environment,
		loop_depth = 0,
	}
	bind_parameters(state, function_expression)
	bind_block(state, function_expression.body)
	function_expression.local_count = state.max_local_count
	return function_expression
end

return semantic
