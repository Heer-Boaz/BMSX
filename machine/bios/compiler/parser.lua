local lexer<const> = require('compiler/lexer')
local syntax<const> = require('compiler/syntax')
local token<const> = require('compiler/token')

local parser<const> = {}

local fail<const> = function(state, message, at)
	error('[load:' .. state.chunk_name .. '] ' .. message .. ' at '
		.. tostring(at.line) .. ':' .. tostring(at.column))
end

local advance<const> = function(state)
	local current<const> = state.current
	state.current = lexer.next(state.lexer)
	return current
end

local match<const> = function(state, kind)
	if state.current.kind ~= kind then
		return false
	end
	advance(state)
	return true
end

local expect<const> = function(state, kind)
	if state.current.kind ~= kind then
		fail(state, "expected '" .. token.name[kind] .. "'", state.current)
	end
	return advance(state)
end

local identifier_expression<const> = function(identifier)
	return {
		kind = syntax.identifier_expression,
		name = identifier.lexeme,
		line = identifier.line,
		column = identifier.column,
	}
end

local parse_expression
local parse_function_expression
local parse_statement
local parse_block
local parse_unary_expression

local parse_primary_expression<const> = function(state)
	local current<const> = state.current
	local kind<const> = current.kind
	if kind == token.identifier then
		return identifier_expression(advance(state))
	end
	if kind == token.number then
		advance(state)
		return {
			kind = syntax.number_literal_expression,
			value = current.literal,
			line = current.line,
			column = current.column,
		}
	end
	if kind == token.string then
		advance(state)
		return {
			kind = syntax.string_literal_expression,
			value = current.literal,
			line = current.line,
			column = current.column,
		}
	end
	if kind == token.keyword_false or kind == token.keyword_true then
		advance(state)
		return {
			kind = syntax.boolean_literal_expression,
			value = kind == token.keyword_true,
			line = current.line,
			column = current.column,
		}
	end
	if kind == token.keyword_nil then
		advance(state)
		return {
			kind = syntax.nil_literal_expression,
			line = current.line,
			column = current.column,
		}
	end
	if kind == token.keyword_function then
		return parse_function_expression(state)
	end
	fail(state, 'unsupported expression', current)
end

local parse_prefix_expression<const> = function(state)
	local expression = parse_primary_expression(state)
	while true do
		if match(state, token.dot) then
			local identifier<const> = expect(state, token.identifier)
			expression = {
				kind = syntax.member_expression,
				base = expression,
				identifier = identifier.lexeme,
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
		else
			return expression
		end
	end
end

parse_unary_expression = function(state)
	local current<const> = state.current
	local operator
	if current.kind == token.minus then
		operator = syntax.unary_negate
	elseif current.kind == token.ampersand then
		operator = syntax.unary_string_id
	else
		return parse_prefix_expression(state)
	end
	advance(state)
	return {
		kind = syntax.unary_expression,
		operator = operator,
		operand = parse_unary_expression(state),
		line = current.line,
		column = current.column,
	}
end

parse_expression = function(state)
	return parse_unary_expression(state)
end

local parse_assignment_statement<const> = function(state)
	local target<const> = parse_expression(state)
	expect(state, token.equal)
	local value<const> = parse_expression(state)
	match(state, token.semicolon)
	return {
		kind = syntax.assignment_statement,
		target = target,
		value = value,
		line = target.line,
		column = target.column,
	}
end

local parse_return_statement<const> = function(state)
	local return_token<const> = expect(state, token.keyword_return)
	return {
		kind = syntax.return_statement,
		expressions = { parse_expression(state) },
		line = return_token.line,
		column = return_token.column,
	}
end

parse_statement = function(state)
	if state.current.kind == token.keyword_return then
		return parse_return_statement(state)
	end
	return parse_assignment_statement(state)
end

parse_block = function(state, terminator)
	local first<const> = state.current
	local statements<const> = {}
	while state.current.kind ~= terminator and state.current.kind ~= token.eof do
		statements[#statements + 1] = parse_statement(state)
	end
	return {
		kind = syntax.block,
		statements = statements,
		line = first.line,
		column = first.column,
	}
end

parse_function_expression = function(state)
	local function_token<const> = expect(state, token.keyword_function)
	expect(state, token.left_parenthesis)
	local parameters<const> = {}
	if state.current.kind ~= token.right_parenthesis then
		while true do
			parameters[#parameters + 1] = identifier_expression(expect(state, token.identifier))
			if not match(state, token.comma) then
				break
			end
		end
	end
	expect(state, token.right_parenthesis)
	local body<const> = parse_block(state, token.keyword_end)
	expect(state, token.keyword_end)
	return {
		kind = syntax.function_expression,
		parameters = parameters,
		body = body,
		line = function_token.line,
		column = function_token.column,
	}
end

function parser.parse(source, chunk_name)
	local lexer_state<const> = lexer.new(source, chunk_name)
	local state<const> = {
		chunk_name = chunk_name,
		lexer = lexer_state,
		current = lexer.next(lexer_state),
	}
	local first<const> = state.current
	local body<const> = parse_block(state, token.eof)
	expect(state, token.eof)
	return {
		kind = syntax.chunk,
		body = body,
		line = first.line,
		column = first.column,
	}
end

return parser
