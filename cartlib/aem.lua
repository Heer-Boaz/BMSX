-- aem.lua
-- Cart Audio Event Map dispatcher. AEM rules decide what to play; APU writes live in apu.lua.

local apu<const> = require('cartlib/apu')
local clock<const> = require('cartlib/clock')
local event_emitter<const> = require('cartlib/event_emitter')
local compile_matcher<const> = require('cartlib/event_matcher').compile
local rom_dir<const> = require('cartlib/rom_dir')

local aem<const> = {}
local global_actor_key<const> = false
local slot_sfx<const> = 0
local slot_music_a<const> = 1
local slot_music_b<const> = 2
local slot_ui<const> = 3
local apu_event_kind<const>: *word = 0x0800017c
local apu_event_slot<const>: *word = 0x08000180
local apu_event_source_addr<const>: *word = 0x08000184
local route_slot<const> = {
	sfx = slot_sfx,
	music = slot_music_a,
	ui = slot_ui,
}

-- Request, source, slot and per-slot active-priority latches are raw words in
-- cart RAM. Tables retain authored event programs and only those prepared plays
-- that are actually queued behind an active slot; an admitted play that can
-- start now writes the APU command without constructing a transient play record.
local events
bss music_request_seq: word
bss current_music_source_addr: word
bss current_music_slot: word
bss pending_music_seq: word
local pending_music_transition
bss stinger_seq: word
bss stinger_source_addr: word
bss stinger_slot: word
local stinger_music_transition
bss slot_active_source_addr: word[4]
bss slot_active_priority: word[4]
local slot_play_queue
local slot_queue_head
local slot_queue_tail

local action_kind_play<const> = 1
local action_kind_stop_music<const> = 2
local action_kind_sequence<const> = 3
local action_kind_music_transition<const> = 4
local action_kind_random<const> = 5

local actor_key_for_payload<const> = function(payload)
	if type(payload) == 'table' then
		return payload['actorId'] or global_actor_key
	end
	return global_actor_key
end

local resolve_audio<const> = function(audio_cache, audio_id)
	local audio = audio_cache[audio_id]
	if audio ~= nil then
		return audio
	end
	local record<const> = rom_dir.audio(audio_id)
	local meta<const> = record.audiometa
	audio = {
		source = apu.source(record),
		priority = meta.priority,
		slot = route_slot[meta.audiotype],
	}
	audio_cache[audio_id] = audio
	return audio
end

local compile_modulation<const> = function(compiled, params)
	compiled.pitch_delta = params['pitchDelta'] or 0
	local pitch_range<const> = params['pitchRange']
	if pitch_range ~= nil then
		compiled.pitch_range_min = pitch_range[1]
		compiled.pitch_range_span = pitch_range[2] - pitch_range[1]
	end

	compiled.volume_delta = params['volumeDelta'] or 0
	local volume_range<const> = params['volumeRange']
	if volume_range ~= nil then
		compiled.volume_range_min = volume_range[1]
		compiled.volume_range_span = volume_range[2] - volume_range[1]
	end

	compiled.start_sample = (params.offset or 0) * 0x0000ac44
	local offset_range<const> = params['offsetRange']
	if offset_range ~= nil then
		compiled.start_range_min = offset_range[1] * 0x0000ac44
		compiled.start_range_span = (offset_range[2] - offset_range[1]) * 0x0000ac44
	end

	compiled.rate = params['playbackRate'] or 1
	local rate_range<const> = params['playbackRateRange']
	if rate_range ~= nil then
		compiled.rate_range_min = rate_range[1]
		compiled.rate_range_span = rate_range[2] - rate_range[1]
	end

	local filter_control<const> = params.filter_control
	if filter_control ~= nil then
		compiled.filter_control = filter_control
		compiled.filter_b0_b1 = params.filter_b0_b1
		compiled.filter_b2_a1 = params.filter_b2_a1
		compiled.filter_a2 = params.filter_a2
	end
end

