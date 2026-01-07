-- audio_router.lua
-- routes Lua events to native audio commands using audioevents assets

local eventemitter = require("eventemitter").eventemitter

local router = { _inited = false, _bound = false, _events = nil, _any_handler = nil, _last_bind_status = nil }
local last_random_pick_by_rule = {}
local last_played_at = {}
local pending_events = {}
local handle_event

local function now_ms()
	return os.clock() * 1000
end

local function log_router(message)
	print("[AudioRouter] " .. message)
end

local function count_entries(map)
	local count = 0
	for _ in pairs(map) do
		count = count + 1
	end
	return count
end

local function format_entity(value)
	if value == nil then
		return "nil"
	end
	local value_type = type(value)
	if value_type == "table" or value_type == "native" then
		if value.id ~= nil then
			return tostring(value.id)
		end
		if value.name ~= nil then
			return tostring(value.name)
		end
	end
	return tostring(value)
end

local function format_tags(tags)
	if tags == nil then
		return "nil"
	end
	local tags_type = type(tags)
	if tags_type == "table" or tags_type == "native" then
		local out = {}
		for i = 1, #tags do
			out[#out + 1] = tostring(tags[i])
		end
		return table.concat(out, ",")
	end
	return tostring(tags)
end

local function format_event_details(event_name, payload)
	if event_name == "combat.start" then
		return " monster_imgid=" .. tostring(payload.monster_imgid) .. " node_id=" .. tostring(payload.node_id)
	end
	if event_name == "combat.results" then
		return " monster_imgid=" .. tostring(payload.monster_imgid) .. " combat_node_id=" .. tostring(payload.combat_node_id)
	end
	if event_name == "story.node.enter" then
		return " node_id=" .. tostring(payload.node_id) .. " bg=" .. tostring(payload.bg) .. " label=" .. tostring(payload.label)
			.. " just_finished_combat=" .. tostring(payload.just_finished_combat)
			.. " last_combat_monster_imgid=" .. tostring(payload.last_combat_monster_imgid)
	end
	return ""
end

local function log_bind_status(status)
	if router._last_bind_status ~= status then
		log_router(status)
		router._last_bind_status = status
	end
end

local function list_contains(list, value)
	for i = 1, #list do
		if list[i] == value then
			return true
		end
	end
	return false
end

local function any_matches(list, value)
	if type(value) == "table" then
		for i = 1, #value do
			if list_contains(list, value[i]) then
				return true
			end
		end
		return false
	end
	return list_contains(list, value)
end

local function should_buffer_event(event)
	if not event then
		return false
	end
	local name = event.type
	if not name then
		return false
	end
	if string.sub(name, 1, 9) == "timeline." then
		return false
	end
	return true
end

local function stash_event(event)
	if not should_buffer_event(event) then
		return
	end
	pending_events[event.type] = event
end

local function flush_pending()
	if not router._events then
		return
	end
	local latest_event = nil
	local latest_name = nil
	local latest_ts = -1
	for event_name, event in pairs(pending_events) do
		local entry = router._events[event_name]
		if entry then
			local ts = event.timestamp or event.timeStamp or 0
			if ts >= latest_ts then
				latest_ts = ts
				latest_event = event
				latest_name = event_name
			end
		end
	end
	for k in pairs(pending_events) do
		pending_events[k] = nil
	end
	if latest_event and latest_name then
		local entry = router._events[latest_name]
		if entry then
			handle_event(latest_name, entry, latest_event)
		end
	end
end

local function compile_matcher(matcher)
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
	if matcher["in"] then
		for key, list in pairs(matcher["in"]) do
			any_of_entries[#any_of_entries + 1] = { key, list }
		end
	end
	local required_tags = matcher.has_tag
	local and_predicates = {}
	if matcher["and"] then
		for i = 1, #matcher["and"] do
			and_predicates[i] = compile_matcher(matcher["and"][i])
		end
	end
	local or_predicates = {}
	if matcher["or"] then
		for i = 1, #matcher["or"] do
			or_predicates[i] = compile_matcher(matcher["or"][i])
		end
	end
	local not_predicate = matcher["not"] and compile_matcher(matcher["not"]) or nil

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
			local key = entry[1]
			local list = entry[2]
			if not any_matches(list, payload[key]) then
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
			local any = false
			for i = 1, #or_predicates do
				if or_predicates[i](payload) then
					any = true
					break
				end
			end
			if not any then
				return false
			end
		end
		return true
	end
end

local function compile_rules(rules)
	if not rules or #rules == 0 then
		return {}
	end
	local compiled = {}
	for i = 1, #rules do
		local rule = rules[i]
		rule.__predicate = compile_matcher(rule.when)
		local spec = rule.go
		if spec and spec.one_of then
			local actions = {}
			local weights = {}
			local has_weights = false
			for j = 1, #spec.one_of do
				local item = spec.one_of[j]
				if type(item) == "string" or type(item) == "number" then
					actions[#actions + 1] = { audio_id = item }
					weights[#weights + 1] = 1
				else
					if not item.audio_id then
						error("audio_router one_of item missing audio_id")
					end
					actions[#actions + 1] = item
					local weight = item.weight or 1
					if weight ~= 1 then
						has_weights = true
					end
					weights[#weights + 1] = weight
				end
			end
			rule.__oneof_actions = actions
			rule.__oneof_weights = weights
			rule.__oneof_has_weights = has_weights
		end
		compiled[#compiled + 1] = rule
	end
	return compiled
end

local function pick_uniform_index(count, avoid_index)
	if count <= 1 then
		return 1
	end
	local idx = math.floor(math.random() * count) + 1
	if avoid_index and idx == avoid_index then
		idx = (idx % count) + 1
	end
	return idx
end

local function pick_weighted_index(weights, avoid_index)
	local count = #weights
	if count <= 1 then
		return 1
	end
	local total = 0
	for i = 1, count do
		local weight = weights[i]
		if avoid_index and avoid_index == i then
			weight = 0
		end
		if weight < 0 then
			weight = 0
		end
		weights[i] = weight
		total = total + weight
	end
	if total <= 0 then
		return pick_uniform_index(count, avoid_index)
	end
	local r = math.random() * total
	for i = 1, count do
		r = r - weights[i]
		if r <= 0 then
			return i
		end
	end
	return count
end

local function resolve_action_spec(event_name, rule_index, rule, payload)
	local spec = rule.go
	if not spec or not spec.one_of then
		return spec
	end
	local actions = rule.__oneof_actions
	local weights = rule.__oneof_weights
	if not actions or #actions == 0 then
		return nil
	end
	local pick_mode = spec.pick
	if not pick_mode then
		if rule.__oneof_has_weights then
			pick_mode = "weighted"
		else
			pick_mode = "uniform"
		end
	end
	local actor_key = payload.actorId or "global"
	local rule_key = event_name .. "#" .. rule_index .. "#" .. actor_key
	local last_index = last_random_pick_by_rule[rule_key]
	local avoid = spec.avoid_repeat and last_index or nil
	local idx = 1
	if pick_mode == "weighted" then
		idx = pick_weighted_index(weights, avoid)
	else
		idx = pick_uniform_index(#actions, avoid)
	end
	last_random_pick_by_rule[rule_key] = idx
	return actions[idx]
end

local function merge_events(map)
	local merged = {}

	local function add_or_merge(event_name, entry)
		if not event_name or event_name == "" then
			error("audio_router event name is missing")
		end
		local cur = merged[event_name]
		local compiled_rules = compile_rules(entry.rules)
		if not cur then
			local out = {}
			for k, v in pairs(entry) do
				if k ~= "rules" then
					out[k] = v
				end
			end
			out.name = event_name
			out.rules = compiled_rules
			merged[event_name] = out
			return
		end
		local out = {}
		for k, v in pairs(cur) do
			if k ~= "rules" then
				out[k] = v
			end
		end
		for k, v in pairs(entry) do
			if k ~= "rules" then
				out[k] = v
			end
		end
		out.name = event_name
		local combined = {}
		for i = 1, #compiled_rules do
			combined[#combined + 1] = compiled_rules[i]
		end
		for i = 1, #cur.rules do
			combined[#combined + 1] = cur.rules[i]
		end
		out.rules = combined
		merged[event_name] = out
	end

	for asset_id, value in pairs(map) do
		local value_type = type(value)
		if value_type ~= "table" and value_type ~= "native" then
			error("audio_router asset '" .. tostring(asset_id) .. "' must be a table")
		end

		local events = value.events
		if events ~= nil then
			local events_type = type(events)
			if events_type ~= "table" and events_type ~= "native" then
				error("audio_router asset '" .. tostring(asset_id) .. "' has invalid events")
			end
			for event_name, entry in pairs(events) do
				add_or_merge(event_name, entry)
			end
		else
			local found_direct = false
			for key, entry in pairs(value) do
				if key ~= "$type" and key ~= "events" and key ~= "name" and key ~= "channel" and key ~= "max_voices" and key ~= "policy" and key ~= "rules" then
					local entry_type = type(entry)
					if entry_type == "table" or entry_type == "native" then
						if entry.rules ~= nil then
							found_direct = true
							add_or_merge(key, entry)
						end
					end
				end
			end
			if not found_direct and value.rules ~= nil then
				local event_name = value.name
				if type(event_name) ~= "string" or event_name == "" then
					error("audio_router event entry is missing name")
				end
				add_or_merge(event_name, value)
			end
		end
	end

	return merged
end

local function resolve_channel(entry)
	return entry.channel or "sfx"
end

local function apply_cooldown(event_name, action, payload)
	local cooldown_ms = action.cooldown_ms
	if not cooldown_ms or cooldown_ms <= 0 then
		return true
	end
	local actor_key = payload.actorId or "global"
	local key = event_name .. ":" .. actor_key .. ":" .. tostring(action.audio_id)
	local now = now_ms()
	local last = last_played_at[key] or 0
	if (now - last) < cooldown_ms then
		return false
	end
	last_played_at[key] = now
	return true
end

local action_opts = {}

local function dispatch_action(event_name, entry, action, payload)
	if action.music_transition then
		log_router("action music_transition event=" .. tostring(event_name) .. " audio=" .. tostring(action.music_transition.audio_id))
		music(action.music_transition.audio_id, action.music_transition)
		return
	end
	if not action.audio_id then
		error("audio_router action missing audio_id")
	end
	if not apply_cooldown(event_name, action, payload) then
		log_router("action skipped cooldown event=" .. tostring(event_name) .. " audio=" .. tostring(action.audio_id))
		return
	end
	action_opts.modulation_preset = nil
	action_opts.modulation_params = nil
	action_opts.priority = nil
	action_opts.policy = nil
	action_opts.max_voices = nil
	action_opts.channel = nil
	action_opts.modulation_preset = action.modulation_preset
	action_opts.modulation_params = action.modulation_params
	action_opts.priority = action.priority
	action_opts.policy = entry.policy
	action_opts.max_voices = entry.max_voices
	action_opts.channel = entry.channel
	local channel = resolve_channel(entry)
	log_router("action event=" .. tostring(event_name) .. " channel=" .. channel .. " audio=" .. tostring(action.audio_id))
	if channel == "music" then
		music(action.audio_id, action_opts)
	else
		sfx(action.audio_id, action_opts)
	end
end

handle_event = function(event_name, entry, payload)
	log_router(
		"event " .. tostring(event_name) .. " emitter=" .. format_entity(payload.emitter) .. " actor=" .. format_entity(payload.actorId or payload.actor)
			.. " tags=" .. format_tags(payload.tags) .. format_event_details(event_name, payload)
	)
	local rules = entry.rules
	for i = 1, #rules do
		local rule = rules[i]
		if rule.__predicate(payload) then
			log_router("rule " .. tostring(i) .. " matched for event " .. tostring(event_name))
			local action = resolve_action_spec(event_name, i, rule, payload)
			if action then
				dispatch_action(event_name, entry, action, payload)
				return
			end
		end
	end
	log_router("no rule matched for event " .. tostring(event_name))
end

local function bind_events()
	local audioevents = assets.audioevents
	if audioevents == nil then
		log_bind_status("assets.audioevents is nil")
		return false
	end
	if next(audioevents) == nil then
		log_bind_status("assets.audioevents is empty")
		return false
	end
	local merged = merge_events(audioevents)
	if next(merged) == nil then
		log_bind_status("merged audioevents is empty")
		return false
	end
	router._events = merged
	log_bind_status(
		"bound " .. tostring(count_entries(merged)) .. " events from " .. tostring(count_entries(audioevents)) .. " assets"
			.. " instance=" .. tostring(eventemitter.instance._debug_id)
	)
	for event_name, entry in pairs(merged) do
		local bound_name = event_name
		log_router("bind event " .. tostring(bound_name))
		eventemitter.instance:on({
			event_name = bound_name,
			handler = function(payload)
				local actual_name = payload.type
				local current_entry = router._events[actual_name]
				log_router("dispatch event=" .. tostring(actual_name) .. " entry=" .. tostring(current_entry))
				handle_event(actual_name, current_entry, payload)
			end,
			subscriber = router,
		})
	end
	router._bound = true
	if router._any_handler then
		eventemitter.instance:off_any(router._any_handler, true)
		router._any_handler = nil
	end
	return true
end

function router.try_bind()
	if router._bound then
		return true
	end
	if not bind_events() then
		return false
	end
	flush_pending()
	return true
end

function router.tick()
	router.try_bind()
end

function router.init()
	if router._inited then
		return
	end
	router._inited = true
	log_router("init")
	if router.try_bind() then
		return
	end
	router._any_handler = function(event)
		if not router._bound then
			log_router("queued event before bind: " .. tostring(event.type))
			stash_event(event)
			router.try_bind()
		end
	end
	eventemitter.instance:on_any(router._any_handler)
end

return router
