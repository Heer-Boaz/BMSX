-- apu.lua
-- BIOS-side APU command helpers. Cart-visible audio control is MMIO.

local apu<const> = {
	channel = {
		sfx = apu_channel_sfx,
		music = apu_channel_music,
		ui = apu_channel_ui,
	},
	filter_kind = {
		lowpass = apu_filter_lowpass,
		highpass = apu_filter_highpass,
		bandpass = apu_filter_bandpass,
		notch = apu_filter_notch,
		allpass = apu_filter_allpass,
		peaking = apu_filter_peaking,
		lowshelf = apu_filter_lowshelf,
		highshelf = apu_filter_highshelf,
	},
}

function apu.seconds_to_samples(seconds)
	return seconds * apu_sample_rate_hz
end

function apu.ms_to_samples(ms)
	return ms * apu_sample_rate_hz / 1000
end

function apu.loop_start_sample(asset)
	local loop<const> = asset.audiometa.loop
	if loop == nil then
		return 0
	end
	return apu.seconds_to_samples(loop)
end

function apu.play(handle, channel, priority, rate_step_q16, gain_q12, start_sample, filter_kind, filter_freq_hz, filter_q_milli, filter_gain_millidb, cmd)
	memwrite(
		sys_apu_handle,
		handle,
		channel,
		priority,
		rate_step_q16,
		gain_q12,
		start_sample,
		filter_kind,
		filter_freq_hz,
		filter_q_milli,
		filter_gain_millidb,
		0,
		0,
		apu_gain_q12_one,
		cmd
	)
end

function apu.play_plain(handle, channel, cmd)
	apu.play(handle, channel, apu_priority_auto, apu_rate_step_q16_one, apu_gain_q12_one, 0, apu_filter_none, 0, 1000, 0, cmd)
end

function apu.play_music(asset, start_sample, gain_q12, cmd)
	apu.play(asset.handle, apu_channel_music, apu_priority_auto, apu_rate_step_q16_one, gain_q12, start_sample, apu_filter_none, 0, 1000, 0, cmd)
end

function apu.stop_channel(channel, fade_samples)
	mem[sys_apu_channel] = channel
	mem[sys_apu_fade_samples] = fade_samples
	mem[sys_apu_cmd] = apu_cmd_stop_channel
end

function apu.stop_voice(voice, fade_samples)
	mem[sys_apu_voice] = voice
	mem[sys_apu_fade_samples] = fade_samples
	mem[sys_apu_cmd] = apu_cmd_stop_voice
end

function apu.ramp_voice(voice, target_gain_q12, fade_samples)
	mem[sys_apu_voice] = voice
	mem[sys_apu_target_gain_q12] = target_gain_q12
	mem[sys_apu_fade_samples] = fade_samples
	mem[sys_apu_cmd] = apu_cmd_ramp_voice
end

return apu
