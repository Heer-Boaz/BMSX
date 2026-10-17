module<entry>

local apu<const> = require('cartlib/apu')
local dma<const> = require('cartlib/dma')
local irq<const> = require('cartlib/irq')
local assets<const> = require('bmsx/assets')
local state<const> = require('results')
local result<const>: *apu_manual_result = state.result
local commands<const>: *apu_command_registers = 0x08000120
local command_words<const>: *word = commands
local selected<const>: *apu_command_registers = 0x08000194
local status<const>: *word = 0x08000178
local selected_source<const>: *word = 0x0800018c
local active_mask<const>: *word = 0x08000190
local queued<const>: *word = 0x080001f4
local transfer_address<const>: *word = 0x080001e8
local transfer_control<const>: *word = 0x080001f0
local sample_sequence<const>: *word = 0x08000200
local event_kind<const>: *word = 0x0800017c
local event_slot<const>: *word = 0x08000180
local event_source<const>: *word = 0x08000184
local event_sequence<const>: *word = 0x08000188
local fault_code<const>: *word = 0x08010218
local fault_detail<const>: *word = 0x0801021c
local dma_status<const>: *word = 0x0800001c
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008

-- Two authored sine periods. Loop [0,16) at 7040 source frames/s gives 440 Hz.
rodata pcm: i16[32] = {
	0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
	0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
	0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
	0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
}

-- The existing APU register record names every operand; CMD is written last.
rodata pcm_note: apu_command_registers = {
	source_addr = 0, source_bytes = sizeof(i16[32]), sample_rate_hz = 7040,
	channels = 1, bits_per_sample = 16, frame_count = 32,
	data_offset = 0, data_bytes = sizeof(i16[32]),
	loop_start_sample = 0, loop_end_sample = 16,
	slot = 2, rate_step_q16 = 0x00010000, gain_q12 = 0x00000800,
	start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
	filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
	generator_kind = 0, generator_duty_q12 = 0x00000800, cmd = 1,
}
rodata square_note: apu_command_registers = {
	source_addr = 0, source_bytes = 0, sample_rate_hz = 440,
	channels = 1, bits_per_sample = 16, frame_count = 1,
	data_offset = 0, data_bytes = 0, loop_start_sample = 0, loop_end_sample = 1,
	slot = 4, rate_step_q16 = 0x00010000, gain_q12 = 0x00000400,
	start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
	filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
	generator_kind = 1, generator_duty_q12 = 0x00000800, cmd = 1,
}
local pcm_note_words<const>: *word = pcm_note
local square_note_words<const>: *word = square_note

-- cartlib/dma keeps its own DMA callbacks. Retain the single APU event latch.
irq.register(0x00000020, function()
	local index<const> = result.service_sequence
	result.events[index].kind = *event_kind
	result.events[index].slot = *event_slot
	result.events[index].source_address = *event_source
	result.events[index].hardware_sequence = *event_sequence
	result.service_sequence = index + 1
end)
*irq_ack = 0x00000121
result.initial_event_sequence = *event_sequence
-- Disabled VBlank is allowed to remain pending throughout every APU/DMA IRQ.
while (*irq_flags & 0x00000004) == 0 do
end
result.initial_unrelated_pending = *irq_flags & 0x00000004

-- 1. ROM PCM16: capture parameters on CMD, then select the committed slot.
result.pcm_address = pcm
commands->source_addr = pcm
for index = 1, 20 do
	command_words[index] = pcm_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000004) == 0 do
end
commands->slot = 2
result.pcm_selected_source = *selected_source
result.pcm_active_mask = *active_mask
result.pcm_status = *status
local playing_start<const> = *sample_sequence
while ((*sample_sequence - playing_start) & 0xffffffff) < 2205 do
end

-- A selected-window gain write is live, not a staged command. Negative is Q12.
selected->gain_q12 = 0xfffff800
result.pcm_gain = selected->gain_q12
apu.pause_slot(2)
while *queued ~= 0 do
end
commands->slot = 2
result.paused_sample_start = *sample_sequence
while ((*sample_sequence - result.paused_sample_start) & 0xffffffff) < 2205 do
end
result.paused_sample_end = *sample_sequence
result.paused_active_mask = *active_mask
result.paused_source = *selected_source
result.paused_gain = selected->gain_q12
apu.resume_slot(2)
while *queued ~= 0 do
end
local resumed_start<const> = *sample_sequence
while ((*sample_sequence - resumed_start) & 0xffffffff) < 2205 do
end
local pcm_end_sequence<const> = result.service_sequence
apu.stop_slot(2, 441)
while result.service_sequence == pcm_end_sequence do
	halt_until_irq
