-- eventmatcher.lua
-- compile payload matchers used by event-driven routers

local eventmatcher<const> = {}

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

function eventmatcher.compile(matcher)
	if not matcher then
		return always_matches
	end

	local equals<const> = matcher.equals
	local equals_entries<const> = {}
	if equals then
		for key, value in pairs(equals) do
			equals_entries[#equals_entries + 1] = key
			equals_entries[#equals_entries + 1] = value
		end
	end
	local any_of_entries<const> = {}
	if matcher.any_of then
		for key, list in pairs(matcher.any_of) do
			any_of_entries[#any_of_entries + 1] = key
			any_of_entries[#any_of_entries + 1] = list
		end
	end
	if matcher['in'] then
		for key, list in pairs(matcher['in']) do
			any_of_entries[#any_of_entries + 1] = key
			any_of_entries[#any_of_entries + 1] = list
		end
	end
	local required_tags<const> = matcher.has_tag
	local reads_payload_fields<const> = #equals_entries > 0
		or #any_of_entries > 0
		or (required_tags ~= nil and #required_tags > 0)
	local and_predicates<const> = {}
	if matcher['and'] then
		for i = 1, #matcher['and'] do
			and_predicates[i] = eventmatcher.compile(matcher['and'][i])
		end
	end
	local or_predicates<const> = {}
	if matcher['or'] then
		for i = 1, #matcher['or'] do
			or_predicates[i] = eventmatcher.compile(matcher['or'][i])
		end
	end
	local not_predicate<const> = matcher['not'] and eventmatcher.compile(matcher['not'])

	return function(payload)
		if reads_payload_fields and type(payload) ~= 'table' then
			return false
		end
		for i = 1, #equals_entries, 2 do
			if payload[equals_entries[i]] ~= equals_entries[i + 1] then
				return false
			end
		end
		for i = 1, #any_of_entries, 2 do
			if not any_matches(any_of_entries[i + 1], payload[any_of_entries[i]]) then
				return false
			end
		end
		if required_tags and #required_tags > 0 then
			local tags<const> = payload.tags
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

return eventmatcher
