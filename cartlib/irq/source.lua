module<const>

-- Physical interrupt-controller source bits. As a const module these words are
-- embedded directly at each registration and datapath use.
return {
	dma0_done = 0x0001,
	vblank = 0x0004,
	geo_done = 0x0008,
	geo_error = 0x0010,
	apu = 0x0020,
	gpu = 0x0040,
	imgdec = 0x0080,
	dma1_done = 0x0100,
	cartridge_slot0 = 0x0200,
	cartridge_slot1 = 0x0400,
}
