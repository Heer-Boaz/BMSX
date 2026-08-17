-- apu.lua
-- Cart-library APU command helpers. Audio control reaches the device through MMIO.
local dma<const> = require("cartlib/dma")

struct badp_header
	magic: word
	version: u16
	channels: u16
	sample_rate_hz: word
	frame_count: word
	loop_start_sample: word
	loop_end_sample: word
	seek_stride_frames: word
	seek_entry_count: word
	seek_table_offset: word
	data_offset: word
	reserved_0: word
	reserved_1: word
end

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
	filter_control: word
	filter_b0_b1: word
	filter_b2_a1: word
	filter_a2: word
	fade_samples: word
	generator_kind: word
	generator_duty_q12: word
	cmd: word
end

local apu<const> = {}
local output_sample_rate_hz<const> = 0x0000ac44
local output_sample_milliseconds<const> = 1000 / output_sample_rate_hz
local filter_coefficient_one<const> = 0x00004000
local badp_no_loop<const> = 0xffffffff

local command_registers<const>: *apu_command_registers = 0x08000120
local transfer_address<const>: *word = 0x080001e8
local transfer_control<const>: *word = 0x080001f0
local sample_sequence<const>: *word = 0x08000200
local transfer_mode_stop<const> = 0x00000000
local transfer_mode_dma_write<const> = 0x00000002
local transfer_mode_dma_read<const> = 0x00000003

apu.sample_ram_base = 0x40000000
apu.sample_ram_bytes = 0x00080000
apu.output_sample_rate_hz = output_sample_rate_hz
apu.filter_control_enable = 0x00000001
apu.filter_coefficient_one = filter_coefficient_one

function apu.upload(source, sample_ram_offset, word_count)
	*transfer_control = transfer_mode_stop
	*transfer_address = sample_ram_offset
	*transfer_control = transfer_mode_dma_write
	dma.copy_to_apu(source, word_count)
end

function apu.download(target, sample_ram_offset, word_count)
	*transfer_control = transfer_mode_stop
	*transfer_address = sample_ram_offset
	*transfer_control = transfer_mode_dma_read
	dma.copy_from_apu(target, word_count)
end

function apu.seconds_to_samples(seconds)
	return seconds * output_sample_rate_hz
end

function apu.ms_to_samples(ms)
	return ms * output_sample_rate_hz / 1000
end

-- The APU publishes the low word of its retained output-sample sequence. Its
-- wrap period exceeds 27 hours; shorter audio-clock intervals use the unsigned
-- sample distance and convert once at the timeline-system boundary.
function apu.sample_sequence()
	return *sample_sequence
end

function apu.elapsed_milliseconds(start_sample, current_sample)
	local elapsed<const> = current_sample - start_sample
	if elapsed < 0 then
		return (elapsed + 0x100000000) * output_sample_milliseconds
	end
	return elapsed * output_sample_milliseconds
end

function apu.source(record)
	local source_addr<const> = record.addr
	local source_bytes<const> = record.len
	local header<const>: *badp_header = source_addr
	local data_offset<const> = header->data_offset
	local loop_start_sample = header->loop_start_sample
	local loop_end_sample = header->loop_end_sample
	if loop_start_sample == badp_no_loop then
		loop_start_sample = 0
		loop_end_sample = 0
	end
	return {
		source_addr = source_addr,
		source_bytes = source_bytes,
		sample_rate_hz = header->sample_rate_hz,
		channels = header->channels,
		bits_per_sample = 4,
		frame_count = header->frame_count,
		data_offset = data_offset,
		data_bytes = source_bytes - data_offset,
		loop_start_sample = loop_start_sample,
		loop_end_sample = loop_end_sample,
	}
end

function apu.play(source, slot, rate_step_q16, gain_q12, start_sample, filter_control, filter_b0_b1, filter_b2_a1, filter_a2)
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
	command_registers->filter_control = filter_control
	command_registers->filter_b0_b1 = filter_b0_b1
	command_registers->filter_b2_a1 = filter_b2_a1
	command_registers->filter_a2 = filter_a2
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
	command_registers->filter_control = 0x00000000
	command_registers->filter_b0_b1 = filter_coefficient_one
	command_registers->filter_b2_a1 = 0x00000000
	command_registers->filter_a2 = 0x00000000
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

function apu.pause_slot(slot)
	command_registers->slot = slot
	command_registers->cmd = 0x00000004
end

function apu.resume_slot(slot)
	command_registers->slot = slot
	command_registers->cmd = 0x00000005
end

return apu
