-- aem.lua
-- BIOS Audio Event Map dispatcher. AEM rules decide what to play; APU writes live in apu.lua.

local apu<const> = require('apu')
local eventemitter<const> = require('eventemitter').eventemitter
local compile_matcher<const> = require('event_matcher').compile

local global_actor_key<const> = false

local events
local music_request_seq
local stinger_seq
local stinger_handle
local stinger_channel
local stinger_music_handle
local stinger_music_transition

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

local compile_apu_defaults<const> = function(action)
	action.__apu_priority = action.priority or apu_priority_auto
	action.__apu_pitch_delta = 0
	action.__apu_pitch_range_min = 0
	action.__apu_pitch_range_span = 0
	action.__apu_volume_delta = 0
	action.__apu_volume_range_min = 0
	action.__apu_volume_range_span = 0
	action.__apu_start_sample = 0
	action.__apu_start_range_min = 0
	action.__apu_start_range_span = 0
	action.__apu_rate = 1
	action.__apu_rate_range_min = 0
	action.__apu_rate_range_span = 0
	action.__apu_filter_kind = apu_filter_none
	action.__apu_filter_freq_hz = 0
	action.__apu_filter_q_milli = 1000
	action.__apu_filter_gain_millidb = 0
end

local compile_modulation<const> = function(action, params)
	action.__apu_pitch_delta = params['pitchDelta'] or 0
	local pitch_range<const> = params['pitchRange']
	if pitch_range ~= nil then
		action.__apu_pitch_range_min = pitch_range[1]
		action.__apu_pitch_range_span = pitch_range[2] - pitch_range[1]
	end

	action.__apu_volume_delta = params['volumeDelta'] or 0
	local volume_range<const> = params['volumeRange']
	if volume_range ~= nil then
		action.__apu_volume_range_min = volume_range[1]
		action.__apu_volume_range_span = volume_range[2] - volume_range[1]
	end

	action.__apu_start_sample = (params.offset or 0) * apu_sample_rate_hz
	local offset_range<const> = params['offsetRange']
	if offset_range ~= nil then
		action.__apu_start_range_min = offset_range[1] * apu_sample_rate_hz
		action.__apu_start_range_span = (offset_range[2] - offset_range[1]) * apu_sample_rate_hz
	end

	action.__apu_rate = params['playbackRate'] or 1
	local rate_range<const> = params['playbackRateRange']
	if rate_range ~= nil then
		action.__apu_rate_range_min = rate_range[1]
		action.__apu_rate_range_span = rate_range[2] - rate_range[1]
	end

	local filter<const> = params.filter
	if filter ~= nil then
		local filter_kind<const> = apu.filter_kind[filter.type]
		if filter_kind == nil then
			error('aem invalid filter type: ' .. tostring(filter.type))
		end
		action.__apu_filter_kind = filter_kind
		action.__apu_filter_freq_hz = filter.frequency
		action.__apu_filter_q_milli = filter.q * 1000
		action.__apu_filter_gain_millidb = filter.gain * 1000
	end
end

local compile_transition<const> = function(transition)
	transition.__apu_fade_samples = (transition.fade_ms or 0) * apu_sample_rate_hz / 1000
	transition.__apu_crossfade_samples = (transition.crossfade_ms or 0) * apu_sample_rate_hz / 1000
	transition.__apu_sync_loop = transition.sync == 'loop' and 1 or 0
	transition.__apu_start_at_loop = transition.start_at_loop_start and 1 or 0
	transition.__apu_start_fresh = transition.start_fresh and 1 or 0
end

local compile_action
compile_action = function(action)
	if action.audio_id ~= nil or action.modulation_params ~= nil or action.modulation_preset ~= nil then
		compile_apu_defaults(action)
		if action.modulation_params ~= nil then
			compile_modulation(action, action.modulation_params)
		elseif action.modulation_preset ~= nil then
			compile_modulation(action, resolve_data_path(action.modulation_preset))
		end
	end
	if action.music_transition ~= nil then
		compile_transition(action.music_transition)
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
		if type(spec) ~= 'string' and spec.one_of ~= nil then
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
		elseif type(spec) ~= 'string' then
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
	if type(spec) == 'string' or spec.one_of == nil then
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
		local channel<const> = apu.channel[entry.channel]
		if channel == nil then
			error('aem invalid APU channel: ' .. tostring(entry.channel))
		end
		entry.__channel = channel
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
					if type(entry) ~= 'string' and entry.rules ~= nil then
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

