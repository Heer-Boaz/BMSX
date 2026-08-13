local syntax_factory<const> = lua_compiler.syntax_factory

local event_matcher_source<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local string_literal<const> = syntax_factory.string_literal
local boolean_literal<const> = syntax_factory.boolean_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local unary_expression<const> = syntax_factory.unary_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local return_statement<const> = syntax_factory.return_statement

local add_operand<const> = function(state, operand)
	local operands<const> = state.operands
	local index<const> = #operands + 1
	operands[index] = operand
	return index_expression(identifier('operands'), numeric_literal(index))
end

local append_condition<const> = function(expression, condition)
	if expression == nil then
		return condition
	end
	return binary_expression(syntax.binary_and, expression, condition)
end

local build_any_entries<const> = function(state, expression, entries)
	if entries == nil then
		return expression
	end
	state.uses_any_matches = true
	for key, list in pairs(entries) do
		expression = append_condition(
			expression,
			call_expression(identifier('any_matches'), {
				add_operand(state, list),
				index_expression(identifier('payload'), add_operand(state, key)),
			})
		)
	end
	return expression
end

local build_payload_match<const> = function(state, matcher)
	local expression
	local equals<const> = matcher.equals
	if equals ~= nil then
		for key, value in pairs(equals) do
			expression = append_condition(
				expression,
				binary_expression(
					syntax.binary_equal,
					index_expression(identifier('payload'), add_operand(state, key)),
					add_operand(state, value)
				)
			)
		end
	end
	expression = build_any_entries(state, expression, matcher.any_of)
	expression = build_any_entries(state, expression, matcher['in'])
	local required_tags<const> = matcher.has_tag
	if required_tags ~= nil and #required_tags > 0 then
		state.uses_list_contains = true
		expression = append_condition(
			expression,
			member_expression(identifier('payload'), 'tags')
		)
		for index = 1, #required_tags do
			expression = append_condition(
				expression,
				call_expression(identifier('list_contains'), {
					member_expression(identifier('payload'), 'tags'),
					add_operand(state, required_tags[index]),
				})
			)
		end
	end
	if expression == nil then
		return nil
	end
	state.uses_payload_fields = true
	return binary_expression(
		syntax.binary_and,
		binary_expression(
			syntax.binary_equal,
			call_expression(identifier('value_type'), { identifier('payload') }),
			string_literal('table')
		),
		expression
	)
end

local build_matcher
build_matcher = function(state, matcher)
	if not matcher then
		return boolean_literal(true)
	end
	local expression = build_payload_match(state, matcher)
	local and_matchers<const> = matcher['and']
	if and_matchers ~= nil then
		for index = 1, #and_matchers do
			expression = append_condition(expression, build_matcher(state, and_matchers[index]))
		end
	end
	local not_matcher<const> = matcher['not']
	if not_matcher then
		expression = append_condition(
			expression,
			unary_expression(syntax.unary_not, build_matcher(state, not_matcher))
		)
	end
	local or_matchers<const> = matcher['or']
	if or_matchers ~= nil and #or_matchers > 0 then
		local or_expression = build_matcher(state, or_matchers[1])
		for index = 2, #or_matchers do
			or_expression = binary_expression(
				syntax.binary_or,
				or_expression,
				build_matcher(state, or_matchers[index])
			)
		end
		expression = append_condition(expression, or_expression)
	end
	if expression == nil then
		return boolean_literal(true)
	end
	return expression
end

function event_matcher_source.build(matcher)
	local state<const> = {
		operands = {},
		uses_payload_fields = false,
		uses_any_matches = false,
		uses_list_contains = false,
	}
	local matcher_expression<const> = build_matcher(state, matcher)
	local statements<const> = {}
	if state.uses_payload_fields then
		statements[#statements + 1] = local_statement(
			identifier('operands'),
			identifier('operands'),
			true
		)
		statements[#statements + 1] = local_statement(
			identifier('value_type'),
			identifier('value_type'),
			true
		)
	end
	if state.uses_any_matches then
		statements[#statements + 1] = local_statement(
			identifier('any_matches'),
			identifier('any_matches'),
			true
		)
	end
	if state.uses_list_contains then
		statements[#statements + 1] = local_statement(
			identifier('list_contains'),
			identifier('list_contains'),
			true
		)
	end
	statements[#statements + 1] = return_statement({
		function_expression(
			{ identifier('payload') },
			block({ return_statement({ matcher_expression }) })
		),
	})
	return syntax_factory.chunk(block(statements)), state
end

return event_matcher_source
