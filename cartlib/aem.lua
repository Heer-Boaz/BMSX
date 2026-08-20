-- aem.lua
-- Cart Audio Event Map dispatcher. AEM rules decide what to play; APU writes live in apu.lua.

local apu<const> = require('cartlib/apu')
local apu_event<const> = require('cartlib/apu/event')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local event_emitter<const> = require('cartlib/event_emitter')
local compile_matcher<const> = require('cartlib/event_matcher').compile
local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')
local rom_dir<const> = require('cartlib/rom_dir')
local tick_group<const> = require('cartlib/world/tick_group')

local aem<const> = {}
aem.__index = aem
setmetatable(aem, { __index = base_system })
aem.tick = {
	group = tick_group.input,
	priority = -100,
	clock_source = clock.frame,
	method = 'update',
}
local slot_sfx<const> = 0
local slot_music_a<const> = 1
local slot_music_b<const> = 2
local slot_ui<const> = 3
local apu_event_kind<const>: *word = apu_event.kind_address
local apu_event_slot<const>: *word = apu_event.slot_address
local apu_event_source_addr<const>: *word = apu_event.source_address
local route_slot<const> = {
	sfx = slot_sfx,
	music = slot_music_a,
	ui = slot_ui,
}

-- Request, source, slot and per-slot active-priority latches are raw words in
-- cart RAM. Tables retain authored event programs and only those prepared plays
-- that are actually queued behind an active slot; an admitted play that can
-- start now writes the APU command without constructing a transient play record.
-- Optional on_finished state follows that admitted play until the APU publishes
-- its physical completion. Replacement and explicit stop discard it instead of
-- presenting cancellation as natural playback completion.
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
local slot_finished_event
local slot_finished_emitter
local finished_event_queue
local finished_emitter_queue
local finished_queue_head
local finished_queue_tail

