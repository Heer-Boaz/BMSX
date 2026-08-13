-- Matcher definitions are admission data. Each definition compiles into one
-- short-circuit firmware closure so event dispatch never walks its structure or
-- calls a tree of predicate closures.
local event_matcher_source<const> = require('cartlib/event_matcher_source')
local compile_syntax<const> = lua_compiler.compile_syntax

local event_matcher<const> = {}

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

function event_matcher.compile(matcher)
	if not matcher then
		return always_matches
	end
	local syntax_tree<const>, source_plan<const> = event_matcher_source.build(matcher)
	local environment<const> = {}
	if source_plan.uses_payload_fields then
		environment.operands = source_plan.operands
		environment.value_type = type
	end
	if source_plan.uses_any_matches then
		environment.any_matches = any_matches
	end
	if source_plan.uses_list_contains then
		environment.list_contains = list_contains
	end
	return compile_syntax(
		syntax_tree,
		'[event_matcher]',
		environment
	)()
end

return event_matcher
