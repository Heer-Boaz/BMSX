-- audio_router.lua
-- BIOS AEM dispatcher: gameplay events become concrete APU MMIO writes.

local eventemitter<const> = require('eventemitter').eventemitter
local compile_matcher<const> = require('event_matcher').compile

local table_like_types<const> = { ['table'] = true, ['native'] = true }
local global_actor_key<const> = false

local events
local music_request_seq
local pending_stinger_seq
local pending_stinger_handle
local pending_stinger_channel
local pending_music_handle
local pending_music_transition

local apu_queue_handle_by_channel<const> = { [apu_channel_sfx] = {}, [apu_channel_music] = {}, [apu_channel_ui] = {} }
local apu_queue_action_by_channel<const> = { [apu_channel_sfx] = {}, [apu_channel_music] = {}, [apu_channel_ui] = {} }
local apu_queue_first_by_channel<const> = { [apu_channel_sfx] = 1, [apu_channel_music] = 1, [apu_channel_ui] = 1 }
local apu_queue_count_by_channel<const> = { [apu_channel_sfx] = 0, [apu_channel_music] = 0, [apu_channel_ui] = 0 }
local apu_queue_active_handle<const> = { [apu_channel_sfx] = 0, [apu_channel_music] = 0, [apu_channel_ui] = 0 }

local channel_by_name<const> = {
	sfx = apu_channel_sfx,
	music = apu_channel_music,
	ui = apu_channel_ui,
}

local channel_by_audio_type<const> = {
	sfx = apu_channel_sfx,
	music = apu_channel_music,
	ui = apu_channel_ui,
}

local filter_kind_by_type<const> = {
	lowpass = apu_filter_lowpass,
	highpass = apu_filter_highpass,
	bandpass = apu_filter_bandpass,
	notch = apu_filter_notch,
	allpass = apu_filter_allpass,
	peaking = apu_filter_peaking,
	lowshelf = apu_filter_lowshelf,
	highshelf = apu_filter_highshelf,
}

local resolve_audio_asset_channel<const> = function(audio_id)
	local audio_type<const> = assets.audio[audio_id].audiometa.audiotype
	return channel_by_audio_type[audio_type]
end

local resolve_data_path<const> = function(path)
	local dot = string.find(path, '.', 1, true)
	if not dot then
		return assets.data[path]
	end
	local cursor = assets.data[string.sub(path, 1, dot - 1)]
	local start = dot + 1
	while true do
		dot = string.find(path, '.', start, true)
		local key
		if dot then
			key = string.sub(path, start, dot - 1)
		else
			key = string.sub(path, start)
		end
		cursor = cursor[key]
		if not dot then
			return cursor
		end
		start = dot + 1
	end
end

local compile_action
compile_action = function(action)
	if action.modulation_params ~= nil then
		action.__modulation_params = action.modulation_params
	elseif action.modulation_preset ~= nil then
		action.__modulation_params = resolve_data_path(action.modulation_preset)
	end
	if action.cooldown_ms ~= nil and action.cooldown_ms > 0 then
		action.__cooldown_by_actor = {}
	end
	local seq<const> = action.sequence
	if seq ~= nil then
		for i = 1, #seq do
			local item<const> = seq[i]
			if type(item) ~= 'string' then
				compile_action(item)
			end
		end
	end
end