local compile_play_action<const> = function(action, audio_cache)
	local audio<const> = resolve_audio(audio_cache, action.audio_id)
	local compiled<const> = {
		kind = action_kind_play,
		source = audio.source,
		priority = action.priority or audio.priority,
		cooldown_ms = action.cooldown_ms,
		pitch_delta = 0,
		pitch_range_min = 0,
		pitch_range_span = 0,
		volume_delta = 0,
		volume_range_min = 0,
		volume_range_span = 0,
		start_sample = 0,
		start_range_min = 0,
		start_range_span = 0,
		rate = 1,
		rate_range_min = 0,
		rate_range_span = 0,
		filter_control = 0x00000000,
		filter_b0_b1 = apu.filter_coefficient_one,
		filter_b2_a1 = 0x00000000,
		filter_a2 = 0x00000000,
	}
	if action.cooldown_ms ~= nil and action.cooldown_ms > 0 then
		compiled.cooldown_by_actor = {}
	end
	if action.modulation_params ~= nil then
		compile_modulation(compiled, action.modulation_params)
	end
	return compiled
end

local compile_music_transition<const> = function(transition, audio_cache)
	local sync<const> = transition.sync
	local target_id = transition.audio_id
	local has_stinger<const> = sync ~= nil and type(sync) ~= 'string'
	if has_stinger then
		target_id = sync.return_to or target_id
	end
	local target<const> = resolve_audio(audio_cache, target_id)
	local start_sample = 0
	if transition.start_at_loop_start then
		start_sample = target.source.loop_start_sample
	end
	local compiled<const> = {
		kind = action_kind_music_transition,
		target_source = target.source,
		target_priority = target.priority,
		start_sample = start_sample,
		fade_samples = apu.ms_to_samples(transition.fade_ms or 0),
		crossfade_samples = apu.ms_to_samples(transition.crossfade_ms or 0),
		wait_for_current = sync == 'loop',
		start_fresh = transition.start_fresh or false,
	}
	if has_stinger then
		local stinger<const> = resolve_audio(audio_cache, sync.stinger)
		compiled.stinger_source = stinger.source
		compiled.stinger_priority = stinger.priority
		compiled.stinger_slot = stinger.slot
	end
	return compiled
end

local compile_action
compile_action = function(action, audio_cache)
	if action.audio_id ~= nil then
		return compile_play_action(action, audio_cache)
	end
	if action.stop_music ~= nil then
		return {
			kind = action_kind_stop_music,
			fade_samples = apu.ms_to_samples(action.stop_music.fade_ms or 0),
		}
	end
	if action.sequence ~= nil then
		local source_actions<const> = action.sequence
		local actions<const> = {}
		for i = 1, #source_actions do
			actions[i] = compile_action(source_actions[i], audio_cache)
		end
		return {
			kind = action_kind_sequence,
			actions = actions,
		}
	end
	if action.one_of ~= nil then
		local source_actions<const> = action.one_of
		local actions<const> = {}
		local weights<const> = {}
		local has_weights
		local weight_total = 0
		for i = 1, #source_actions do
			local source_action<const> = source_actions[i]
			actions[i] = compile_action(source_action, audio_cache)
			local weight<const> = source_action.weight or 1
			weights[i] = weight
			weight_total = weight_total + weight
			if weight ~= 1 then
				has_weights = true
			end
		end
		local weighted = action.pick == 'weighted'
		if action.pick == nil and has_weights then
			weighted = true
		end
		local compiled<const> = {
			kind = action_kind_random,
			actions = actions,
			weights = weights,
			weight_total = weight_total,
			weighted = weighted,
		}
		if action.avoid_repeat then
			compiled.last_pick_by_actor = {}
		end
		return compiled
	end
	return compile_music_transition(action.music_transition, audio_cache)
end

local compile_rules<const> = function(rules, audio_cache)
	local compiled<const> = {}
	for i = 1, #rules do
		local rule<const> = rules[i]
		compiled[i] = {
			predicate = compile_matcher(rule.when),
			action = compile_action(rule.go, audio_cache),
		}
	end
	return compiled
end

