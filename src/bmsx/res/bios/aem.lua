-- aem.lua
-- BIOS Audio Event Map dispatcher. AEM rules decide what to play; APU writes live in apu.lua.

local apu<const> = require('apu')
local eventemitter<const> = require('eventemitter').eventemitter
local compile_matcher<const> = require('event_matcher').compile

local global_actor_key<const> = false
local slot_sfx<const> = 0
local slot_music_a<const> = 1
local slot_music_b<const> = 2
local slot_ui<const> = 3
local route_slot<const> = {
	sfx = slot_sfx,
	music = slot_music_a,
	ui = slot_ui,
}

local events
local music_request_seq
local current_music_source_addr
local current_music_slot
local pending_music_seq
local pending_music_asset
local pending_music_transition
local stinger_seq
local stinger_source_addr
local stinger_slot
local stinger_music_asset
local stinger_music_transition
local slot_active_source_addr
local slot_active_priority
local slot_play_queue
local slot_queue_head
local slot_queue_tail

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
	action.__aem_priority = action.priority
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
	transition.__apu_fade_samples = apu.ms_to_samples(transition.fade_ms or 0)
	transition.__apu_crossfade_samples = apu.ms_to_samples(transition.crossfade_ms or 0)
	transition.__apu_wait_for_current = transition.sync == 'loop'
	transition.__apu_start_at_loop = transition.start_at_loop_start or false
	transition.__apu_start_fresh = transition.start_fresh or false
end

local compile_action<const> = function(action)
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
		local slot<const> = route_slot[entry.channel]
		if slot == nil then
			error('aem invalid APU route: ' .. tostring(entry.channel))
		end
		entry.__slot = slot
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

local reset_slot_state<const> = function()
	slot_active_source_addr = {
		[slot_sfx] = 0,
		[slot_music_a] = 0,
		[slot_music_b] = 0,
		[slot_ui] = 0,
	}
	slot_active_priority = {
		[slot_sfx] = 0,
		[slot_music_a] = 0,
		[slot_music_b] = 0,
		[slot_ui] = 0,
	}
	slot_play_queue = {
		[slot_sfx] = {},
		[slot_music_a] = {},
		[slot_music_b] = {},
		[slot_ui] = {},
	}
	slot_queue_head = {
		[slot_sfx] = 1,
		[slot_music_a] = 1,
		[slot_music_b] = 1,
		[slot_ui] = 1,
	}
	slot_queue_tail = {
		[slot_sfx] = 0,
		[slot_music_a] = 0,
		[slot_music_b] = 0,
		[slot_ui] = 0,
	}
end

local has_queued_play<const> = function(slot)
	return slot_queue_head[slot] <= slot_queue_tail[slot]
end

local clear_slot_queue<const> = function(slot)
	local queue<const> = slot_play_queue[slot]
	for i = slot_queue_head[slot], slot_queue_tail[slot] do
		queue[i] = nil
	end
	slot_queue_head[slot] = 1
	slot_queue_tail[slot] = 0
end

local slot_is_busy<const> = function(slot)
	return slot_active_source_addr[slot] ~= 0
end

local mark_slot_active<const> = function(slot, source_addr, priority)
	slot_active_source_addr[slot] = source_addr
	slot_active_priority[slot] = priority
end

local slot_source_matches<const> = function(slot, source_addr)
	return slot_active_source_addr[slot] == source_addr
end

local enqueue_prepared_play<const> = function(play)
	local slot<const> = play.slot
	local tail<const> = slot_queue_tail[slot] + 1
	slot_queue_tail[slot] = tail
	slot_play_queue[slot][tail] = play
end

local dequeue_prepared_play<const> = function(slot)
	if not has_queued_play(slot) then
		return nil
	end
	local head<const> = slot_queue_head[slot]
	local queue<const> = slot_play_queue[slot]
	local play<const> = queue[head]
	queue[head] = nil
	if head == slot_queue_tail[slot] then
		slot_queue_head[slot] = 1
		slot_queue_tail[slot] = 0
	else
		slot_queue_head[slot] = head + 1
	end
	return play
end

local run_prepared_play<const> = function(play)
	mark_slot_active(play.slot, play.source.source_addr, play.priority)
	apu.play(
		play.source,
		play.slot,
		play.rate_step_q16,
		play.gain_q12,
		play.start_sample,
		play.filter_kind,
		play.filter_freq_hz,
		play.filter_q_milli,
		play.filter_gain_millidb
	)
