local lua_syntax<const> = {}

local kind<const> = {
	chunk = 1,
	identifier_expression = 2,
	numeric_literal_expression = 3,
	string_literal_expression = 4,
	boolean_literal_expression = 5,
	nil_literal_expression = 6,
	member_expression = 7,
	index_expression = 8,
	call_expression = 9,
	binary_expression = 10,
	unary_expression = 11,
	function_expression = 12,
	assignment_statement = 13,
	local_declaration_statement = 14,
	call_statement = 15,
	if_statement = 16,
	while_statement = 17,
	for_numeric_statement = 18,
	return_statement = 19,
	break_statement = 20,
}

lua_syntax.kind = kind

lua_syntax.binary_operator = {
	logical_or = 1,
	logical_and = 2,
	equal = 3,
	not_equal = 4,
	less_than = 5,
	less_equal = 6,
	greater_than = 7,
	greater_equal = 8,
	bitwise_or = 9,
	bitwise_xor = 10,
	bitwise_and = 11,
	shift_left = 12,
	shift_right = 13,
	concat = 14,
	add = 15,
	subtract = 16,
	multiply = 17,
	divide = 18,
	floor_divide = 19,
	modulus = 20,
	exponent = 21,
}

lua_syntax.unary_operator = {
	negate = 1,
	logical_not = 2,
	length = 3,
	bitwise_not = 4,
}

function lua_syntax.chunk(body)
	return { kind.chunk, body }
end

function lua_syntax.identifier(name)
	return { kind.identifier_expression, name }
end

function lua_syntax.numeric_literal(value)
	return { kind.numeric_literal_expression, value }
end

function lua_syntax.string_literal(value)
	return { kind.string_literal_expression, value }
end

function lua_syntax.boolean_literal(value)
	return { kind.boolean_literal_expression, value }
end

lua_syntax.nil_literal = { kind.nil_literal_expression }

function lua_syntax.member_expression(base, identifier)
	return { kind.member_expression, base, identifier }
end

function lua_syntax.index_expression(base, index)
	return { kind.index_expression, base, index }
end

function lua_syntax.call_expression(callee, arguments)
	return { kind.call_expression, callee, arguments }
end

function lua_syntax.binary_expression(operator, left, right)
	return { kind.binary_expression, operator, left, right }
end

function lua_syntax.unary_expression(operator, operand)
	return { kind.unary_expression, operator, operand }
end

function lua_syntax.function_expression(parameters, body)
	return { kind.function_expression, parameters, body }
end

function lua_syntax.assignment_statement(left, right)
	return { kind.assignment_statement, left, right }
end

function lua_syntax.local_declaration_statement(names, values, is_const)
	return { kind.local_declaration_statement, names, values, is_const }
end

function lua_syntax.call_statement(expression)
	return { kind.call_statement, expression }
end

function lua_syntax.if_statement(clauses)
	return { kind.if_statement, clauses }
end

function lua_syntax.while_statement(condition, body)
	return { kind.while_statement, condition, body }
end

function lua_syntax.for_numeric_statement(variable, start, limit, step, body)
	return { kind.for_numeric_statement, variable, start, limit, step, body }
end

function lua_syntax.return_statement(expressions)
	return { kind.return_statement, expressions }
end

lua_syntax.break_statement = { kind.break_statement }

return lua_syntax
