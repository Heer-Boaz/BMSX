-- event_matcher.lua
-- compile payload matchers used by event-driven routers

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

local append_operand<const> = function(parts, value)
	local operands<const> = parts.operands
	local index<const> = #operands + 1
	operands[index] = value
	parts[#parts + 1] = 'operands['
	parts[#parts + 1] = index
	parts[#parts + 1] = ']'
end

local append_any<const> = function(parts, entries)
	if entries == nil then
		return
	end
	for key, list in pairs(entries) do
		parts.uses_any = true
		parts[#parts + 1] = ' and any_matches('
		append_operand(parts, list)
		parts[#parts + 1] = ', payload['
		append_operand(parts, key)
		parts[#parts + 1] = '])'
	end
end

local append_matcher
append_matcher = function(parts, matcher)
	if not matcher then
		parts[#parts + 1] = 'true'
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
		parts.uses_payload_type = true
		parts[#parts + 1] = '(value_type(payload) == "table"'
		if equals ~= nil then
			for key, value in pairs(equals) do
				parts[#parts + 1] = ' and payload['
				append_operand(parts, key)
				parts[#parts + 1] = '] == '
				append_operand(parts, value)
			end
		end
		append_any(parts, any_of)
		append_any(parts, in_values)
		if required_tags ~= nil and #required_tags > 0 then
			parts.uses_list_contains = true
			parts[#parts + 1] = ' and payload["tags"]'
			for index = 1, #required_tags do
				parts[#parts + 1] = ' and list_contains(payload["tags"], '
				append_operand(parts, required_tags[index])
				parts[#parts + 1] = ')'
			end
		end
		parts[#parts + 1] = ')'
		term_count = 1
	end

	local and_matchers<const> = matcher['and']
	if and_matchers ~= nil then
		for index = 1, #and_matchers do
			if term_count > 0 then
				parts[#parts + 1] = ' and '
			end
			parts[#parts + 1] = '('
			append_matcher(parts, and_matchers[index])
			parts[#parts + 1] = ')'
			term_count = term_count + 1
		end
	end

	local not_matcher<const> = matcher['not']
	if not_matcher then
		if term_count > 0 then
			parts[#parts + 1] = ' and '
		end
		parts[#parts + 1] = 'not ('
		append_matcher(parts, not_matcher)
		parts[#parts + 1] = ')'
		term_count = term_count + 1
	end

	local or_matchers<const> = matcher['or']
	if or_matchers ~= nil and #or_matchers > 0 then
		if term_count > 0 then
			parts[#parts + 1] = ' and '
		end
		parts[#parts + 1] = '('
		for index = 1, #or_matchers do
			if index > 1 then
				parts[#parts + 1] = ' or '
			end
			parts[#parts + 1] = '('
			append_matcher(parts, or_matchers[index])
			parts[#parts + 1] = ')'
		end
		parts[#parts + 1] = ')'
		term_count = term_count + 1
	end

	if term_count == 0 then
		parts[#parts + 1] = 'true'
	end
end

-- Matcher definitions are admission data. Compile each definition into one
-- short-circuit firmware closure so event dispatch never walks its structure or
-- calls a tree of predicate closures.
function event_matcher.compile(matcher)
	if not matcher then
		return always_matches
	end

	local parts<const> = {
		'return function(payload)\n',
		'',
		'',
		'',
		'',
		'return ',
	}
	parts.operands = {}
	append_matcher(parts, matcher)
	parts[#parts + 1] = '\nend'
	local environment<const> = {}
	if #parts.operands > 0 then
		parts[2] = 'local operands = operands\n'
		environment.operands = parts.operands
	end
	if parts.uses_payload_type then
		parts[3] = 'local value_type = value_type\n'
		environment.value_type = type
	end
	if parts.uses_any then
		parts[4] = 'local any_matches = any_matches\n'
		environment.any_matches = any_matches
	end
	if parts.uses_list_contains then
		parts[5] = 'local list_contains = list_contains\n'
		environment.list_contains = list_contains
	end
	return load(table.concat(parts), '[event_matcher]', 't', environment)()
end

return event_matcher