end

local play_next_queued<const> = function(slot)
	local play<const> = dequeue_prepared_play(slot)
	if play ~= nil then
		run_prepared_play(play)
	end
end

local complete_slot_play<const> = function(slot, source_addr, drain_queue)
	if not slot_source_matches(slot, source_addr) then
		return false
	end
	slot_active_source_addr[slot] = 0
	slot_active_priority[slot] = 0
	if drain_queue then
		play_next_queued(slot)
	end
	return true
end

local submit_prepared_play<const> = function(play, queued)
	if queued then
		if slot_is_busy(play.slot) or has_queued_play(play.slot) then
			enqueue_prepared_play(play)
			return
		end
	else
		if slot_is_busy(play.slot) and play.priority < slot_active_priority[play.slot] then
			return
		end
		clear_slot_queue(play.slot)
	end
	run_prepared_play(play)
end

local prepare_plain_play<const> = function(asset, slot)
	return {
		source = apu.source(asset),
		slot = slot,
		priority = asset.audiometa.priority,
		rate_step_q16 = apu_rate_step_q16_one,
		gain_q12 = apu_gain_q12_one,
		start_sample = 0,
		filter_kind = apu_filter_none,
		filter_freq_hz = 0,
		filter_q_milli = 1000,
		filter_gain_millidb = 0,
	}
end

local prepare_action_play<const> = function(asset, slot, action)
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

	return {
		source = apu.source(asset),
		slot = slot,
		priority = action.__aem_priority or asset.audiometa.priority,
		rate_step_q16 = rate_step_q16,
		gain_q12 = gain_q12,
		start_sample = start_sample,
		filter_kind = action.__apu_filter_kind,
		filter_freq_hz = action.__apu_filter_freq_hz,
		filter_q_milli = action.__apu_filter_q_milli,
		filter_gain_millidb = action.__apu_filter_gain_millidb,
	}
end

local transition_start_sample<const> = function(asset, transition)
	if transition.__apu_start_at_loop then
		return apu.loop_start_sample(asset)
	end
	return 0
end

local alternate_music_slot<const> = function()
	if current_music_slot == slot_music_a then
		return slot_music_b
	end
	return slot_music_a
end

local clear_pending_music<const> = function()
	pending_music_seq = 0
	pending_music_asset = nil
	pending_music_transition = nil
end

local clear_stinger<const> = function()
	stinger_seq = 0
	stinger_source_addr = 0
	stinger_slot = 0
	stinger_music_asset = nil
	stinger_music_transition = nil
end

local begin_music_request<const> = function()
	music_request_seq = music_request_seq + 1
	if stinger_source_addr ~= 0 then
		apu.stop_slot(stinger_slot, 0)
	end
	clear_slot_queue(slot_music_a)
	clear_slot_queue(slot_music_b)
	clear_stinger()
	clear_pending_music()
	return music_request_seq
end

local play_music_now<const> = function(asset, transition, gain_q12, slot)
	local target_slot = slot or current_music_slot
	if target_slot == 0 then
		target_slot = slot_music_a
	end
	local source<const> = apu.source(asset)
	current_music_source_addr = source.source_addr
	current_music_slot = target_slot
	mark_slot_active(target_slot, source.source_addr, asset.audiometa.priority)
	apu.play(source, target_slot, apu_rate_step_q16_one, gain_q12 or apu_gain_q12_one, transition_start_sample(asset, transition), apu_filter_none, 0, 1000, 0)
end

local queue_music_after_current<const> = function(request_seq, asset, transition)
	pending_music_seq = request_seq
	pending_music_asset = asset
	pending_music_transition = transition
end

local play_transition_apu<const> = function(asset, transition)
	if transition.__apu_wait_for_current and current_music_source_addr ~= 0 then
		queue_music_after_current(music_request_seq, asset, transition)
		return
	end

	local crossfade_samples<const> = transition.__apu_crossfade_samples
	if crossfade_samples > 0 and current_music_source_addr ~= 0 then
		local old_slot<const> = current_music_slot
		local new_slot<const> = alternate_music_slot()
		play_music_now(asset, transition, 0, new_slot)
		apu.ramp_slot(new_slot, apu_gain_q12_one, crossfade_samples)
		apu.stop_slot(old_slot, crossfade_samples)
		return
	end

	local fade_samples<const> = transition.__apu_fade_samples
	if fade_samples > 0 and current_music_source_addr ~= 0 then
		queue_music_after_current(music_request_seq, asset, transition)
		apu.stop_slot(current_music_slot, fade_samples)
		return
	end

	if current_music_source_addr ~= 0 then
		apu.stop_slot(current_music_slot, 0)
	end
	play_music_now(asset, transition)
