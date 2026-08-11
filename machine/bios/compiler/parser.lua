local lexer<const> = require('compiler/lexer')
local syntax<const> = require('compiler/syntax')
local token<const> = require('compiler/token')

local parser<const> = {}

local fail<const> = function(state, message, line, column)
	error('[load:' .. state.chunk_name .. '] ' .. message .. ' at '
		.. tostring(line) .. ':' .. tostring(column))
end

local match<const> = function(state, kind)
	if state.token_kind ~= kind then
		return false
	end
	lexer.next(state)
	return true
end

local expect<const> = function(state, kind)
	if state.token_kind ~= kind then
		fail(
			state,
			"expected '" .. token.name[kind] .. "'",
			state.token_line,
			state.token_column
		)
	end
	lexer.next(state)
end

local consume_identifier<const> = function(state)
	if state.token_kind ~= token.identifier then
		fail(
			state,
			"expected '" .. token.name[token.identifier] .. "'",
			state.token_line,
			state.token_column
		)
	end
	local name<const> = state.token_lexeme
	local line<const> = state.token_line
	local column<const> = state.token_column
	lexer.next(state)
	return name, line, column
end

local identifier_expression<const> = function(name, line, column)
	return {
		kind = syntax.identifier_expression,
		name = name,
		line = line,
		column = column,
	}
end

local parse_expression
local parse_function_expression
local parse_statement
local parse_block
local parse_unary_expression
local parse_multiplicative_expression
local parse_additive_expression
local parse_comparison_expression
local parse_and_expression
local parse_or_expression

local end_terminators<const> = {
	[token.keyword_end] = true,
}

local if_clause_terminators<const> = {
	[token.keyword_else] = true,
	[token.keyword_elseif] = true,
	[token.keyword_end] = true,
}

local return_terminators<const> = {
	[token.semicolon] = true,
	[token.keyword_else] = true,
	[token.keyword_elseif] = true,
	[token.keyword_end] = true,
	[token.eof] = true,
}

local eof_terminators<const> = {
	[token.eof] = true,
}

local additive_operator_by_token<const> = {
	[token.plus] = syntax.binary_add,
	[token.minus] = syntax.binary_subtract,
}

local multiplicative_operator_by_token<const> = {
	[token.star] = syntax.binary_multiply,
	[token.slash] = syntax.binary_divide,
	[token.floor_divide] = syntax.binary_floor_divide,
	[token.percent] = syntax.binary_modulus,
}

local comparison_operator_by_token<const> = {
	[token.equal_equal] = syntax.binary_equal,
	[token.not_equal] = syntax.binary_not_equal,
	[token.less] = syntax.binary_less,
	[token.less_equal] = syntax.binary_less_equal,
	[token.greater] = syntax.binary_greater,
	[token.greater_equal] = syntax.binary_greater_equal,
}

local and_operator_by_token<const> = {
	[token.keyword_and] = syntax.binary_and,
}

local or_operator_by_token<const> = {
	[token.keyword_or] = syntax.binary_or,
}

local parse_primary_expression<const> = function(state)
	local kind<const> = state.token_kind
	if kind == token.identifier then
		local expression<const> = identifier_expression(
			state.token_lexeme,
			state.token_line,
			state.token_column
		)
		lexer.next(state)
		return expression
	end
	if kind == token.number then
		local expression<const> = {
			kind = syntax.number_literal_expression,
			value = state.token_literal,
			line = state.token_line,
			column = state.token_column,
		}
		lexer.next(state)
		return expression
	end
	if kind == token.string then
		local expression<const> = {
			kind = syntax.string_literal_expression,
			value = state.token_literal,
			line = state.token_line,
			column = state.token_column,
		}
		lexer.next(state)
		return expression
	end
	if kind == token.keyword_false or kind == token.keyword_true then
		local expression<const> = {
			kind = syntax.boolean_literal_expression,
			value = kind == token.keyword_true,
			line = state.token_line,
			column = state.token_column,
		}
		lexer.next(state)
		return expression
	end
	if kind == token.keyword_nil then
		local expression<const> = {
			kind = syntax.nil_literal_expression,
			line = state.token_line,
			column = state.token_column,
		}
		lexer.next(state)
		return expression
	end
	if kind == token.keyword_function then
		return parse_function_expression(state)
	end
	if match(state, token.left_parenthesis) then
		local expression<const> = parse_expression(state)
		expect(state, token.right_parenthesis)
		return expression
	end
	fail(
		state,
		'unsupported expression',
		state.token_line,
		state.token_column
	)
