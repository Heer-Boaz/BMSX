-- Matcher definitions are admission data. Each definition compiles into one
-- short-circuit firmware closure so event dispatch never walks its structure or
-- calls a tree of predicate closures.
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local event_matcher<const> = {}
local templates<const> = {}
local requirement_payload_fields<const> = 1
local requirement_any_matches<const> = 2
local requirement_list_contains<const> = 4

local always_matches<const> = function()
	return true
end

local list_contains<const> = function(list, value)
	for i = 1, #list do
		if list[i] == value then
			return true
		end
	end
	return false
end

local any_matches<const> = function(list, value)
	if type(value) == 'table' then
		for i = 1, #value do
			if list_contains(list, value[i]) then
				return true
			end
		end
		return false
	end
	return list_contains(list, value)
end

local analyze_matcher
analyze_matcher = function(matcher)
	if not matcher then
		return 0
	end
	local equals<const> = matcher.equals
	local any_of<const> = matcher.any_of
	local in_values<const> = matcher['in']
	local required_tags<const> = matcher.has_tag
	local requirements = 0
	if (equals ~= nil and next(equals) ~= nil)
	or (any_of ~= nil and next(any_of) ~= nil)
	or (in_values ~= nil and next(in_values) ~= nil)
	or (required_tags ~= nil and #required_tags > 0) then
		requirements = requirement_payload_fields
	end
	if (any_of ~= nil and next(any_of) ~= nil)
	or (in_values ~= nil and next(in_values) ~= nil) then
		requirements = requirements | requirement_any_matches
	end
	if required_tags ~= nil and #required_tags > 0 then
		requirements = requirements | requirement_list_contains
	end
	local and_matchers<const> = matcher['and']
	if and_matchers ~= nil then
		for index = 1, #and_matchers do
			requirements = requirements | analyze_matcher(and_matchers[index])
		end
	end
	requirements = requirements | analyze_matcher(matcher['not'])
	local or_matchers<const> = matcher['or']
	if or_matchers ~= nil then
		for index = 1, #or_matchers do
			requirements = requirements | analyze_matcher(or_matchers[index])
		end
	end
	return requirements
end

local emit_matcher

local add_operand<const> = function(values, operand)
	local operands<const> = values.operands
	local index<const> = #operands + 1
	operands[index] = operand
	return index
end

local emit_equals<const> = function(printer, values)
	local equals<const> = values.matcher.equals
	if equals == nil then
		return
	end
	for key, value in pairs(equals) do
		values.key_operand_index = add_operand(values, key)
		values.value_operand_index = add_operand(values, value)
		printer:emit(templates.equals, values)
	end
end

local emit_any_entries<const> = function(printer, values, entries)
	if entries == nil then
		return
	end
	for key, list in pairs(entries) do
		values.list_operand_index = add_operand(values, list)
		values.key_operand_index = add_operand(values, key)
		printer:emit(templates.any, values)
	end
end

local emit_any_of<const> = function(printer, values)
	emit_any_entries(printer, values, values.matcher.any_of)
end

local emit_in_values<const> = function(printer, values)
	emit_any_entries(printer, values, values.matcher['in'])
end

local emit_required_tags<const> = function(printer, values)
	local required_tags<const> = values.matcher.has_tag
	if required_tags == nil or #required_tags == 0 then
		return
	end
	printer:emit(templates.tags_present, values)
	for index = 1, #required_tags do
		values.tag_operand_index = add_operand(values, required_tags[index])
		printer:emit(templates.required_tag, values)
	end
end

local emit_child_matcher<const> = function(printer, values)
	emit_matcher(printer, values, values.child_matcher)
end

local emit_or_matchers<const> = function(printer, values)
	local matchers<const> = values.or_matchers
	for index = 1, #matchers do
		if index > 1 then
			printer:emit(templates.or_separator, values)
		end
		values.child_matcher = matchers[index]
		printer:emit(templates.grouped_matcher, values)
	end
end

emit_matcher = function(printer, values, matcher)
	if not matcher then
		printer:emit(templates.true_expression, values)
		return
	end
	local equals<const> = matcher.equals
	local any_of<const> = matcher.any_of
	local in_values<const> = matcher['in']
	local required_tags<const> = matcher.has_tag
	local reads_payload_fields<const> = (equals ~= nil and next(equals) ~= nil)
		or (any_of ~= nil and next(any_of) ~= nil)
		or (in_values ~= nil and next(in_values) ~= nil)
		or (required_tags ~= nil and #required_tags > 0)
	local term_count = 0
	if reads_payload_fields then
		values.matcher = matcher
		printer:emit(templates.payload_fields, values)
		term_count = 1
	end

	local and_matchers<const> = matcher['and']
	if and_matchers ~= nil then
		for index = 1, #and_matchers do
			if term_count > 0 then
				printer:emit(templates.and_separator, values)
			end
			values.child_matcher = and_matchers[index]
			printer:emit(templates.grouped_matcher, values)
			term_count = term_count + 1
		end
	end

	local not_matcher<const> = matcher['not']
	if not_matcher then
		if term_count > 0 then
			printer:emit(templates.and_separator, values)
		end
		values.child_matcher = not_matcher
		printer:emit(templates.not_matcher, values)
		term_count = term_count + 1
	end

	local or_matchers<const> = matcher['or']
	if or_matchers ~= nil and #or_matchers > 0 then
		if term_count > 0 then
			printer:emit(templates.and_separator, values)
		end
		values.or_matchers = or_matchers
		printer:emit(templates.or_matchers, values)
		term_count = term_count + 1
	end

	if term_count == 0 then
		printer:emit(templates.true_expression, values)
	end
end

local emit_locals<const> = function(printer, values)
	local requirements<const> = values.requirements
	if requirements & requirement_payload_fields ~= 0 then
		printer:emit(templates.operands_local, values)
		printer:emit(templates.payload_type_local, values)
	end
	if requirements & requirement_any_matches ~= 0 then
		printer:emit(templates.any_local, values)
	end
	if requirements & requirement_list_contains ~= 0 then
		printer:emit(templates.list_contains_local, values)
	end
end

local emit_root_matcher<const> = function(printer, values)
	emit_matcher(printer, values, values.root_matcher)
end

templates.equals = lua_source_printer.compile_template(
	' and payload[operands[$key_operand_index$]] == operands[$value_operand_index$]'
)

templates.any = lua_source_printer.compile_template(
	' and any_matches(operands[$list_operand_index$], payload[operands[$key_operand_index$]])'
)

templates.tags_present = lua_source_printer.compile_template(' and payload["tags"]')

templates.required_tag = lua_source_printer.compile_template(
	' and list_contains(payload["tags"], operands[$tag_operand_index$])'
)

templates.payload_fields = lua_source_printer.compile_template(
	'(value_type(payload) == "table"$equals$$any_of$$in_values$$required_tags$)',
	{
		equals = emit_equals,
		any_of = emit_any_of,
		in_values = emit_in_values,
		required_tags = emit_required_tags,
	}
)

templates.true_expression = lua_source_printer.compile_template('true')
templates.and_separator = lua_source_printer.compile_template(' and ')
templates.or_separator = lua_source_printer.compile_template(' or ')

templates.grouped_matcher = lua_source_printer.compile_template(
	'($matcher$)',
	{ matcher = emit_child_matcher }
)

templates.not_matcher = lua_source_printer.compile_template(
	'not ($matcher$)',
	{ matcher = emit_child_matcher }
)

templates.or_matchers = lua_source_printer.compile_template(
	'($matchers$)',
	{ matchers = emit_or_matchers }
)

templates.operands_local = lua_source_printer.compile_template('local operands<const> = operands\n')
templates.payload_type_local = lua_source_printer.compile_template('local value_type<const> = value_type\n')
templates.any_local = lua_source_printer.compile_template('local any_matches<const> = any_matches\n')
templates.list_contains_local = lua_source_printer.compile_template('local list_contains<const> = list_contains\n')

templates.program = lua_source_printer.compile_template([[
	$locals$
	return function(payload)
		return $matcher$
	end
]], {
	locals = emit_locals,
	matcher = emit_root_matcher,
})

function event_matcher.compile(matcher)
	if not matcher then
		return always_matches
	end
	local requirements<const> = analyze_matcher(matcher)
	local values<const> = {
		root_matcher = matcher,
		requirements = requirements,
		operands = {},
	}
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.program, values)
	local environment<const> = {}
	if requirements & requirement_payload_fields ~= 0 then
		environment.operands = values.operands
		environment.value_type = type
	end
	if requirements & requirement_any_matches ~= 0 then
		environment.any_matches = any_matches
	end
	if requirements & requirement_list_contains ~= 0 then
		environment.list_contains = list_contains
	end
	return load(printer:finish(), '[event_matcher]', 't', environment)()
end

return event_matcher