local pick_uniform_index<const> = function(count, avoid_index)
	if count <= 1 then
		return 1
	end
	if avoid_index then
		local idx<const> = math.random(count - 1)
		if idx >= avoid_index then
			return idx + 1
		end
		return idx
	end
	return math.random(count)
end

local pick_weighted_index<const> = function(weights, total, avoid_index)
	local count<const> = #weights
	if count <= 1 then
		return 1
	end
	if avoid_index then
		total = total - weights[avoid_index]
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

local merge_events<const> = function(event_maps)
	local merged<const> = {}
	local audio_cache<const> = {}

	local add_or_merge<const> = function(event_name, entry)
		local slot<const> = route_slot[entry.channel]
		local compiled_rules<const> = compile_rules(entry.rules, audio_cache)
		local cur<const> = merged[event_name]
		if not cur then
			merged[event_name] = {
				slot = slot,
				queued = entry.policy == 'queue',
				rules = compiled_rules,
			}
			return
		end
		cur.slot = slot
		cur.queued = entry.policy == 'queue'
		local old_count<const> = #cur.rules
		local new_count<const> = #compiled_rules
		for i = old_count, 1, -1 do
			cur.rules[i + new_count] = cur.rules[i]
		end
		for i = 1, new_count do
			cur.rules[i] = compiled_rules[i]
		end
	end

	for map_index = 1, #event_maps do
		for event_name, entry in pairs(event_maps[map_index]) do
			add_or_merge(event_name, entry)
		end
	end

	return merged
end

local apply_cooldown<const> = function(action, payload)
	local by_actor<const> = action.cooldown_by_actor
	if not by_actor then
		return true
	end
	local cooldown_ms<const> = action.cooldown_ms
	local actor_key<const> = actor_key_for_payload(payload)
	local now<const> = clock.milliseconds()
	local last<const> = by_actor[actor_key]
	if last ~= nil and clock.elapsed_milliseconds(last, now) < cooldown_ms then
		return false
	end
	by_actor[actor_key] = now
	return true
end

local reset_slot_state<const> = function()
	slot_active_source_addr[slot_sfx] = 0
	slot_active_source_addr[slot_music_a] = 0
	slot_active_source_addr[slot_music_b] = 0
	slot_active_source_addr[slot_ui] = 0
	slot_active_priority[slot_sfx] = 0
	slot_active_priority[slot_music_a] = 0
	slot_active_priority[slot_music_b] = 0
	slot_active_priority[slot_ui] = 0
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
		play.filter_control,
		play.filter_b0_b1,
		play.filter_b2_a1,
		play.filter_a2
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

local submit_play<const> = function(
	source,
	slot,
	priority,
	queued,
	rate_step_q16,
	gain_q12,
	start_sample,
	filter_control,
	filter_b0_b1,
	filter_b2_a1,
	filter_a2
)
	if queued then
		if slot_is_busy(slot) or has_queued_play(slot) then
			enqueue_prepared_play({
				source = source,
				slot = slot,
				priority = priority,
				rate_step_q16 = rate_step_q16,
				gain_q12 = gain_q12,
				start_sample = start_sample,
				filter_control = filter_control,
				filter_b0_b1 = filter_b0_b1,
				filter_b2_a1 = filter_b2_a1,
				filter_a2 = filter_a2,
			})
			return
		end
	else
		if slot_is_busy(slot) and priority < slot_active_priority[slot] then
			return
		end
		clear_slot_queue(slot)
	end
	mark_slot_active(slot, source.source_addr, priority)
	apu.play(
		source,
		slot,
		rate_step_q16,
		gain_q12,
		start_sample,
		filter_control,
		filter_b0_b1,
		filter_b2_a1,
		filter_a2
	)
end

