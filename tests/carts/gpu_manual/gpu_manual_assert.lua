local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local framebuffer<const>: *word = 0x0801035c

rodata probes: word[20][3] = {
	{ 16, 24, 0x001f },
	{ 96, 24, 0x000f },
	{ 140, 24, 0x03e0 },
	{ 138, 68, 0x7fef },
	{ 59, 84, 0x8000 },
	{ 78, 84, 0x0c41 },
	{ 24, 112, 0x001f },
	{ 26, 114, 0x7fff },
	{ 26, 115, 0x8000 },
	{ 27, 115, 0x0c41 },
	{ 50, 150, 0x3114 },
	{ 90, 150, 0x2194 },
	{ 200, 150, 0x8218 },
	{ 220, 165, 0xe200 },
	{ 16, 180, 0x001f },
	{ 31, 180, 0x03e0 },
	{ 46, 180, 0x7c00 },
	{ 61, 180, 0x0c41 },
	{ 76, 180, 0x8000 },
	{ 91, 180, 0x7fff },
}

return {
	kind = 'integration',
	tests = {
		texture_materials_and_counted_readback = function(t)
			t:wait_ticks(3)
			assert(*framebuffer == 0x000fa000)
			assert((*gp1 & 0x0d000000) == 0x04000000)
			-- Cart consumed the odd tail; neither upload nor marker changes GPUREAD.
			assert(*gp0 == 0x000003e0)
			t:capture('gpu-manual-texture-materials-and-masks')

			-- The cart copied its two readback words into an odd-width upload.
			*gp0 = 0xc0000000
			*gp0 = 16 | (112 << 16)
			*gp0 = 3 | (1 << 16)
			t:wait_until('three-pixel witness ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			assert(*gp0 == 0x001f001f)
			assert(*gp0 == 0x000003e0)
			assert((*gp1 & 0x08000000) == 0)

			for index = 0, #probes - 1 do
				*gp0 = 0xc0000000
				*gp0 = probes[index][0] | (probes[index][1] << 16)
				*gp0 = 0x00010001
				t:wait_until('material or mask pixel ready', function()
					return (*gp1 & 0x08000000) ~= 0
				end, 3)
				assert(*gp0 == probes[index][2])
			end
		end,
	},
}
