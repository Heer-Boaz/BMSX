module<entry>

local state<const> = require('results')
local result<const>: *imgdec_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma0<const>: *imgdec_manual_dma_registers = 0x0800000c
local dma1<const>: *imgdec_manual_dma_registers = 0x080103e4
local decoder<const>: *imgdec_manual_registers = 0x080103fc
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

-- Header: twelve texture words and eight CLUT words. Tokens: literal two,
-- repeat two, back-reference four at distance four, zero four, literal eight.
rodata stream: word[19] = {
	0x31444d49, 0x0000000c, 0x00000008,
	0x00000001, 0x11112222, 0x33334444,
	0x40000001, 0x55556666, 0x80001003, 0xc0000003,
	0x00000007, 0x00000000, 0x03e0001f, 0x7fff7c00, 0x42104210,
	0x001f001f, 0x03e003e0, 0x7c007c00, 0x7fff7fff,
}
-- The first payload token requests distance one before any history exists.
rodata fault_stream: word[4] = { 0x31444d49, 3, 0, 0x80000000 }
rodata recovery_stream: word[3] = { 0x31444d49, 0, 0 }

function irq(flags)
	if (flags & 0x00000001) ~= 0 then
		result.dma0_sequence = result.dma0_sequence + 1
	end
	if (flags & 0x00000100) ~= 0 then
		result.dma1_sequence = result.dma1_sequence + 1
	end
	if (flags & 0x00000080) ~= 0 then
		result.decoder_sequence = result.decoder_sequence + 1
	end
	*irq_ack = flags & 0x00000181
end

-- Exclusive ownership: DMA0, DMA1 and IMGDEC; no cartlib IRQ handler.
*irq_mask = 0
*irq_ack = 0x00000181
*irq_mask = 0x00000181

-- 1. Both DREQ-gated channels are armed before IMGDEC START. The output
-- endpoint increments through a separate BSS array, not through MMIO.
local ram_dma0_sequence<const> = result.dma0_sequence
local ram_dma1_sequence<const> = result.dma1_sequence
local ram_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #stream
decoder->texture_destination = 0x00400040
decoder->texture_size = 0x00060004
decoder->clut_destination = 0x00800040
dma1->read_address = 0x08010414
dma1->write_address = &result.ram_output[0]
dma1->count = 26
dma1->control = 0x00003c1a
dma1->trigger = 1
dma0->read_address = stream
dma0->write_address = 0x08010414
dma0->count = #stream
dma0->control = 0x00003d41
dma0->trigger = 1
result.phases[0].armed_status[0] = dma0->status
result.phases[0].armed_status[1] = dma1->status
decoder->control = 1
while result.dma0_sequence == ram_dma0_sequence
	or result.dma1_sequence == ram_dma1_sequence do
	halt_until_irq
end
while result.decoder_sequence == ram_decoder_sequence do
	halt_until_irq
end
result.phases[0].status = decoder->status
result.phases[0].received = decoder->input_words_received
result.phases[0].decoded = decoder->decoded_word_count
result.phases[0].dma_count[0] = dma0->count
result.phases[0].dma_count[1] = dma1->count
result.phases[0].dma_status[0] = dma0->status
result.phases[0].dma_status[1] = dma1->status
result.phases[0].sequences[0] = result.dma0_sequence
result.phases[0].sequences[1] = result.dma1_sequence
result.phases[0].sequences[2] = result.decoder_sequence
result.completed_phase = 1

-- 2. Repeat the same readonly source, now with fixed GP0 as the output.
-- No previous GP0 packet/readback is in flight; E6 disables mask protection.
while (*gp1 & 0x04000000) == 0 do
end
*gp0 = 0xe6000000
*gp1 = 0x04000002
while (*gp1 & 0x04000000) == 0 do
end
result.gpu_initial_status = *gp1
local gpu_dma0_sequence<const> = result.dma0_sequence
local gpu_dma1_sequence<const> = result.dma1_sequence
local gpu_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #stream
decoder->texture_destination = 0x00400040
decoder->texture_size = 0x00060004
decoder->clut_destination = 0x00800040
dma1->read_address = 0x08010414
dma1->write_address = 0x0801023c
dma1->count = 26
dma1->control = 0x00003c58
dma1->trigger = 1
dma0->read_address = stream
dma0->write_address = 0x08010414
dma0->count = #stream
dma0->control = 0x00003d41
dma0->trigger = 1
result.phases[1].armed_status[0] = dma0->status
result.phases[1].armed_status[1] = dma1->status
decoder->control = 1
while result.dma0_sequence == gpu_dma0_sequence
	or result.dma1_sequence == gpu_dma1_sequence do
	halt_until_irq