local action_kind_play<const> = 1
local action_kind_stop_music<const> = 2
local action_kind_sequence<const> = 3
local action_kind_music_transition<const> = 4
local action_kind_random_uniform<const> = 5
local action_kind_random_weighted<const> = 6
local action_kind_pause_music<const> = 7
local action_kind_resume_music<const> = 8
local source_action_play<const> = 'play'
local source_action_stop_music<const> = 'stop_music'
local source_action_pause_music<const> = 'pause_music'
local source_action_resume_music<const> = 'resume_music'
local source_action_sequence<const> = 'sequence'
local source_action_random_uniform<const> = 'random_uniform'
local source_action_random_weighted<const> = 'random_weighted'
local emitter_state_metatable<const> = { __mode = 'k' }
local default_modulation<const> = {
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

local compile_play_action<const> = function(action, audio_cache)
	local audio<const> = resolve_audio(audio_cache, action.audio_id)
	local modulation<const> = action.modulation or default_modulation
	local compiled<const> = {
		kind = action_kind_play,
		source = audio.source,
		priority = action.priority or audio.priority,
		cooldown_ms = action.cooldown_ms,
		pitch_delta = modulation.pitch_delta,
		pitch_range_min = modulation.pitch_range_min,
		pitch_range_span = modulation.pitch_range_span,
		volume_delta = modulation.volume_delta,
		volume_range_min = modulation.volume_range_min,
		volume_range_span = modulation.volume_range_span,
		start_sample = modulation.start_sample,
		start_range_min = modulation.start_range_min,
		start_range_span = modulation.start_range_span,
		rate = modulation.rate,
		rate_range_min = modulation.rate_range_min,
		rate_range_span = modulation.rate_range_span,
		filter_control = modulation.filter_control,
		filter_b0_b1 = modulation.filter_b0_b1,
		filter_b2_a1 = modulation.filter_b2_a1,
		filter_a2 = modulation.filter_a2,
	}
	if action.cooldown_ms ~= nil and action.cooldown_ms > 0 then
		compiled.cooldown_by_emitter = setmetatable({}, emitter_state_metatable)
	end
	return compiled
end

local compile_music_transition<const> = function(action, audio_cache)
	local target<const> = resolve_audio(audio_cache, action.target_audio_id)
	local start_sample = 0
	if action.start_at_loop_start then
		start_sample = target.source.loop_start_sample
	end
	local compiled<const> = {
		kind = action_kind_music_transition,
		target_source = target.source,
		target_priority = target.priority,
		start_sample = start_sample,
		fade_samples = action.fade_samples,
		crossfade_samples = action.crossfade_samples,
		wait_for_current = action.wait_for_current,
		start_fresh = action.start_fresh,
	}
	local stinger_audio_id<const> = action.stinger_audio_id
	if stinger_audio_id ~= nil then
		local stinger<const> = resolve_audio(audio_cache, stinger_audio_id)
		compiled.stinger_source = stinger.source
		compiled.stinger_priority = stinger.priority
		compiled.stinger_slot = stinger.slot
	end
	return compiled
end

local compile_action
compile_action = function(action, audio_cache)
	local kind<const> = action.kind
	if kind == source_action_play then
		return compile_play_action(action, audio_cache)
	end
	if kind == source_action_stop_music then
		return {
			kind = action_kind_stop_music,
			fade_samples = action.fade_samples,
		}
	end
	if kind == source_action_pause_music then
		return { kind = action_kind_pause_music }
	end
	if kind == source_action_resume_music then
		return { kind = action_kind_resume_music }
	end
	if kind == source_action_sequence then
		local source_actions<const> = action.actions
		local actions<const> = {}
		for i = 1, #source_actions do
			actions[i] = compile_action(source_actions[i], audio_cache)
		end
		return {
			kind = action_kind_sequence,
			actions = actions,
		}
	end
	if kind == source_action_random_uniform or kind == source_action_random_weighted then
		local source_actions<const> = action.actions
		local actions<const> = {}
		for i = 1, #source_actions do
			actions[i] = compile_action(source_actions[i], audio_cache)
		end
		local compiled<const> = {
			kind = kind == source_action_random_uniform and action_kind_random_uniform or action_kind_random_weighted,
			actions = actions,
		}
		if kind == source_action_random_weighted then
			compiled.weights = action.weights
			compiled.weight_total = action.weight_total
		end
		if action.avoid_repeat then
			compiled.last_pick_by_emitter = setmetatable({}, emitter_state_metatable)
		end
		return compiled
	end
	return compile_music_transition(action, audio_cache)
end

local compile_rules<const> = function(rules, audio_cache)
	local compiled<const> = {}
	for i = 1, #rules do
		local rule<const> = rules[i]
		compiled[i] = {
			predicate = compile_matcher(rule.when),
			action = compile_action(rule.action, audio_cache),
		}
	end
	return compiled
end

local pick_uniform_index<const> = function(count, avoid_index)
	if avoid_index ~= nil then
		local idx<const> = math.random(count - 1)
		if idx >= avoid_index then
			return idx + 1
		end
		return idx
	end
	return math.random(count)
end

local pick_weighted_index<const> = function(weights, total, avoid_index)
	-- ROM production admits only positive weights and, for avoid-repeat pools,
	-- at least two choices. The final dense interval therefore owns the tail.
	local count<const> = #weights
	if avoid_index ~= nil then
		total = total - weights[avoid_index]
	end
	local r = math.random() * total
	local last_index<const> = avoid_index == count and count - 1 or count
	for i = 1, last_index - 1 do
		if i ~= avoid_index then
			local weight<const> = weights[i]
			if r < weight then
				return i
			end
			r = r - weight
		end
	end
	return last_index
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
				queued = entry.queued,
				on_finished = entry.on_finished,
				rules = compiled_rules,
			}
			return
		end
		cur.slot = slot
		cur.queued = entry.queued
		cur.on_finished = entry.on_finished
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

local apply_cooldown<const> = function(action, emitter)
	local cooldowns<const> = action.cooldown_by_emitter
	if not cooldowns then
		return true
	end
	local cooldown_ms<const> = action.cooldown_ms
	local now<const> = clock.milliseconds()
	local last<const> = cooldowns[emitter]
	if last ~= nil and clock.elapsed_milliseconds(last, now) < cooldown_ms then
		return false
	end
	cooldowns[emitter] = now
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
	slot_finished_event = {}
	slot_finished_emitter = {}
	finished_event_queue = {}
	finished_emitter_queue = {}
	finished_queue_head = 1
	finished_queue_tail = 0
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

