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

function apu.stop_channel(channel, fade_samples)
	mem[sys_apu_channel] = channel
	mem[sys_apu_fade_samples] = fade_samples
	mem[sys_apu_cmd] = apu_cmd_stop_channel
end

return apu