local play_action_apu<const> = function(handle, channel, action, cmd)
	local pitch_delta = action.__apu_pitch_delta
	local pitch_range_span<const> = action.__apu_pitch_range_span
	if pitch_range_span ~= 0 then
		pitch_delta = pitch_delta + action.__apu_pitch_range_min + (pitch_range_span * math.random())
	end

	local volume_delta = action.__apu_volume_delta
	local volume_range_span<const> = action.__apu_volume_range_span
	if volume_range_span ~= 0 then
		volume_delta = volume_delta + action.__apu_volume_range_min + (volume_range_span * math.random())
	end
	local gain_q12<const> = (10 ^ (volume_delta / 20)) * apu_gain_q12_one

	local start_sample = action.__apu_start_sample
	local start_range_span<const> = action.__apu_start_range_span
	if start_range_span ~= 0 then
		start_sample = start_sample + action.__apu_start_range_min + (start_range_span * math.random())
	end

	local rate = action.__apu_rate
	local rate_range_span<const> = action.__apu_rate_range_span
	if rate_range_span ~= 0 then
		rate = rate + action.__apu_rate_range_min + (rate_range_span * math.random())
	end
	local rate_step_q16<const> = rate * (2 ^ (pitch_delta / 12)) * apu_rate_step_q16_one

	memwrite(
		sys_apu_handle,
		handle,
		channel,
		action.__apu_priority,
		rate_step_q16,
		gain_q12,
		start_sample,
		action.__apu_filter_kind,
		action.__apu_filter_freq_hz,
		action.__apu_filter_q_milli,
		action.__apu_filter_gain_millidb,
		0,
		0,
		0,
		0,
		0,
		cmd
	)
end

local play_transition_apu<const> = function(handle, transition)
	memwrite(
		sys_apu_handle,
		handle,
		apu_channel_music,
		apu_priority_auto,
		apu_rate_step_q16_one,
		apu_gain_q12_one,
		0,
		apu_filter_none,
		0,
		1000,
		0,
		transition.__apu_fade_samples,
		transition.__apu_crossfade_samples,
		transition.__apu_sync_loop,
		transition.__apu_start_at_loop,
		transition.__apu_start_fresh,
		apu_cmd_play
	)
end

local play_plain_apu<const> = function(handle, channel, cmd)
	memwrite(
		sys_apu_handle,
		handle,
		channel,
		apu_priority_auto,
		apu_rate_step_q16_one,
		apu_gain_q12_one,
		0,
		apu_filter_none,
		0,
		1000,
		0,
		0,
		0,
		0,
		0,
		0,
		cmd
	)
end

local clear_stinger<const> = function()
	stinger_seq = 0
	stinger_handle = 0
	stinger_channel = 0
	stinger_music_handle = 0
	stinger_music_transition = nil
end

local begin_music_request<const> = function()
	music_request_seq = music_request_seq + 1
	clear_stinger()
	return music_request_seq
end

local dispatch_music_transition<const> = function(transition)
	local request_seq<const> = begin_music_request()
	local sync<const> = transition.sync
	if sync ~= nil and type(sync) ~= 'string' then
		local target_handle
		if sync.return_to ~= nil then
			target_handle = assets.audio[sync.return_to].handle
		else
			target_handle = assets.audio[transition.audio_id].handle
		end
		local stinger_id<const> = sync.stinger
		local stinger_type<const> = assets.audio[stinger_id].audiometa.audiotype
		apu.stop_channel(apu_channel_music, 0)
		stinger_seq = request_seq
		stinger_handle = assets.audio[stinger_id].handle
		stinger_channel = apu.channel[stinger_type]
		if stinger_channel == nil then
			error('aem invalid stinger audio asset type: ' .. tostring(stinger_type))
		end
		stinger_music_handle = target_handle
		stinger_music_transition = transition
		play_plain_apu(stinger_handle, stinger_channel, apu_cmd_play)
		return
	end
	play_transition_apu(assets.audio[transition.audio_id].handle, transition)
end

local dispatch_audio_play<const> = function(entry, handle, action, payload)
	if not apply_cooldown(action, payload) then
		return
	end
	play_action_apu(handle, entry.__channel, action, entry.__queued and apu_cmd_queue_play or apu_cmd_play)
end

local dispatch_action<const> = function(entry, action, payload)
	if type(action) == 'string' then
		play_plain_apu(assets.audio[action].handle, entry.__channel, entry.__queued and apu_cmd_queue_play or apu_cmd_play)
		return
	end
	if action.stop_music then
		local fade_samples<const> = type(action.stop_music) == 'boolean' and 0 or ((action.stop_music.fade_ms or 0) * apu_sample_rate_hz / 1000)
		apu.stop_channel(apu_channel_music, fade_samples)
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
	clear_stinger()
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
	if stinger_handle == handle
		and stinger_channel == channel
		and stinger_seq == music_request_seq then
		play_transition_apu(stinger_music_handle, stinger_music_transition)
		clear_stinger()
	end
end

return {
	reload = reload,
	on_apu_irq = on_apu_irq,
}
