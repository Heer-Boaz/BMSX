-- audio_router.lua
-- routes Lua events to native audio commands using audioevents assets

local eventemitter<const> = require('eventemitter').eventemitter
local compile_matcher<const> = require('event_matcher').compile

local router<const> = { _inited = false, _bound = false, _events = nil }
local last_random_pick_by_rule<const> = {}
local last_played_at<const> = {}
local mergeable_entry_types<const> = { ['table'] = true, ['native'] = true }
local handle_event

local compile_rules<const> = function(rules)
	if not rules or #rules == 0 then
		return {}
	end
	local compiled<const> = {}
	for i = 1, #rules do
		local rule<const> = rules[i]
		rule.__predicate = compile_matcher(rule.when)
		local spec<const> = rule.go
		if spec and spec.one_of then
			local actions<const> = {}
			local weights<const> = {}
			local has_weights
			for j = 1, #spec.one_of do
				local item<const> = spec.one_of[j]
				if type(item) == 'string' or type(item) == 'number' then
					actions[#actions + 1] = { audio_id = item }
					weights[#weights + 1] = 1
				else
					if not item.audio_id then
						error('audio_router one_of item missing audio_id')
					end
					actions[#actions + 1] = item
					local weight<const> = item.weight or 1
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

local pick_uniform_index<const> = function(count, avoid_index)
	if count <= 1 then
		return 1
	end
	local idx = math.floor(math.random() * count) + 1
	if avoid_index and idx == avoid_index then
		idx = (idx % count) + 1
	end
	return idx
end

local pick_weighted_index<const> = function(weights, avoid_index)
	local count<const> = #weights
	if count <= 1 then
		return 1
	end
	local total = 0
	for i = 1, count do
		local weight
		if avoid_index and avoid_index == i then
			weight = 0
		else
			weight = weights[i]
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

local resolve_action_spec<const> = function(event_name, rule_index, rule, payload)
	local spec<const> = rule.go
	if not spec or not spec.one_of then
		return spec
	end
	local actions<const> = rule.__oneof_actions
	local weights<const> = rule.__oneof_weights
	if not actions or #actions == 0 then
		return nil
	end
	local pick_mode = spec.pick
	if not pick_mode then
		if rule.__oneof_has_weights then
			pick_mode = 'weighted'
		else
			pick_mode = 'uniform'
		end
	end
	local actor_key<const> = payload['actorId'] or 'global'
	local rule_key<const> = event_name .. '#' .. rule_index .. '#' .. actor_key
	local last_index<const> = last_random_pick_by_rule[rule_key]
		local avoid<const> = spec.avoid_repeat and last_index
	local idx
	if pick_mode == 'weighted' then
		idx = pick_weighted_index(weights, avoid)
	else
		idx = pick_uniform_index(#actions, avoid)
	end
	last_random_pick_by_rule[rule_key] = idx
	return actions[idx]
end

local has_entries<const> = function(map)
	return map ~= nil and next(map) ~= nil
end

local merge_events<const> = function(map)
	local merged<const> = {}

	local add_or_merge<const> = function(event_name, entry)
		if event_name == nil then
			error('audio_router event name is missing')
		end
		local cur<const> = merged[event_name]
		local compiled_rules<const> = compile_rules(entry.rules)
		if not cur then
			local out<const> = {}
			for k, v in pairs(entry) do
				if k ~= 'rules' then
					out[k] = v
				end
			end
			out.name = event_name
			out.rules = compiled_rules
			merged[event_name] = out
			return
		end
		local out<const> = {}
		for k, v in pairs(cur) do
			if k ~= 'rules' then
				out[k] = v
			end
		end
		for k, v in pairs(entry) do
			if k ~= 'rules' then
				out[k] = v
			end
		end
		out.name = event_name
		local combined<const> = {}
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
		local value_type<const> = type(value)
		if value_type ~= 'table' and value_type ~= 'native' then
			error('audio_router asset '' .. tostring(asset_id) .. '' must be a table')
		end

		local events<const> = value.events
		if events ~= nil then
			local events_type<const> = type(events)
			if events_type ~= 'table' and events_type ~= 'native' then
				error('audio_router asset '' .. tostring(asset_id) .. '' has invalid events')
			end
			for event_name, entry in pairs(events) do
				add_or_merge(event_name, entry)
			end
		else
			local found_direct
			for key, entry in pairs(value) do
				if key ~= '$type' and key ~= 'events' and key ~= 'name' and key ~= 'channel' and key ~= 'max_voices' and key ~= 'policy' and key ~= 'rules' then
					local entry_type<const> = type(entry)
					if mergeable_entry_types[entry_type] then
						if entry.rules ~= nil then
							found_direct = true
							add_or_merge(key, entry)
						end
					end
				end
			end
			if not found_direct and value.rules ~= nil then
				local event_name<const> = value.name
				if type(event_name) ~= 'string' then
					error('audio_router event entry is missing name')
				end
				add_or_merge(event_name, value)
			end
		end
	end

	return merged
end

local apply_cooldown<const> = function(event_name, action, payload)
	local cooldown_ms<const> = action.cooldown_ms
	if not cooldown_ms or cooldown_ms <= 0 then
		return true
	end
	local actor_key<const> = payload['actorId'] or 'global'
	local key<const> = event_name .. ':' .. actor_key .. ':' .. tostring(action.audio_id)
	local now<const> = os.clock() * 1000
	local last<const> = last_played_at[key] or 0
	if (now - last) < cooldown_ms then
		return false
	end
	last_played_at[key] = now
	return true
end

local action_opts<const> = {}

local dispatch_action<const> = function(event_name, entry, action, payload)
	if action.stop_music then
		if type(action.stop_music) == 'table' or type(action.stop_music) == 'native' then
			stop_music(action.stop_music)
		else
			stop_music()
		end
		return
	end
	if action.sequence then
		local seq<const> = action.sequence
		local seq_type<const> = type(seq)
		if seq_type ~= 'table' and seq_type ~= 'native' then
			error('audio_router sequence must be a table')
		end
		for i = 1, #seq do
			local item<const> = seq[i]
			if type(item) == 'string' or type(item) == 'number' then
				dispatch_action(event_name, entry, { audio_id = item }, payload)
			else
				dispatch_action(event_name, entry, item, payload)
			end
		end
		return
	end
	if action.music_transition then
		local transition<const> = action.music_transition
		if transition.fade_ms ~= nil and transition.crossfade_ms ~= nil then
			error('audio_router music_transition cannot specify both fade_ms and crossfade_ms')
		end
		music(transition.audio_id, transition)
		return
	end
	if not action.audio_id then
		error('audio_router action missing audio_id')
	end
	if not apply_cooldown(event_name, action, payload) then
		return
	end
	action_opts.modulation_preset = action.modulation_preset
	action_opts.modulation_params = action.modulation_params
	action_opts.priority = action.priority
	action_opts.policy = entry.policy
	action_opts.max_voices = entry.max_voices
	action_opts.channel = entry.channel
	if entry.channel == 'music' then
		music(action.audio_id, action_opts)
	else
		sfx(action.audio_id, action_opts)
	end
end

handle_event = function(event_name, entry, payload)
	local rules<const> = entry.rules
	for i = 1, #rules do
		local rule<const> = rules[i]
		if rule.__predicate(payload) then
			local action<const> = resolve_action_spec(event_name, i, rule, payload)
			if action then
				dispatch_action(event_name, entry, action, payload)
				return
			end
		end
	end
end

local build_merged_events<const> = function()
	local audioevents<const> = assets.audioevents
	if not has_entries(audioevents) then
		return {}
	end
	local merged<const> = merge_events(audioevents)
	if not has_entries(merged) then
		return {}
	end
	return merged
end

local bind_events<const> = function(merged)
	router._events = merged
	for event_name in pairs(merged) do
		eventemitter.instance:on({
			event_name = event_name,
			handler = function(payload)
				handle_event(payload.type, router._events[payload.type], payload)
			end,
			subscriber = router,
		})
	end
	router._bound = true
end

function router.try_bind()
	if not router._inited then
		router.init()
	end
	return router._bound
end

function router.tick()
	-- Binding is deterministic during init; no per-tick binding attempts.
end

function router.init()
	if router._inited then
		return
	end
	router._inited = true
	local merged<const> = build_merged_events()
	bind_events(merged)
end

return router