local compile_rules<const> = function(rules)
	local compiled<const> = {}
	for i = 1, #rules do
		local rule<const> = rules[i]
		local compiled_rule<const> = {}
		for key, value in pairs(rule) do
			compiled_rule[key] = value
		end
		compiled_rule.__predicate = compile_matcher(rule.when)
		local spec<const> = rule.go
		if table_like_types[type(spec)] and spec.one_of ~= nil then
			local actions<const> = {}
			local weights<const> = {}
			local has_weights
			local one_of<const> = spec.one_of
			for j = 1, #one_of do
				local item<const> = one_of[j]
				if type(item) == 'string' then
					actions[#actions + 1] = item
					weights[#weights + 1] = 1
				else
					compile_action(item)
					actions[#actions + 1] = item
					local weight<const> = item.weight or 1
					if weight ~= 1 then
						has_weights = true
					end
					weights[#weights + 1] = weight
				end
			end
			compiled_rule.__oneof_actions = actions
			compiled_rule.__oneof_weights = weights
			compiled_rule.__oneof_has_weights = has_weights
			if spec.avoid_repeat then
				compiled_rule.__last_random_pick_by_actor = {}
			end
		elseif table_like_types[type(spec)] then
			compile_action(spec)
		end
		compiled[#compiled + 1] = compiled_rule
	end
	return compiled
end

local pick_uniform_index<const> = function(count, avoid_index)
	if count <= 1 then
		return 1
	end
	local idx = math.random(count)
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
		local weight<const> = (avoid_index and avoid_index == i) and 0 or weights[i]
		if weight > 0 then
			total = total + weight
		end
	end
	if total <= 0 then
		return pick_uniform_index(count, avoid_index)
	end
	local r = math.random() * total
	for i = 1, count do
		local weight<const> = (avoid_index and avoid_index == i) and 0 or weights[i]
		if weight > 0 then
			r = r - weight
			if r <= 0 then
				return i
			end
		end
	end
	return count
end

local resolve_action_spec<const> = function(rule, payload)
	local spec<const> = rule.go
	if not table_like_types[type(spec)] or spec.one_of == nil then
		return spec
	end
	local actions<const> = rule.__oneof_actions
	local pick_mode = spec.pick
	if not pick_mode then
		pick_mode = rule.__oneof_has_weights and 'weighted' or 'uniform'
	end
	local by_actor<const> = rule.__last_random_pick_by_actor
	local actor_key<const> = payload['actorId'] or global_actor_key
	local avoid<const> = by_actor and by_actor[actor_key]
	local idx
	if pick_mode == 'weighted' then
		idx = pick_weighted_index(rule.__oneof_weights, avoid)
	else
		idx = pick_uniform_index(#actions, avoid)
	end
	if by_actor then
		by_actor[actor_key] = idx
	end
	return actions[idx]
end

local merge_events<const> = function(map)
	local merged<const> = {}

	local add_or_merge<const> = function(event_name, entry)
		entry.__channel = channel_by_name[entry.channel]
		entry.__queued = entry.policy == 'queue'
		local compiled_rules<const> = compile_rules(entry.rules)
		local cur<const> = merged[event_name]
		if not cur then
			entry.name = event_name
			entry.rules = compiled_rules
			merged[event_name] = entry
			return
		end
		for k, v in pairs(entry) do
			if k ~= 'rules' then
				cur[k] = v
			end
		end
		cur.name = event_name
		local old_count<const> = #cur.rules
		local new_count<const> = #compiled_rules
		for i = old_count, 1, -1 do
			cur.rules[i + new_count] = cur.rules[i]
		end
		for i = 1, new_count do
			cur.rules[i] = compiled_rules[i]
		end
	end

	for asset_id, value in pairs(map) do
		local asset_events<const> = value.events
		if asset_events ~= nil then
			for event_name, entry in pairs(asset_events) do
				add_or_merge(event_name, entry)
			end
		else
			local found_direct
			for key, entry in pairs(value) do
				if key ~= '$type' and key ~= 'events' and key ~= 'name' and key ~= 'channel' and key ~= 'policy' and key ~= 'rules' then
					if table_like_types[type(entry)] and entry.rules ~= nil then
						found_direct = true
						add_or_merge(key, entry)
					end
				end
			end
			if not found_direct and value.rules ~= nil then
				add_or_merge(value.name, value)
			end
		end
	end

	return merged
end

local apply_cooldown<const> = function(action, payload)
	local by_actor<const> = action and action.__cooldown_by_actor
	if not by_actor then
		return true
	end
	local cooldown_ms<const> = action.cooldown_ms
	local actor_key<const> = payload['actorId'] or global_actor_key
	local now<const> = os.clock() * 1000
	local last<const> = by_actor[actor_key] or 0
	if (now - last) < cooldown_ms then
		return false
	end
	by_actor[actor_key] = now
	return true
end

local write_apu_play<const> = function(handle, channel, action, transition)
	local priority = apu_priority_auto
	local pitch_cents = 0
	local volume_millidb = 0
	local offset_ms = 0
	local rate_permil = 1000
	local filter_kind = apu_filter_none
	local filter_freq_hz = 0
	local filter_q_milli = 1000
	local filter_gain_millidb = 0
	local fade_ms = 0
	local crossfade_ms = 0
	local sync_kind = apu_sync_immediate
	local start_at_loop = 0
	local start_fresh = 0

	if action ~= nil then
		if action.priority ~= nil then
			priority = action.priority
		end
		local params<const> = action.__modulation_params
		if params ~= nil then
			local pitch_delta = params['pitchDelta'] or 0
			local pitch_range<const> = params['pitchRange']
			if pitch_range ~= nil then
				pitch_delta = pitch_delta + pitch_range[1] + ((pitch_range[2] - pitch_range[1]) * math.random())
			end
			pitch_cents = pitch_delta * 100

			local volume_delta = params['volumeDelta'] or 0
			local volume_range<const> = params['volumeRange']
			if volume_range ~= nil then
				volume_delta = volume_delta + volume_range[1] + ((volume_range[2] - volume_range[1]) * math.random())
			end
			volume_millidb = volume_delta * 1000

			local offset = params.offset or 0
			local offset_range<const> = params['offsetRange']
			if offset_range ~= nil then
				offset = offset + offset_range[1] + ((offset_range[2] - offset_range[1]) * math.random())
			end
			offset_ms = offset * 1000

			local rate = params['playbackRate'] or 1
			local rate_range<const> = params['playbackRateRange']
			if rate_range ~= nil then
				rate = rate + rate_range[1] + ((rate_range[2] - rate_range[1]) * math.random())
			end
			rate_permil = rate * 1000

			local filter<const> = params.filter
			if filter ~= nil then
				filter_kind = filter_kind_by_type[filter.type]
				filter_freq_hz = filter.frequency
				filter_q_milli = filter.q * 1000
				filter_gain_millidb = filter.gain * 1000
			end
		end
	end

	if transition ~= nil then
		fade_ms = transition.fade_ms or 0
		crossfade_ms = transition.crossfade_ms or 0
		local sync<const> = transition.sync
		if sync == 'loop' then
			sync_kind = apu_sync_loop
		end
		if transition.start_at_loop_start then
			start_at_loop = 1
		end
		if transition.start_fresh then
			start_fresh = 1
		end
	end

	mem[sys_apu_handle] = handle
	mem[sys_apu_channel] = channel
	mem[sys_apu_priority] = priority
	mem[sys_apu_pitch_cents] = pitch_cents
	mem[sys_apu_volume_millidb] = volume_millidb
	mem[sys_apu_offset_ms] = offset_ms
	mem[sys_apu_rate_permil] = rate_permil
	mem[sys_apu_filter_kind] = filter_kind
	mem[sys_apu_filter_freq_hz] = filter_freq_hz
	mem[sys_apu_filter_q_milli] = filter_q_milli
	mem[sys_apu_filter_gain_millidb] = filter_gain_millidb
	mem[sys_apu_fade_ms] = fade_ms
	mem[sys_apu_crossfade_ms] = crossfade_ms
	mem[sys_apu_sync] = sync_kind
	mem[sys_apu_start_at_loop] = start_at_loop
	mem[sys_apu_start_fresh] = start_fresh
	mem[sys_apu_cmd] = apu_cmd_play
end

local enqueue_apu_play<const> = function(channel, handle, action)
	local handles<const> = apu_queue_handle_by_channel[channel]
	local actions<const> = apu_queue_action_by_channel[channel]
	local count<const> = apu_queue_count_by_channel[channel]
	local index<const> = apu_queue_first_by_channel[channel] + count
	handles[index] = handle
	actions[index] = action
	apu_queue_count_by_channel[channel] = count + 1
end

local clear_channel_queue<const> = function(channel)
	local count<const> = apu_queue_count_by_channel[channel]
	if count > 0 then
		local handles<const> = apu_queue_handle_by_channel[channel]
		local actions<const> = apu_queue_action_by_channel[channel]
		local first<const> = apu_queue_first_by_channel[channel]
		for index = first, first + count - 1 do
			handles[index] = nil
			actions[index] = nil
		end
	end
	apu_queue_first_by_channel[channel] = 1
	apu_queue_count_by_channel[channel] = 0
	apu_queue_active_handle[channel] = 0
end

local issue_next_queued_apu_play<const> = function(channel)
	local count<const> = apu_queue_count_by_channel[channel]
	if count == 0 then
		apu_queue_first_by_channel[channel] = 1
		apu_queue_active_handle[channel] = 0
		return
	end
	local handles<const> = apu_queue_handle_by_channel[channel]
	local actions<const> = apu_queue_action_by_channel[channel]
	local first<const> = apu_queue_first_by_channel[channel]
	local handle<const> = handles[first]
	local action<const> = actions[first]
	handles[first] = nil
	actions[first] = nil
	apu_queue_first_by_channel[channel] = first + 1
	apu_queue_count_by_channel[channel] = count - 1
	apu_queue_active_handle[channel] = handle
	write_apu_play(handle, channel, action, nil)
end

local issue_or_queue_apu_play<const> = function(handle, channel, action, queued)
	if queued then
		if apu_queue_active_handle[channel] ~= 0 then
			enqueue_apu_play(channel, handle, action)
			return
		end
		apu_queue_active_handle[channel] = handle
		write_apu_play(handle, channel, action, nil)
		return
	end
	clear_channel_queue(channel)
	write_apu_play(handle, channel, action, nil)
end

local apu_stop_channel<const> = function(channel, fade_ms)
	clear_channel_queue(channel)
	mem[sys_apu_channel] = channel
	mem[sys_apu_fade_ms] = fade_ms
	mem[sys_apu_cmd] = apu_cmd_stop_channel
end

local clear_pending_stinger<const> = function()
	pending_stinger_seq = 0
	pending_stinger_handle = 0
	pending_stinger_channel = 0
	pending_music_handle = 0
	pending_music_transition = nil
end

local begin_music_request<const> = function()
	music_request_seq = music_request_seq + 1
	clear_pending_stinger()
	return music_request_seq
end

local dispatch_music_transition<const> = function(transition)
	local request_seq<const> = begin_music_request()
	local sync<const> = transition.sync
	if table_like_types[type(sync)] then
		local target_handle
		if sync.return_to ~= nil then
			target_handle = assets.audio[sync.return_to].handle
		else
			target_handle = assets.audio[transition.audio_id].handle
		end
		local stinger<const> = sync.stinger
		apu_stop_channel(apu_channel_music, 0)
		pending_stinger_seq = request_seq
		pending_stinger_handle = assets.audio[stinger].handle
		pending_stinger_channel = resolve_audio_asset_channel(stinger)
		pending_music_handle = target_handle
		pending_music_transition = transition
		write_apu_play(pending_stinger_handle, pending_stinger_channel, nil, nil)
		return
	end
	write_apu_play(assets.audio[transition.audio_id].handle, apu_channel_music, nil, transition)
end

local dispatch_audio_play<const> = function(entry, handle, action, payload)
	if not apply_cooldown(action, payload) then
		return
	end
	issue_or_queue_apu_play(handle, entry.__channel, action, entry.__queued)
end

local dispatch_action<const> = function(entry, action, payload)
	if type(action) == 'string' then
		dispatch_audio_play(entry, assets.audio[action].handle, nil, payload)
		return
	end
	if action.stop_music then
		local fade_ms = 0
		if table_like_types[type(action.stop_music)] then
			fade_ms = action.stop_music.fade_ms or 0
		end
		apu_stop_channel(apu_channel_music, fade_ms)
		return
	end
	if action.sequence then
		local seq<const> = action.sequence
		for i = 1, #seq do
			dispatch_action(entry, seq[i], payload)
		end
		return
	end
	if action.music_transition then
		dispatch_music_transition(action.music_transition)
		return
	end
	dispatch_audio_play(entry, assets.audio[action.audio_id].handle, action, payload)
end

local handle_event<const> = function(payload)
	local event_name<const> = payload.type
	local entry<const> = events[event_name]
	local rules<const> = entry.rules
	for i = 1, #rules do
		local rule<const> = rules[i]
		if rule.__predicate(payload) then
			local action<const> = resolve_action_spec(rule, payload)
			if action then
				dispatch_action(entry, action, payload)
				return
			end
		end
	end
end

local reset_audio_state<const> = function()
	music_request_seq = 0
	clear_pending_stinger()
	clear_channel_queue(apu_channel_sfx)
	clear_channel_queue(apu_channel_music)
	clear_channel_queue(apu_channel_ui)
end

local reload<const> = function()
	eventemitter.instance:remove_subscriber(handle_event, true)
	reset_audio_state()
	events = merge_events(assets.audioevents)
	for event_name in pairs(events) do
		eventemitter.instance:on({
			event_name = event_name,
			handler = handle_event,
			subscriber = handle_event,
		})
	end
	return events
end

local on_apu_irq<const> = function()
	if mem[sys_apu_event_kind] ~= apu_event_voice_ended then
		return
	end
	local channel<const> = mem[sys_apu_event_channel]
	local handle<const> = mem[sys_apu_event_handle]
	if pending_stinger_handle == handle
		and pending_stinger_channel == channel
		and pending_stinger_seq == music_request_seq then
		write_apu_play(pending_music_handle, apu_channel_music, nil, pending_music_transition)
		clear_pending_stinger()
	end
	if apu_queue_active_handle[channel] == handle then
		issue_next_queued_apu_play(channel)
	end
end

return {
	reload = reload,
	on_apu_irq = on_apu_irq,
}
