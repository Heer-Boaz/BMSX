local syntax<const> = require('compiler/syntax')

local semantic<const> = {}

local fail<const> = function(chunk_name, message, node)
	error('[load:' .. chunk_name .. '] ' .. message .. ' at '
		.. tostring(node.line) .. ':' .. tostring(node.column))
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
	fail(state.chunk_name, 'unsupported literal expression', expression)
end

local bind_value
local bind_path
local bind_statement
local bind_block
local bind_function

local begin_scope<const> = function(state)
	local scope<const> = {
		previous = state.scope,
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
	state.scope = scope.previous
end

local reserve_local_slot<const> = function(state)
	local slot<const> = state.local_count
	state.local_count = slot + 1
	return slot
end

local bind_local_identifier<const> = function(state, identifier, is_const)
	local name<const> = identifier.name
	local binding<const> = {
		name = name,
		function_state = state,
		kind = 'local',
		slot = reserve_local_slot(state),
		is_const = is_const,
		previous = state.local_binding_by_name[name],
	}
	state.local_binding_by_name[name] = binding
	local bindings<const> = state.scope.bindings
	bindings[#bindings + 1] = binding
	identifier.binding = binding
end

local bind_parameters<const> = function(state)
	local parameters<const> = state.function_expression.parameters
	for index = 1, #parameters do
		local parameter<const> = parameters[index]
		local name<const> = parameter.name
		if state.parameter_binding_by_name[name] ~= nil then
			fail(state.chunk_name, "duplicate function parameter '" .. name .. "'", parameter)
		end
		local binding<const> = {
			name = name,
			function_state = state,
			kind = 'parameter',
			register = index - 1,
			is_const = false,
		}
		state.parameter_binding_by_name[name] = binding
		parameter.binding = binding
	end
end

local add_upvalue<const> = function(state, binding, in_stack, index)
	local upvalue = state.upvalue_by_binding[binding]
	if upvalue ~= nil then
		return upvalue
	end
	local upvalues<const> = state.upvalues
	upvalue = {
		binding = binding,
		in_stack = in_stack,
		index = index,
		upvalue_index = #upvalues,
		direct_use_count = 0,
		used_in_loop = false,
	}
	upvalues[#upvalues + 1] = upvalue
	state.upvalue_by_binding[binding] = upvalue
	return upvalue
end

local resolve_upvalue
resolve_upvalue = function(state, name)
	local parent<const> = state.parent
	if parent == nil then
		return nil
	end
	local binding<const> = parent.local_binding_by_name[name]
		or parent.parameter_binding_by_name[name]
	if binding ~= nil then
		return add_upvalue(state, binding, true, binding)
	end
	local parent_upvalue<const> = resolve_upvalue(parent, name)
	if parent_upvalue == nil then
		return nil
	end
	return add_upvalue(
		state,
		parent_upvalue.binding,
		false,
		parent_upvalue.upvalue_index
	)
end

local bind_identifier<const> = function(state, expression)
	local name<const> = expression.name
	local binding<const> = state.local_binding_by_name[name]
		or state.parameter_binding_by_name[name]
	if binding ~= nil then
		expression.binding = binding
		return
	end
	local upvalue<const> = resolve_upvalue(state, name)
	if upvalue ~= nil then
		upvalue.direct_use_count = upvalue.direct_use_count + 1
		if state.loop_depth > 0 then
			upvalue.used_in_loop = true
		end
		expression.upvalue = upvalue
		return
	end
	if state.has_environment then
		expression.environment_key = name
		return
	end
	fail(
		state.chunk_name,
		"unknown local or function parameter '" .. name .. "'",
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
	fail(state.chunk_name, 'paths must start at a visible binding', expression)
end

bind_value = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		bind_path(state, expression)
		return
	end
	if kind == syntax.function_expression then
		local children<const> = state.children
		children[#children + 1] = expression
		bind_function(state, expression)
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
	expression.constant_value = literal_value(state, expression)
end

local bind_assignment<const> = function(state, statement)
	local target<const> = statement.target
	bind_path(state, target)
	if target.kind == syntax.identifier_expression then
		local binding = target.binding
		if binding == nil and target.upvalue ~= nil then
			binding = target.upvalue.binding
		end
		if binding ~= nil and binding.is_const then
			fail(state.chunk_name, "cannot assign to const local '" .. target.name .. "'", target)
		end
	end
	bind_value(state, statement.value)
end

local bind_local_statement<const> = function(state, statement)
	local initializer<const> = statement.initializer
	if statement.is_const and initializer == nil then
		fail(
			state.chunk_name,
			"const local '" .. statement.name.name .. "' needs an initializer",
			statement.name
		)
	end
	if initializer ~= nil then
		bind_value(state, initializer)
	end
	bind_local_identifier(state, statement.name, statement.is_const)
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
	state.loop_depth = state.loop_depth + 1
	bind_value(state, statement.condition)
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
	bind_local_identifier(state, statement.variable, false)
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

bind_function = function(parent, function_expression)
	local state<const> = {
		chunk_name = parent.chunk_name,
		function_expression = function_expression,
		parent = parent,
		children = {},
		parameter_binding_by_name = {},
		local_binding_by_name = {},
		local_count = 0,
		scope = nil,
		has_environment = parent.has_environment,
		loop_depth = 0,
		upvalues = {},
		upvalue_by_binding = {},
	}
	function_expression.semantic_state = state
	bind_parameters(state)
	bind_block(state, function_expression.body)
	function_expression.local_count = state.local_count
end

function semantic.bind(chunk, chunk_name, has_environment)
	local root_function<const> = {
		kind = syntax.function_expression,
		parameters = {},
		body = chunk.body,
		line = chunk.line,
		column = chunk.column,
	}
	local root_state<const> = {
		chunk_name = chunk_name,
		function_expression = root_function,
		parent = nil,
		children = {},
		parameter_binding_by_name = {},
		local_binding_by_name = {},
		local_count = 0,
		scope = nil,
		has_environment = has_environment,
		loop_depth = 0,
		upvalues = {},
		upvalue_by_binding = {},
	}
	root_function.semantic_state = root_state
	bind_block(root_state, root_function.body)
	root_function.local_count = root_state.local_count
	return root_function
end

return semantic
