-- apu.lua
-- BIOS-side APU command helpers. Cart-visible audio control is MMIO.
local endian<const> = require("bios/common/endian")
local read_u16le<const> = endian.read_u16le

struct apu_command_registers
	source_addr: word
	source_bytes: word
	sample_rate_hz: word
	channels: word
	bits_per_sample: word
	frame_count: word
	data_offset: word
	data_bytes: word
	loop_start_sample: word
	loop_end_sample: word
	slot: word
	rate_step_q16: word
	gain_q12: word
	start_sample: word
	filter_kind: word
	filter_freq_hz: word
	filter_q_milli: word
	filter_gain_millidb: word
	fade_samples: word
	generator_kind: word
	generator_duty_q12: word
	cmd: word
end

local apu<const> = {
	filter_kind = {
		lowpass = 0x00000001,
		highpass = 0x00000002,
		bandpass = 0x00000003,
		notch = 0x00000004,
		allpass = 0x00000005,
		peaking = 0x00000006,
		lowshelf = 0x00000007,
		highshelf = 0x00000008,
	},
}

local command_registers<const>: *apu_command_registers = 0x08000250

function apu.seconds_to_samples(seconds)
	return seconds * 0x0000ac44
end

function apu.ms_to_samples(ms)
	return ms * 0x0000ac44 / 1000
end

local rom_base_for_payload<const> = function(payload_id)
	if payload_id == 'system' then
		return 0x00000000
	end
	if payload_id == 'overlay' then
		return 0x06000000
	end
	return 0x01000000
end
local read_badp_source<const> = function(addr, source_bytes)
	local header<const>: *word = addr
	local channels<const> = read_u16le(addr + 6)
	local sample_rate_hz<const> = header[2]
	local frame_count<const> = header[3]
	local data_offset<const> = header[9]
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
	command_registers->source_addr = source.source_addr
	command_registers->source_bytes = source.source_bytes
	command_registers->sample_rate_hz = source.sample_rate_hz
	command_registers->channels = source.channels
	command_registers->bits_per_sample = source.bits_per_sample
	command_registers->frame_count = source.frame_count
	command_registers->data_offset = source.data_offset
	command_registers->data_bytes = source.data_bytes
	command_registers->loop_start_sample = source.loop_start_sample
	command_registers->loop_end_sample = source.loop_end_sample
	command_registers->slot = slot
	command_registers->rate_step_q16 = rate_step_q16
	command_registers->gain_q12 = gain_q12
	command_registers->start_sample = start_sample
	command_registers->filter_kind = filter_kind
	command_registers->filter_freq_hz = filter_freq_hz
	command_registers->filter_q_milli = filter_q_milli
	command_registers->filter_gain_millidb = filter_gain_millidb
	command_registers->fade_samples = 0
	command_registers->generator_kind = 0
	command_registers->generator_duty_q12 = 0x00001000
	command_registers->cmd = 0x00000001
end

function apu.play_plain(source, slot)
	command_registers->source_addr = source.source_addr
	command_registers->source_bytes = source.source_bytes
	command_registers->sample_rate_hz = source.sample_rate_hz
	command_registers->channels = source.channels
	command_registers->bits_per_sample = source.bits_per_sample
	command_registers->frame_count = source.frame_count
	command_registers->data_offset = source.data_offset
	command_registers->data_bytes = source.data_bytes
	command_registers->loop_start_sample = source.loop_start_sample
	command_registers->loop_end_sample = source.loop_end_sample
	command_registers->slot = slot
	command_registers->rate_step_q16 = 0x00010000
	command_registers->gain_q12 = 0x00001000
	command_registers->start_sample = 0
	command_registers->filter_kind = 0x00000000
	command_registers->filter_freq_hz = 0
	command_registers->filter_q_milli = 1000
	command_registers->filter_gain_millidb = 0
	command_registers->fade_samples = 0
	command_registers->generator_kind = 0
	command_registers->generator_duty_q12 = 0x00001000
	command_registers->cmd = 0x00000001
end

function apu.stop_slot(slot, fade_samples)
	command_registers->slot = slot
	command_registers->fade_samples = fade_samples
	command_registers->cmd = 0x00000002
end

function apu.set_slot_gain(slot, gain_q12)
	command_registers->slot = slot
	command_registers->gain_q12 = gain_q12
	command_registers->cmd = 0x00000003
end

return apu
