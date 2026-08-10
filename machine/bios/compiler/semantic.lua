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
bind_path = function(state, expression)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression then
		local register<const> = state.parameter_register_by_name[expression.name]
		if register == nil then
			fail(
				state.chunk_name,
				"unknown function parameter '" .. expression.name .. "'",
				expression
			)
		end
		expression.parameter_register = register
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
	if kind == syntax.unary_expression
		and expression.operator == syntax.unary_negate
		and expression.operand.kind ~= syntax.number_literal_expression then
		bind_value(state, expression.operand)
		return
	end
	expression.constant_value = literal_value(
		state,
		expression
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

function semantic.bind(chunk, chunk_name)
	local function_expression<const> = returned_function(chunk, chunk_name)
	local state<const> = {
		chunk_name = chunk_name,
		parameter_register_by_name = {},
	}
	bind_parameters(state, function_expression)
	local statements<const> = function_expression.body.statements
	for index = 1, #statements do
		bind_assignment(state, statements[index])
	end
	return function_expression
end

return semantic