end

local transition_target_asset<const> = function(transition, sync)
	local target_id = transition.audio_id
	if sync ~= nil and type(sync) ~= 'string' and sync.return_to ~= nil then
		target_id = sync.return_to
	end
	if target_id == nil then
		error('aem music_transition missing audio_id target')
	end
	return assets.audio[target_id]
end

local dispatch_music_transition<const> = function(transition)
	local request_seq<const> = begin_music_request()
	local sync<const> = transition.sync
	local target_asset<const> = transition_target_asset(transition, sync)
	if sync == nil or type(sync) == 'string' then
		if not transition.__apu_start_fresh and current_music_source_addr == apu.source(target_asset).source_addr then
			return
		end
	end
	if sync ~= nil and type(sync) ~= 'string' then
		local stinger_id<const> = sync.stinger
		local stinger_asset<const> = assets.audio[stinger_id]
		local stinger_type<const> = stinger_asset.audiometa.audiotype
		if current_music_source_addr ~= 0 then
			apu.stop_slot(current_music_slot, 0)
		end
		current_music_source_addr = 0
		current_music_slot = 0
		stinger_seq = request_seq
		local stinger_source<const> = apu.source(stinger_asset)
		stinger_source_addr = stinger_source.source_addr
		stinger_slot = route_slot[stinger_type]
		if stinger_slot == nil then
			error('aem invalid stinger audio asset type: ' .. tostring(stinger_type))
		end
		stinger_music_asset = target_asset
		stinger_music_transition = transition
		mark_slot_active(stinger_slot, stinger_source_addr, stinger_asset.audiometa.priority)
		apu.play_plain(stinger_source, stinger_slot)
		return
	end
	play_transition_apu(target_asset, transition)
end

local dispatch_audio_play<const> = function(entry, asset, action, payload)
	if not apply_cooldown(action, payload) then
		return
	end
	submit_prepared_play(prepare_action_play(asset, entry.__slot, action), entry.__queued)
end

local dispatch_action<const> = function(entry, action, payload)
	if type(action) == 'string' then
		submit_prepared_play(prepare_plain_play(assets.audio[action], entry.__slot), entry.__queued)
		return
	end
	if action.stop_music then
		begin_music_request()
		current_music_source_addr = 0
		current_music_slot = 0
		local fade_samples<const> = type(action.stop_music) == 'boolean' and 0 or apu.ms_to_samples(action.stop_music.fade_ms or 0)
		apu.stop_slot(slot_music_a, fade_samples)
		apu.stop_slot(slot_music_b, fade_samples)
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
	dispatch_audio_play(entry, assets.audio[action.audio_id], action, payload)
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
	current_music_source_addr = 0
	current_music_slot = 0
	reset_slot_state()
	clear_pending_music()
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
	local kind<const> = mem[sys_apu_event_kind]
	local slot<const> = mem[sys_apu_event_slot]
	local source_addr<const> = mem[sys_apu_event_source_addr]

	if kind ~= apu_event_slot_ended then
		return
	end

	if stinger_source_addr == source_addr
		and stinger_slot == slot
		and stinger_seq == music_request_seq then
		local target_asset<const> = stinger_music_asset
		local transition<const> = stinger_music_transition
		complete_slot_play(slot, source_addr, slot ~= current_music_slot)
		clear_stinger()
		play_transition_apu(target_asset, transition)
		return
	end

	if slot ~= current_music_slot then
		complete_slot_play(slot, source_addr, true)
		return
	end

	if current_music_source_addr ~= source_addr then
		complete_slot_play(slot, source_addr, true)
		return
	end

	complete_slot_play(slot, source_addr, false)
	current_music_source_addr = 0
	current_music_slot = 0
	if pending_music_seq == music_request_seq and pending_music_asset ~= nil then
		local target_asset<const> = pending_music_asset
		local transition<const> = pending_music_transition
		clear_pending_music()
		play_music_now(target_asset, transition)
		return
	end
	play_next_queued(slot)
end

return {
	reload = reload,
	on_apu_irq = on_apu_irq,
}