local dispatch_audio_play<const> = function(entry, action, payload)
	if not apply_cooldown(action, payload) then
		return
	end
	local pitch_delta = action.pitch_delta
	local pitch_range_span<const> = action.pitch_range_span
	if pitch_range_span ~= 0 then
		pitch_delta = pitch_delta + action.pitch_range_min + (pitch_range_span * math.random())
	end

	local volume_delta = action.volume_delta
	local volume_range_span<const> = action.volume_range_span
	if volume_range_span ~= 0 then
		volume_delta = volume_delta + action.volume_range_min + (volume_range_span * math.random())
	end
	local gain_q12<const> = (10 ^ (volume_delta / 20)) * 0x00001000

	local start_sample = action.start_sample
	local start_range_span<const> = action.start_range_span
	if start_range_span ~= 0 then
		start_sample = start_sample + action.start_range_min + (start_range_span * math.random())
	end

	local rate = action.rate
	local rate_range_span<const> = action.rate_range_span
	if rate_range_span ~= 0 then
		rate = rate + action.rate_range_min + (rate_range_span * math.random())
	end
	local rate_step_q16<const> = rate * (2 ^ (pitch_delta / 12)) * 0x00010000

	submit_play(
		action.source,
		entry.slot,
		action.priority,
		entry.queued,
		rate_step_q16,
		gain_q12,
		start_sample,
		action.filter_control,
		action.filter_b0_b1,
		action.filter_b2_a1,
		action.filter_a2
	)
end

local alternate_music_slot<const> = function()
	if *current_music_slot == slot_music_a then
		return slot_music_b
	end
	return slot_music_a
end

local clear_pending_music<const> = function()
	*pending_music_seq = 0
	pending_music_transition = nil
end

local clear_stinger<const> = function()
	*stinger_seq = 0
	*stinger_source_addr = 0
	*stinger_slot = 0
	stinger_music_transition = nil
end

local begin_music_request<const> = function()
	*music_request_seq = *music_request_seq + 1
	if *stinger_source_addr ~= 0 then
		apu.stop_slot(*stinger_slot, 0)
	end
	clear_slot_queue(slot_music_a)
	clear_slot_queue(slot_music_b)
	clear_stinger()
	clear_pending_music()
	return *music_request_seq
end

local play_music_now<const> = function(transition, gain_q12, slot)
	local target_slot = slot or *current_music_slot
	if target_slot == 0 then
		target_slot = slot_music_a
	end
	local source<const> = transition.target_source
	*current_music_source_addr = source.source_addr
	*current_music_slot = target_slot
	mark_slot_active(target_slot, source.source_addr, transition.target_priority)
	apu.play(
		source,
		target_slot,
		0x00010000,
		gain_q12 or 0x00001000,
		transition.start_sample,
		0x00000000,
		apu.filter_coefficient_one,
		0x00000000,
		0x00000000
	)
end

local queue_music_after_current<const> = function(request_seq, transition)
	*pending_music_seq = request_seq
	pending_music_transition = transition
end

local play_transition_apu<const> = function(transition)
	if transition.wait_for_current and *current_music_source_addr ~= 0 then
		queue_music_after_current(*music_request_seq, transition)
		return
	end

	local crossfade_samples<const> = transition.crossfade_samples
	if crossfade_samples > 0 and *current_music_source_addr ~= 0 then
		local old_slot<const> = *current_music_slot
		local new_slot<const> = alternate_music_slot()
		apu.stop_slot(old_slot, crossfade_samples)
		play_music_now(transition, 0x00001000, new_slot)
		return
	end

	local fade_samples<const> = transition.fade_samples
	if fade_samples > 0 and *current_music_source_addr ~= 0 then
		queue_music_after_current(*music_request_seq, transition)
		apu.stop_slot(*current_music_slot, fade_samples)
		return
	end

	if *current_music_source_addr ~= 0 then
		apu.stop_slot(*current_music_slot, 0)
	end
	play_music_now(transition)
end

