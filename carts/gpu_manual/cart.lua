module<entry>

local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

-- Sixteen raw RGB555/mask words, packed by the compiler into cartridge ROM.
rodata texels: u16[4][4] = {
	{ 0x001f, 0x001f, 0x03e0, 0x03e0 },
	{ 0x001f, 0x001f, 0x03e0, 0x03e0 },
	{ 0x7c00, 0x7c00, 0x7fff, 0x7fff },
	{ 0x7c00, 0x7c00, 0x8000, 0x0000 },
}

-- These are complete GP0 packets, not an array of register values.
rodata drawing_commands: word[] = {
	-- Raw textured quad. T1 selects direct16, page X=640, page Y=0.
	0x2d808080,
	16 | (24 << 16), 0,
	80 | (24 << 16), 3 | (0x010a << 16),
	16 | (88 << 16), 3 << 8,
	80 | (88 << 16), 3 | (3 << 8),
	-- Modulated quad: halve red, preserve green; blue gain 1.5 saturates.
	0x2cc08040,
	96 | (24 << 16), 0,
	160 | (24 << 16), 3 | (0x010a << 16),
	96 | (88 << 16), 3 << 8,
	160 | (88 << 16), 3 | (3 << 8),
	-- No E1 here: this rectangle inherits the preceding polygon's T1 page.
	0x65000000, 24 | (112 << 16), 0, 4 | (4 << 16),
	-- A separate RGB-interpolated triangle; no texture words.
	0x300000ff, 176 | (24 << 16),
	0x0000ff00, 240 | (24 << 16),
	0x00ff0000, 208 | (88 << 16),
	-- Two opaque rectangles, then an additive rectangle crossing both.
	0x60402020, 16 | (128 << 16), 64 | (40 << 16),
	0x60204020, 80 | (128 << 16), 64 | (40 << 16),
	0xe1000420,
	0x62202080, 48 | (144 << 16), 64 | (24 << 16),
	-- Set+check: the first rectangle marks its pixels; the second protects them.
	0xe6000003,
	0x600080c0, 176 | (128 << 16), 32 | (32 << 16),
	0x60c08000, 192 | (144 << 16), 32 | (32 << 16),
	0xe6000000,
}

bss readback_words: word[2]

function irq(flags)
	*irq_ack = flags
end

*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*display_extent = 0x000bf3ff
*gp1 = 0x09000000

-- Explicit drawing state; RESET does not clear local memory.
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000000
*gp0 = 0x02181008
*gp0 = 0
*gp0 = 256 | (192 << 16)

-- A0 header followed by eight whole-word payload stores to the SAME port.
*gp0 = 0xa0000000
*gp0 = 640
*gp0 = 4 | (4 << 16)
local texture_words<const>: *word = texels
for index = 0, sizeof(u16[4][4]) // 4 - 1 do
	*gp0 = texture_words[index]
end
for index = 0, #drawing_commands - 1 do
	*gp0 = drawing_commands[index]
end

-- Three pixels produce two reads. The final read has a zero high half.
*gp0 = 0xc0000000
*gp0 = 640
*gp0 = 3 | (1 << 16)
while (*gp1 & 0x08000000) == 0 do
end
readback_words[0] = *gp0
readback_words[1] = *gp0

-- Re-upload those exact words as a three-pixel witness at (16,112).
*gp0 = 0xa0000000
*gp0 = 16 | (112 << 16)
*gp0 = 3 | (1 << 16)
for index = 0, #readback_words - 1 do
	*gp0 = readback_words[index]
end

-- IRQ is an in-order marker, not an idle or display acknowledgement.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000040
while (*gp1 & 0x04000000) == 0 do
end
*pmode = 0x0000ff21
*irq_ack = 0xffffffff
*irq_mask = 0x00000004
while true do
	halt_until_irq
end