end
result.completed_phase = 1

-- 2. Upload goes through FIFO to private RAM: DMA DONE is not final commit.
apu.upload(pcm, 0, sizeof(i16[32]) // 4)
dma.wait0_idle()
result.upload_dma_status = *dma_status
result.upload_apu_status = *status
while (*status & 0x00000400) ~= 0 do
end
result.upload_committed_status = *status
result.transfer_address = *transfer_address
apu.download(&result.transferred[0], 0, 16)
dma.wait0_idle()
result.download_dma_status = *dma_status
result.download_apu_status = *status
*transfer_control = 0
result.download_stopped_status = *status

-- 40000000H is a source descriptor address, not a CPU sample-memory pointer.
commands->source_addr = 0x40000000
for index = 1, 20 do
	command_words[index] = pcm_note_words[index]
end
commands->slot = 3
commands->cmd = 1
while (*active_mask & 0x00000008) == 0 do
end
commands->slot = 3
result.ram_selected_source = *selected_source
result.ram_active_mask = *active_mask
local ram_start<const> = *sample_sequence
while ((*sample_sequence - ram_start) & 0xffffffff) < 2205 do
end
local ram_end_sequence<const> = result.service_sequence
apu.stop_slot(3, 441)
while result.service_sequence == ram_end_sequence do
	halt_until_irq
end
result.completed_phase = 2

-- 3. A square uses fractional cursor phase: one-frame loop, source rate 440 Hz.
for index = 0, 20 do
	command_words[index] = square_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000010) == 0 do
end
commands->slot = 4
result.square_selected_source = *selected_source
result.square_active_mask = *active_mask
result.square_rate_hz = selected->sample_rate_hz
result.square_duty = selected->generator_duty_q12
local square_start<const> = *sample_sequence
while ((*sample_sequence - square_start) & 0xffffffff) < 2205 do
end
local square_end_sequence<const> = result.service_sequence
apu.stop_slot(4, 441)
while result.service_sequence == square_end_sequence do
	halt_until_irq
end
result.completed_phase = 3

-- 4. tone.wav is normally packed as BADP. Read its central header type in ROM.
local header<const>: *badp_header = assets.audio_tone_addr
result.badp_address = assets.audio_tone_addr
result.badp_bytes = assets.audio_tone_len
result.badp_version = header->version
result.badp_channels = header->channels
result.badp_sample_rate_hz = header->sample_rate_hz
result.badp_frames = header->frame_count
result.badp_data_offset = header->data_offset
result.badp_seek_count = header->seek_entry_count
result.badp_seek_offset = header->seek_table_offset
commands->source_addr = assets.audio_tone_addr
commands->source_bytes = assets.audio_tone_len
commands->sample_rate_hz = header->sample_rate_hz
commands->channels = header->channels
commands->bits_per_sample = 4
commands->frame_count = header->frame_count
commands->data_offset = header->data_offset
commands->data_bytes = assets.audio_tone_len - header->data_offset
-- This authored one-shot has no loop; neither field is inferred by the APU.
commands->loop_start_sample = 0
commands->loop_end_sample = 0
commands->slot = 5
commands->rate_step_q16 = 0x00010000
commands->gain_q12 = 0x00000800
commands->start_sample = 0
commands->filter_control = 0
commands->filter_b0_b1 = 0x00004000
commands->filter_b2_a1 = 0
commands->filter_a2 = 0
commands->fade_samples = 0
commands->generator_kind = 0
commands->generator_duty_q12 = 0x00000800
local badp_end_sequence<const> = result.service_sequence
commands->cmd = 1
while (*active_mask & 0x00000020) == 0 do
end
commands->slot = 5
result.badp_selected_source = *selected_source
result.badp_active_mask = *active_mask
while result.service_sequence == badp_end_sequence do
	halt_until_irq
end
result.final_active_mask = *active_mask
result.final_status = *status
result.final_fault_code = *fault_code
result.final_fault_detail = *fault_detail
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 4
while true do
	halt_until_irq
end