end
while result.decoder_sequence == gpu_decoder_sequence do
	halt_until_irq
end
while (*gp1 & 0x04000000) == 0 do
end
result.gpu_idle_status = *gp1
result.phases[1].status = decoder->status
result.phases[1].received = decoder->input_words_received
result.phases[1].decoded = decoder->decoded_word_count
result.phases[1].dma_count[0] = dma0->count
result.phases[1].dma_count[1] = dma1->count
result.phases[1].dma_status[0] = dma0->status
result.phases[1].dma_status[1] = dma1->status
result.phases[1].sequences[0] = result.dma0_sequence
result.phases[1].sequences[1] = result.dma1_sequence
result.phases[1].sequences[2] = result.decoder_sequence
result.completed_phase = 2

-- 3. CPU-only invalid back-reference: neither DMA channel is armed. In
-- particular, there is no output channel left waiting for an impossible DREQ.
local fault_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #fault_stream
decoder->texture_destination = 0x00400040
decoder->texture_size = 0x00060004
decoder->clut_destination = 0x00800040
decoder->control = 1
for index = 0, #fault_stream - 1 do
	decoder->data = fault_stream[index]
end
while result.decoder_sequence == fault_decoder_sequence do
	halt_until_irq
end
result.phases[2].status = decoder->status
result.phases[2].received = decoder->input_words_received
result.phases[2].decoded = decoder->decoded_word_count
result.phases[2].dma_count[0] = dma0->count
result.phases[2].dma_count[1] = dma1->count
result.phases[2].dma_status[0] = dma0->status
result.phases[2].dma_status[1] = dma1->status
-- FORMAT_FAULT leaves the already-published A0 header readable. An empty
-- DATA read retains the last word; it does not restart or complete the stream.
for index = 0, 2 do
	result.fault_header[index] = decoder->data
end
result.fault_retained_read = decoder->data
result.phases[2].sequences[0] = result.dma0_sequence
result.phases[2].sequences[1] = result.dma1_sequence
result.phases[2].sequences[2] = result.decoder_sequence
result.completed_phase = 3

-- 4. START replaces the faulted stream. A minimal valid stream still emits
-- its three-word texture header, into a distinct BSS destination.
local recovery_dma0_sequence<const> = result.dma0_sequence
local recovery_dma1_sequence<const> = result.dma1_sequence
local recovery_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #recovery_stream
decoder->texture_destination = 0x00200020
decoder->texture_size = 0
decoder->clut_destination = 0
dma1->read_address = 0x08010414
dma1->write_address = &result.recovery_output[0]
dma1->count = 3
dma1->control = 0x00003c1a
dma1->trigger = 1
dma0->read_address = recovery_stream
dma0->write_address = 0x08010414
dma0->count = #recovery_stream
dma0->control = 0x00003d41
dma0->trigger = 1
result.phases[3].armed_status[0] = dma0->status
result.phases[3].armed_status[1] = dma1->status
decoder->control = 1
while result.dma0_sequence == recovery_dma0_sequence
	or result.dma1_sequence == recovery_dma1_sequence do
	halt_until_irq
end
while result.decoder_sequence == recovery_decoder_sequence do
	halt_until_irq
end
result.phases[3].status = decoder->status
result.phases[3].received = decoder->input_words_received
result.phases[3].decoded = decoder->decoded_word_count
result.phases[3].dma_count[0] = dma0->count
result.phases[3].dma_count[1] = dma1->count
result.phases[3].dma_status[0] = dma0->status
result.phases[3].dma_status[1] = dma1->status
result.phases[3].sequences[0] = result.dma0_sequence
result.phases[3].sequences[1] = result.dma1_sequence
result.phases[3].sequences[2] = result.decoder_sequence
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 4
while true do
	halt_until_irq
end