local dispatch_music_transition<const> = function(transition)
	local request_seq<const> = begin_music_request()
	local target_source<const> = transition.target_source
	local stinger_source<const> = transition.stinger_source
	if stinger_source == nil
		and not transition.start_fresh
		and *current_music_source_addr == target_source.source_addr then
		return
	end
	if stinger_source ~= nil then
		if *current_music_source_addr ~= 0 then
			apu.stop_slot(*current_music_slot, 0)
		end
		*current_music_source_addr = 0
		*current_music_slot = 0
		*stinger_seq = request_seq
		*stinger_source_addr = stinger_source.source_addr
		*stinger_slot = transition.stinger_slot
		stinger_music_transition = transition
		mark_slot_active(*stinger_slot, *stinger_source_addr, transition.stinger_priority)
		apu.play_plain(stinger_source, *stinger_slot)
		return
	end
	play_transition_apu(transition)
end

local dispatch_action
dispatch_action = function(entry, action, payload)
	local kind<const> = action.kind
	if kind == action_kind_play then
		dispatch_audio_play(entry, action, payload)
		return
	end
	if kind == action_kind_stop_music then
		begin_music_request()
		*current_music_source_addr = 0
		*current_music_slot = 0
		apu.stop_slot(slot_music_a, action.fade_samples)
		apu.stop_slot(slot_music_b, action.fade_samples)
		return
	end
	if kind == action_kind_sequence then
		local actions<const> = action.actions
		for i = 1, #actions do
			dispatch_action(entry, actions[i], payload)
		end
		return
	end
	if kind == action_kind_random then
		local actions<const> = action.actions
		local by_actor<const> = action.last_pick_by_actor
		local actor_key<const> = by_actor and actor_key_for_payload(payload)
		local avoid<const> = by_actor and by_actor[actor_key]
		local index
		if action.weighted then
			index = pick_weighted_index(action.weights, action.weight_total, avoid)
		else
			index = pick_uniform_index(#actions, avoid)
		end
		if by_actor then
			by_actor[actor_key] = index
		end
		dispatch_action(entry, actions[index], payload)
		return
	end
	dispatch_music_transition(action)
end

local handle_event<const> = function(_subscriber, event_type, _emitter, payload)
	local entry<const> = events[event_type]
	if entry == nil then
		return
	end
	local rules<const> = entry.rules
	for i = 1, #rules do
		local rule<const> = rules[i]
		if rule.predicate(payload) then
			dispatch_action(entry, rule.action, payload)
			return
		end
	end
end

local reset_audio_state<const> = function()
	*music_request_seq = 0
	*current_music_source_addr = 0
	*current_music_slot = 0
	reset_slot_state()
	clear_pending_music()
	clear_stinger()
end

reset_audio_state()

local rebind<const> = function()
	event_emitter:remove_subscriber(aem)
	events = merge_events(rom_dir.aem_event_maps())
	for event_name in pairs(events) do
		event_emitter:on({
			event = event_name,
			handler = handle_event,
			subscriber = aem,
		})
	end
end

local reload_from_rom<const> = function()
	rom_dir.reload_cartridge_directory()
	rebind()
end

local on_apu_irq<const> = function()
	local kind<const> = *apu_event_kind
	local slot<const> = *apu_event_slot
	local source_addr<const> = *apu_event_source_addr

	if kind ~= 0x00000001 then
		return
	end

	if *stinger_source_addr == source_addr
		and *stinger_slot == slot
		and *stinger_seq == *music_request_seq then
		local transition<const> = stinger_music_transition
		complete_slot_play(slot, source_addr, slot ~= *current_music_slot)
		clear_stinger()
		play_transition_apu(transition)
		return
	end

	if slot ~= *current_music_slot then
		complete_slot_play(slot, source_addr, true)
		return
	end

	if *current_music_source_addr ~= source_addr then
		complete_slot_play(slot, source_addr, true)
		return
	end

	complete_slot_play(slot, source_addr, false)
	*current_music_source_addr = 0
	*current_music_slot = 0
	if *pending_music_seq == *music_request_seq and pending_music_transition ~= nil then
		local transition<const> = pending_music_transition
		clear_pending_music()
		play_music_now(transition)
		return
	end
	play_next_queued(slot)
end

rebind()

aem.reload_from_rom = reload_from_rom
aem.on_apu_irq = on_apu_irq

return aem
