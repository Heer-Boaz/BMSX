module<const>

struct gpu_dma_status
	phase: word
	upload_status: word
	upload_count: word
	upload_source_end: word
	upload_destination: word
	upload_gpu_status: word
	read_latch_before: word
	read_ready_status: word
	read_busy_status: word
	read_owned_latch: word
	read_status: word
	read_count: word
	read_source: word
	read_destination_end: word
	read_gpu_status: word
	marker_status: word
	idle_status: word
	final_latch: word
end

-- Initialized RAM, not a readonly cartridge-ROM DMA source.
data upload: word[44] = {
	0xa0000000, 0x00400060, 0x00090009, 0x00020001,
	0x00040003, 0x00060005, 0x00080007, 0x000a0009,
	0x000c000b, 0x000e000d, 0x0010000f, 0x00120011,
	0x00140013, 0x00160015, 0x00180017, 0x001a0019,
	0x001c001b, 0x001e001d, 0x0020001f, 0x00220021,
	0x00240023, 0x00260025, 0x00280027, 0x002a0029,
	0x002c002b, 0x002e002d, 0x0030002f, 0x00320031,
	0x00340033, 0x00360035, 0x00380037, 0x003a0039,
	0x003c003b, 0x003e003d, 0x0040003f, 0x00420041,
	0x00440043, 0x00460045, 0x00480047, 0x004a0049,
	0x004c004b, 0x004e004d, 0x0050004f, 0xffff0051,
}

bss returned: word[41]
bss status: gpu_dma_status

return { upload = upload, returned = returned, status = status }
