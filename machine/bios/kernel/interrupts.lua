module<const>

bss bios_dma_completion_sequence: word
bss bios_vblank_count: word

return {
	dma_completion_sequence = bios_dma_completion_sequence,
	vblank_count = bios_vblank_count,
	dma_done = 0x0001,
}