local mark_slot_active<const> = function(slot, source_addr, priority, finished_event, emitter)
	slot_active_source_addr[slot] = source_addr
	slot_active_priority[slot] = priority
	slot_finished_event[slot] = finished_event
	slot_finished_emitter[slot] = emitter
end

local slot_source_matches<const> = function(slot, source_addr)
	return slot_active_source_addr[slot] == source_addr
end

local clear_slot_active<const> = function(slot)
	slot_active_source_addr[slot] = 0
	slot_active_priority[slot] = 0
	slot_finished_event[slot] = nil
	slot_finished_emitter[slot] = nil
end

local discard_slot_completion<const> = function(slot)
	slot_finished_event[slot] = nil
	slot_finished_emitter[slot] = nil
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
	mark_slot_active(
		play.slot,
		play.source.source_addr,
		play.priority,
		play.finished_event,
		play.finished_emitter
	)
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
	clear_slot_active(slot)
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
	filter_a2,
	finished_event,
	finished_emitter
)
	if queued then
		if slot_is_busy(slot) or has_queued_play(slot) then
			local play<const> = {
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
			}
			if finished_event ~= nil then
				play.finished_event = finished_event
				play.finished_emitter = finished_emitter
			end
			enqueue_prepared_play(play)
			return
		end
	else
		if slot_is_busy(slot) and priority < slot_active_priority[slot] then
			return
		end
		clear_slot_queue(slot)
	end
	mark_slot_active(slot, source.source_addr, priority, finished_event, finished_emitter)
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

local dispatch_audio_play<const> = function(entry, action, emitter, finished_event)
	if not apply_cooldown(action, emitter) then
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
		action.filter_a2,
		finished_event,
		emitter
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
	local cancelled_stinger_slot
	if *stinger_source_addr ~= 0
	and slot_source_matches(*stinger_slot, *stinger_source_addr) then
		cancelled_stinger_slot = *stinger_slot
		apu.stop_slot(cancelled_stinger_slot, 0)
		clear_slot_active(cancelled_stinger_slot)
	end
	clear_slot_queue(slot_music_a)
	clear_slot_queue(slot_music_b)
	if cancelled_stinger_slot ~= nil then
		play_next_queued(cancelled_stinger_slot)
	end
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
	mark_slot_active(target_slot, source.source_addr, transition.target_priority, nil, nil)
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
		discard_slot_completion(old_slot)
		apu.stop_slot(old_slot, crossfade_samples)
		play_music_now(transition, 0x00001000, new_slot)
		return
	end

	local fade_samples<const> = transition.fade_samples
	if fade_samples > 0 and *current_music_source_addr ~= 0 then
		queue_music_after_current(*music_request_seq, transition)
		discard_slot_completion(*current_music_slot)
		apu.stop_slot(*current_music_slot, fade_samples)
		return
	end

	if *current_music_source_addr ~= 0 then
		local slot<const> = *current_music_slot
		apu.stop_slot(slot, 0)
		clear_slot_active(slot)
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
			local slot<const> = *current_music_slot
			apu.stop_slot(slot, 0)
			clear_slot_active(slot)
		end
		*current_music_source_addr = 0
		*current_music_slot = 0
		*stinger_seq = request_seq
		*stinger_source_addr = stinger_source.source_addr
		*stinger_slot = transition.stinger_slot
		stinger_music_transition = transition
		mark_slot_active(*stinger_slot, *stinger_source_addr, transition.stinger_priority, nil, nil)
		apu.play_plain(stinger_source, *stinger_slot)
		return
	end
	play_transition_apu(transition)
end