end

local parse_prefix_expression<const> = function(state)
	local expression = parse_primary_expression(state)
	while true do
		if match(state, token.dot) then
			local identifier<const> = consume_identifier(state)
			expression = {
				kind = syntax.member_expression,
				base = expression,
				identifier = identifier,
				line = expression.line,
				column = expression.column,
			}
		elseif match(state, token.left_bracket) then
			local index<const> = parse_expression(state)
			expect(state, token.right_bracket)
			expression = {
				kind = syntax.index_expression,
				base = expression,
				index = index,
				line = expression.line,
				column = expression.column,
			}
		elseif match(state, token.left_parenthesis) then
			local arguments<const> = {}
			if state.token_kind ~= token.right_parenthesis then
				while true do
					arguments[#arguments + 1] = parse_expression(state)
					if not match(state, token.comma) then
						break
					end
				end
			end
			expect(state, token.right_parenthesis)
			expression = {
				kind = syntax.call_expression,
				callee = expression,
				arguments = arguments,
				line = expression.line,
				column = expression.column,
			}
		else
			return expression
		end
	end
end

parse_unary_expression = function(state)
	local kind<const> = state.token_kind
	local operator
	if kind == token.minus then
		operator = syntax.unary_negate
	elseif kind == token.ampersand then
		operator = syntax.unary_string_id
	elseif kind == token.keyword_not then
		operator = syntax.unary_not
	else
		return parse_prefix_expression(state)
	end
	local line<const> = state.token_line
	local column<const> = state.token_column
	lexer.next(state)
	return {
		kind = syntax.unary_expression,
		operator = operator,
		operand = parse_unary_expression(state),
		line = line,
		column = column,
	}
end

local parse_left_associative_expression<const> = function(
	state,
	parse_operand,
	operator_by_token
)
	local expression = parse_operand(state)
	while true do
		local operator<const> = operator_by_token[state.token_kind]
		if operator == nil then
			return expression
		end
		lexer.next(state)
		expression = {
			kind = syntax.binary_expression,
			operator = operator,
			left = expression,
			right = parse_operand(state),
			line = expression.line,
			column = expression.column,
		}
	end
end

parse_multiplicative_expression = function(state)
	return parse_left_associative_expression(
		state,
		parse_unary_expression,
		multiplicative_operator_by_token
	)
end

parse_additive_expression = function(state)
	return parse_left_associative_expression(
		state,
		parse_multiplicative_expression,
		additive_operator_by_token
	)
end

parse_comparison_expression = function(state)
	return parse_left_associative_expression(
		state,
		parse_additive_expression,
		comparison_operator_by_token
	)
end

parse_and_expression = function(state)
	return parse_left_associative_expression(
		state,
		parse_comparison_expression,
		and_operator_by_token
	)
end

parse_or_expression = function(state)
	return parse_left_associative_expression(
		state,
		parse_and_expression,
		or_operator_by_token
	)
end

parse_expression = function(state)
	return parse_or_expression(state)
end

local parse_assignment_or_call_statement<const> = function(state)
	local expression<const> = parse_expression(state)
	if match(state, token.equal) then
		return {
			kind = syntax.assignment_statement,
			target = expression,
			value = parse_expression(state),
			line = expression.line,
			column = expression.column,
		}
	end
	if expression.kind == syntax.call_expression then
		return {
			kind = syntax.call_statement,
			expression = expression,
			line = expression.line,
			column = expression.column,
		}
	end
	fail(
		state,
		'expected assignment or function call',
		expression.line,
		expression.column
	)
end

local parse_local_statement<const> = function(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	expect(state, token.keyword_local)
	local name<const>, name_line<const>, name_column<const>
		= consume_identifier(state)
	local initializer
	if match(state, token.equal) then
		initializer = parse_expression(state)
	end
	return {
		kind = syntax.local_statement,
		name = identifier_expression(name, name_line, name_column),
		initializer = initializer,
		line = line,
		column = column,
	}
end

local parse_return_statement<const> = function(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	expect(state, token.keyword_return)
	local expressions<const> = {}
	if return_terminators[state.token_kind] == nil then
		expressions[1] = parse_expression(state)
	end
	return {
		kind = syntax.return_statement,
		expressions = expressions,
		line = line,
		column = column,
	}
end

local parse_if_statement<const> = function(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	expect(state, token.keyword_if)
	local clauses<const> = {}
	while true do
		local condition<const> = parse_expression(state)
		expect(state, token.keyword_then)
		clauses[#clauses + 1] = {
			condition = condition,
			block = parse_block(state, if_clause_terminators),
		}
		if not match(state, token.keyword_elseif) then
			break
		end
	end
	if match(state, token.keyword_else) then
		clauses[#clauses + 1] = {
			block = parse_block(state, end_terminators),
		}
	end
	expect(state, token.keyword_end)
	return {
		kind = syntax.if_statement,
		clauses = clauses,
		line = line,
		column = column,
	}
end

local parse_while_statement<const> = function(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	expect(state, token.keyword_while)
	local condition<const> = parse_expression(state)
	expect(state, token.keyword_do)
	local block<const> = parse_block(state, end_terminators)
	expect(state, token.keyword_end)
	return {
		kind = syntax.while_statement,
		condition = condition,
		block = block,
		line = line,
		column = column,
	}
end

local parse_break_statement<const> = function(state)
	local statement<const> = {
		kind = syntax.break_statement,
		line = state.token_line,
		column = state.token_column,
	}
	expect(state, token.keyword_break)
	return statement
end

parse_statement = function(state)
	if state.token_kind == token.keyword_if then
		return parse_if_statement(state)
	end
	if state.token_kind == token.keyword_while then
		return parse_while_statement(state)
	end
	if state.token_kind == token.keyword_break then
		return parse_break_statement(state)
	end
	if state.token_kind == token.keyword_local then
		return parse_local_statement(state)
	end
	if state.token_kind == token.keyword_return then
		return parse_return_statement(state)
	end
	return parse_assignment_or_call_statement(state)
end

parse_block = function(state, terminators)
	local line<const> = state.token_line
	local column<const> = state.token_column
	local statements<const> = {}
	while terminators[state.token_kind] == nil and state.token_kind ~= token.eof do
		if not match(state, token.semicolon) then
			statements[#statements + 1] = parse_statement(state)
		end
	end
	return {
		kind = syntax.block,
		statements = statements,
		line = line,
		column = column,
	}
end

parse_function_expression = function(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	expect(state, token.keyword_function)
	expect(state, token.left_parenthesis)
	local parameters<const> = {}
	if state.token_kind ~= token.right_parenthesis then
		while true do
			local name<const>, parameter_line<const>, parameter_column<const>
				= consume_identifier(state)
			parameters[#parameters + 1] = identifier_expression(
				name,
				parameter_line,
				parameter_column
			)
			if not match(state, token.comma) then
				break
			end
		end
	end
	expect(state, token.right_parenthesis)
	local body<const> = parse_block(state, end_terminators)
	expect(state, token.keyword_end)
	return {
		kind = syntax.function_expression,
		parameters = parameters,
		body = body,
		line = line,
		column = column,
	}
end

function parser.parse(source, chunk_name)
	local state<const> = lexer.new(source, chunk_name)
	lexer.next(state)
	local line<const> = state.token_line
	local column<const> = state.token_column
	local body<const> = parse_block(state, eof_terminators)
	expect(state, token.eof)
	return {
		kind = syntax.chunk,
		body = body,
		line = line,
		column = column,
	}
end

return parser
