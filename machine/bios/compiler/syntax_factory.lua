local syntax<const> = require('compiler/syntax')

-- Semantic binding and code generation annotate syntax nodes in place. Each
-- factory call therefore creates one owned syntax occurrence; generated
-- programs must not retain or share nodes between trees.
local syntax_factory<const> = {
	syntax = syntax,
}
local generated_line<const> = 1
local generated_column<const> = 1

function syntax_factory.chunk(body)
	return {
		kind = syntax.chunk,
		body = body,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.block(statements)
	return {
		kind = syntax.block,
		statements = statements,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.identifier(name)
	return {
		kind = syntax.identifier_expression,
		name = name,
		line = generated_line,
		column = generated_column,
	}
end

-- Generated locals bind by symbol identity rather than by a reconstructed
-- spelling contract. Each reference call still creates an owned AST
-- occurrence because semantic binding annotates identifier nodes in place.
function syntax_factory.generated_symbol(name)
	return { name = name }
end

function syntax_factory.reference(symbol)
	return {
		kind = syntax.identifier_expression,
		name = symbol,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.number_literal(value)
	return {
		kind = syntax.number_literal_expression,
		value = value,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.string_literal(value)
	return {
		kind = syntax.string_literal_expression,
		value = value,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.boolean_literal(value)
	return {
		kind = syntax.boolean_literal_expression,
		value = value,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.nil_literal()
	return {
		kind = syntax.nil_literal_expression,
		line = generated_line,
		column = generated_column,
	}
end

local literal_factory_by_type<const> = {
	number = syntax_factory.number_literal,
	string = syntax_factory.string_literal,
	boolean = syntax_factory.boolean_literal,
}

function syntax_factory.literal(value)
	return literal_factory_by_type[type(value)](value)
end

function syntax_factory.member_expression(base, identifier)
	return {
		kind = syntax.member_expression,
		base = base,
		identifier = identifier,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.index_expression(base, index)
	return {
		kind = syntax.index_expression,
		base = base,
		index = index,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.index_path(base, path)
	local expression = base
	for index = 1, #path do
		expression = syntax_factory.index_expression(
			expression,
			syntax_factory.literal(path[index])
		)
	end
	return expression
end

function syntax_factory.call_expression(callee, arguments, method_name)
	return {
		kind = syntax.call_expression,
		callee = callee,
		arguments = arguments,
		method_name = method_name,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.binary_expression(operator, left, right)
	return {
		kind = syntax.binary_expression,
		operator = operator,
		left = left,
		right = right,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.unary_expression(operator, operand)
	return {
		kind = syntax.unary_expression,
		operator = operator,
		operand = operand,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.function_expression(parameters, body)
	return {
		kind = syntax.function_expression,
		parameters = parameters,
		body = body,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.assignment_statement(target, value)
	return {
		kind = syntax.assignment_statement,
		target = target,
		value = value,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.local_statement(name, initializer, is_const)
	return {
		kind = syntax.local_statement,
		name = name,
		is_const = is_const,
		initializer = initializer,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.call_statement(expression)
	return {
		kind = syntax.call_statement,
		expression = expression,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.if_clause(condition, block)
	return {
		condition = condition,
		block = block,
	}
end

function syntax_factory.else_clause(block)
	return {
		block = block,
	}
end

function syntax_factory.if_statement(clauses)
	return {
		kind = syntax.if_statement,
		clauses = clauses,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.while_statement(condition, block)
	return {
		kind = syntax.while_statement,
		condition = condition,
		block = block,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.numeric_for_statement(
	variable,
	start_expression,
	limit_expression,
	step_expression,
	block
)
	return {
		kind = syntax.numeric_for_statement,
		variable = variable,
		start_expression = start_expression,
		limit_expression = limit_expression,
		step_expression = step_expression,
		block = block,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.return_statement(expressions)
	return {
		kind = syntax.return_statement,
		expressions = expressions,
		line = generated_line,
		column = generated_column,
	}
end

function syntax_factory.break_statement()
	return {
		kind = syntax.break_statement,
		line = generated_line,
		column = generated_column,
	}
end

return syntax_factory