local dispatch_action
dispatch_action = function(entry, action, emitter, finished_event)
	local kind<const> = action.kind
	if kind == action_kind_play then
		dispatch_audio_play(entry, action, emitter, finished_event)
		return
	end
	if kind == action_kind_stop_music then
		begin_music_request()
		*current_music_source_addr = 0
		*current_music_slot = 0
		discard_slot_completion(slot_music_a)
		discard_slot_completion(slot_music_b)
		apu.stop_slot(slot_music_a, action.fade_samples)
		apu.stop_slot(slot_music_b, action.fade_samples)
		if action.fade_samples == 0 then
			clear_slot_active(slot_music_a)
			clear_slot_active(slot_music_b)
		end
		return
	end
	if kind == action_kind_pause_music then
		apu.pause_slot(slot_music_a)
		apu.pause_slot(slot_music_b)
		return
	end
	if kind == action_kind_resume_music then
		apu.resume_slot(slot_music_a)
		apu.resume_slot(slot_music_b)
		return
	end
	if kind == action_kind_sequence then
		local actions<const> = action.actions
		local last_index<const> = #actions
		for i = 1, last_index - 1 do
			dispatch_action(entry, actions[i], emitter, nil)
		end
		dispatch_action(entry, actions[last_index], emitter, finished_event)
		return
	end
	if kind == action_kind_random_uniform then
		local actions<const> = action.actions
		local last_picks<const> = action.last_pick_by_emitter
		local avoid<const> = last_picks and last_picks[emitter]
		local index<const> = pick_uniform_index(#actions, avoid)
		if last_picks then
			last_picks[emitter] = index
		end
		dispatch_action(entry, actions[index], emitter, finished_event)
		return
	end
	if kind == action_kind_random_weighted then
		local actions<const> = action.actions
		local last_picks<const> = action.last_pick_by_emitter
		local avoid<const> = last_picks and last_picks[emitter]
		local index<const> = pick_weighted_index(action.weights, action.weight_total, avoid)
		if last_picks then
			last_picks[emitter] = index
		end
		dispatch_action(entry, actions[index], emitter, finished_event)
		return
	end
	dispatch_music_transition(action)
end

local handle_event<const> = function(_subscriber, event_type, emitter, payload)
	local entry<const> = events[event_type]
	if entry == nil then
		return
	end
	local rules<const> = entry.rules
	for i = 1, #rules do
		local rule<const> = rules[i]
		if rule.predicate(payload) then
			dispatch_action(entry, rule.action, emitter, entry.on_finished)
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

	if kind ~= apu_event.kind_slot_ended then
		return
	end

	local finished_event<const> = slot_finished_event[slot]
	local finished_emitter<const> = slot_finished_emitter[slot]
	local completed
	if *stinger_source_addr == source_addr
		and *stinger_slot == slot
		and *stinger_seq == *music_request_seq then
		local transition<const> = stinger_music_transition
		completed = complete_slot_play(slot, source_addr, slot ~= *current_music_slot)
		clear_stinger()
		play_transition_apu(transition)
	elseif slot ~= *current_music_slot or *current_music_source_addr ~= source_addr then
		completed = complete_slot_play(slot, source_addr, true)
	else
		completed = complete_slot_play(slot, source_addr, false)
		*current_music_source_addr = 0
		*current_music_slot = 0
		if *pending_music_seq == *music_request_seq and pending_music_transition ~= nil then
			local transition<const> = pending_music_transition
			clear_pending_music()
			play_music_now(transition)
		else
			play_next_queued(slot)
		end
	end
	if completed and finished_event ~= nil then
		local tail<const> = finished_queue_tail + 1
		finished_queue_tail = tail
		finished_event_queue[tail] = finished_event
		finished_emitter_queue[tail] = finished_emitter
	end
end

local function init_apu_irq<init>()
	irq.register(irq_source.apu, on_apu_irq)
end
init_apu_irq()

-- The IRQ path retires physical slot state only. Semantic callbacks cross onto
-- the frame schedule before gameplay work, mirroring UE AudioComponent's
-- audio-thread-to-game-thread completion handoff without allocating per event.
function aem.new()
	return setmetatable(base_system.new(aem.tick), aem)
end

function aem:update()
	local tail<const> = finished_queue_tail
	if finished_queue_head > tail then
		return
	end
	for index = finished_queue_head, tail do
		local emitter<const> = finished_emitter_queue[index]
		event_emitter:emit(finished_event_queue[index], emitter, nil, emitter.id)
		finished_event_queue[index] = nil
		finished_emitter_queue[index] = nil
	end
	finished_queue_head = 1
	finished_queue_tail = 0
end

function aem:clear()
	for index = finished_queue_head, finished_queue_tail do
		finished_event_queue[index] = nil
		finished_emitter_queue[index] = nil
	end
	finished_queue_head = 1
	finished_queue_tail = 0
	for slot = slot_sfx, slot_ui do
		discard_slot_completion(slot)
		clear_slot_queue(slot)
	end
end

rebind()

aem.reload_from_rom = reload_from_rom

return aem
