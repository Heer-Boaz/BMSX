-- apu.lua
-- BIOS-side APU command helpers. Cart-visible audio control is MMIO.
local endian<const> = require("bios/common/endian")
local read_u16le<const> = endian.read_u16le

local apu<const> = {
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

local rom_base_for_payload<const> = function(payload_id)
	if payload_id == 'system' then
		return sys_rom_system_base
	end
	if payload_id == 'overlay' then
		return sys_rom_overlay_base
	end
	return sys_rom_cart_base
end
local read_badp_source<const> = function(addr, source_bytes)
	local channels<const> = read_u16le(addr + 6)
	local sample_rate_hz<const> = mem32le[addr + 8]
	local frame_count<const> = mem32le[addr + 12]
	local data_offset<const> = mem32le[addr + 36]
	return {
		sample_rate_hz = sample_rate_hz,
		channels = channels,
		bits_per_sample = 4,
		frame_count = frame_count,
		data_offset = data_offset,
		data_bytes = source_bytes - data_offset,
	}
end

function apu.source(record)
	local source = record.__apu_source
	if source ~= nil then
		return source
	end
	local source_addr<const> = rom_base_for_payload(record.payload_id) + record.start
	local source_bytes<const> = record['end'] - record.start
	local format<const> = read_badp_source(source_addr, source_bytes)
	local loop_start_sample = 0
	local loop_end_sample = 0
	local meta<const> = record.audiometa
	if meta ~= nil and meta.loop ~= nil then
		loop_start_sample = meta.loop * format.sample_rate_hz
		local loop_end<const> = meta['loopEnd']
		if loop_end ~= nil then
			loop_end_sample = loop_end * format.sample_rate_hz
		end
	end
	source = {
		source_addr = source_addr,
		source_bytes = source_bytes,
		sample_rate_hz = format.sample_rate_hz,
		channels = format.channels,
		bits_per_sample = format.bits_per_sample,
		frame_count = format.frame_count,
		data_offset = format.data_offset,
		data_bytes = format.data_bytes,
		loop_start_sample = loop_start_sample,
		loop_end_sample = loop_end_sample,
	}
	record.__apu_source = source
	return source
end

function apu.loop_start_sample(record)
	return apu.source(record).loop_start_sample
end

function apu.play(source, slot, rate_step_q16, gain_q12, start_sample, filter_kind, filter_freq_hz, filter_q_milli, filter_gain_millidb)
	memwrite(
		sys_apu_source_addr,
		source.source_addr,
		source.source_bytes,
		source.sample_rate_hz,
		source.channels,
		source.bits_per_sample,
		source.frame_count,
		source.data_offset,
		source.data_bytes,
		source.loop_start_sample,
		source.loop_end_sample,
		slot,
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
		apu_cmd_play
	)
end

function apu.play_plain(source, slot)
	memwrite(
		sys_apu_source_addr,
		source.source_addr,
		source.source_bytes,
		source.sample_rate_hz,
		source.channels,
		source.bits_per_sample,
		source.frame_count,
		source.data_offset,
		source.data_bytes,
		source.loop_start_sample,
		source.loop_end_sample,
		slot,
		apu_rate_step_q16_one,
		apu_gain_q12_one,
		0,
		apu_filter_none,
		0,
		1000,
		0,
		0,
		0,
		apu_gain_q12_one,
		apu_cmd_play
	)
end

function apu.stop_slot(slot, fade_samples)
	mem[sys_apu_slot] = slot
	mem[sys_apu_fade_samples] = fade_samples
	mem[sys_apu_cmd] = apu_cmd_stop_slot
end

function apu.set_slot_gain(slot, gain_q12)
	mem[sys_apu_slot] = slot
	mem[sys_apu_gain_q12] = gain_q12
	mem[sys_apu_cmd] = apu_cmd_set_slot_gain
end

return apu
