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
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

-- Raw payload: twelve texture words and eight CLUT words. Tokens: literal two,
-- repeat two, back-reference four at distance four, zero four, literal eight.
rodata stream: word[16] = {
	0x00000001, 0x11112222, 0x33334444,
	0x40000001, 0x55556666, 0x80001003, 0xc0000003,
	0x00000007, 0x00000000, 0x03e0001f, 0x7fff7c00, 0x42104210,
	0x001f001f, 0x03e003e0, 0x7c007c00, 0x7fff7fff,
}
-- The first payload token requests distance one before any history exists.
rodata fault_stream: word[1] = { 0x80000000 }
rodata recovery_stream: word[2] = { 0x40000002, 0x12345678 }

-- A purple destination makes fetched-zero transparency visible. The raw
-- palette4 quad samples only the texture and CLUT uploaded by phase 2.
rodata picture_commands: word[12] = {
	0x60602040, 320 | (72 << 16), 120 | (40 << 16),
	0x2d000000,
	320 | (72 << 16), 0x20044000,
	440 | (72 << 16), 0x0001400f,
	320 | (112 << 16), 0x00004500,
	440 | (112 << 16), 0x0000450f,
}

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

-- Keep the display off while preparing a separate framebuffer window.
-- CSR RESET supplies zero texture window and drawing offset.
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0x00000100
*display_extent = 0x000bf3ff
*gp0 = 0xe1000400
*gp0 = 0xe3000100
*gp0 = 0xe402fdff
*gp0 = 0x02181008
*gp0 = 256
*gp0 = 256 | (192 << 16)

-- Exclusive ownership: DMA0, DMA1 and IMGDEC; one interrupt handler.
-- The existing idle wait before phase 2 also orders this background fill.
*irq_ack = 0x00000181
*irq_mask = 0x00000181

-- 1. Both DREQ-gated channels are armed before IMGDEC START. The output
-- endpoint increments through a separate BSS array, not through MMIO.
local ram_dma0_sequence<const> = result.dma0_sequence
local ram_dma1_sequence<const> = result.dma1_sequence
local ram_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #stream
decoder->output_word_count = 20
dma1->write_address = &result.ram_output[0]
dma1->count = 20
dma1->control = 0x00000004
dma1->trigger = 1
dma0->read_address = stream
dma0->count = #stream
dma0->control = 0x00000003
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
*gp0 = 0xa0000000
*gp0 = 0x00400040
*gp0 = 0x00060004
decoder->input_word_count = #stream
decoder->output_word_count = 20
dma1->count = 12
dma1->control = 0x00000005
dma1->trigger = 1
dma0->read_address = stream
dma0->count = #stream
dma0->control = 0x00000003
dma0->trigger = 1
result.phases[1].armed_status[0] = dma0->status
result.phases[1].armed_status[1] = dma1->status
decoder->control = 1
while result.dma1_sequence == gpu_dma1_sequence do halt_until_irq end
*gp0 = 0xa0000000
*gp0 = 0x00800040
*gp0 = 0x00010010
dma1->count = 8
dma1->control = 0x00000005
dma1->trigger = 1
while result.dma0_sequence == gpu_dma0_sequence
	or result.dma1_sequence ~= gpu_dma1_sequence + 2 do
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
decoder->output_word_count = 3
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
-- FORMAT_FAULT publishes no output; every DATA read retains the input token.
for index = 0, 2 do
	result.fault_reads[index] = decoder->data
end
result.fault_retained_read = decoder->data
result.phases[2].sequences[0] = result.dma0_sequence
result.phases[2].sequences[1] = result.dma1_sequence
result.phases[2].sequences[2] = result.decoder_sequence
result.completed_phase = 3

-- 4. START replaces the faulted stream and emits three repeated raw words
-- into a distinct BSS destination.
local recovery_dma0_sequence<const> = result.dma0_sequence
local recovery_dma1_sequence<const> = result.dma1_sequence
local recovery_decoder_sequence<const> = result.decoder_sequence
decoder->input_word_count = #recovery_stream
decoder->output_word_count = 3
dma1->write_address = &result.recovery_output[0]
dma1->count = 3
dma1->control = 0x00000004
dma1->trigger = 1
dma0->read_address = recovery_stream
dma0->count = #recovery_stream
dma0->control = 0x00000003
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

-- All four jobs are complete. The successful GP0 upload is still in VRAM;
-- the later fault and recovery jobs did not write GP0.
for index = 0, #picture_commands - 1 do
	*gp0 = picture_commands[index]
end
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000040
while (*gp1 & 0x04000000) == 0 do
end
*pmode = 0x0000ff21
result.final_irq_flags = *irq_flags
result.completed_phase = 4
while true do
	halt_until_irq
end
