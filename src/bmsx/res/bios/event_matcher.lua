-- event_matcher.lua
-- compile payload matchers used by event-driven routers

local event_matcher = {}

local function list_contains(list, value)
	for i = 1, #list do
		if list[i] == value then
			return true
		end
	end
	return false
end

local function any_matches(list, value)
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
		return function()
			return true
		end
	end

	local equals = matcher.equals
	local any_of_entries = {}
	if matcher.any_of then
		for key, list in pairs(matcher.any_of) do
			any_of_entries[#any_of_entries + 1] = { key, list }
		end
	end
	if matcher['in'] then
		for key, list in pairs(matcher['in']) do
			any_of_entries[#any_of_entries + 1] = { key, list }
		end
	end
	local required_tags = matcher.has_tag
	local and_predicates = {}
	if matcher['and'] then
		for i = 1, #matcher['and'] do
			and_predicates[i] = event_matcher.compile(matcher['and'][i])
		end
	end
	local or_predicates = {}
	if matcher['or'] then
		for i = 1, #matcher['or'] do
			or_predicates[i] = event_matcher.compile(matcher['or'][i])
		end
	end
	local not_predicate = matcher['not'] and event_matcher.compile(matcher['not'])

	return function(payload)
		if equals then
			for key, value in pairs(equals) do
				if payload[key] ~= value then
					return false
				end
			end
		end
		for i = 1, #any_of_entries do
			local entry = any_of_entries[i]
			if not any_matches(entry[2], payload[entry[1]]) then
				return false
			end
		end
		if required_tags and #required_tags > 0 then
			local tags = payload.tags
			if not tags then
				return false
			end
			for i = 1, #required_tags do
				if not list_contains(tags, required_tags[i]) then
					return false
				end
			end
		end
		for i = 1, #and_predicates do
			if not and_predicates[i](payload) then
				return false
			end
		end
		if not_predicate and not_predicate(payload) then
			return false
		end
		if #or_predicates > 0 then
			for i = 1, #or_predicates do
				if or_predicates[i](payload) then
					return true
				end
			end
			return false
		end
		return true
	end
end

return event_matcher
