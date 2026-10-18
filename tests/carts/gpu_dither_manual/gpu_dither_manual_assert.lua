local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

rodata probe_origins: word[5] = {
	16 | (24 << 16),
	144 | (24 << 16),
	16 | (112 << 16),
	144 | (112 << 16),
	640,
}
rodata expected_words: word[5][8] = {
	{ 0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6,
	  0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6 },
	{ 0x40e63cc6, 0x40e63cc6, 0x40c640e7, 0x40c640e7,
	  0x40e63cc6, 0x40e63cc6, 0x40c640e7, 0x40c640e7 },
	{ 0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6,
	  0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6 },
	{ 0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6,
	  0x40e640e6, 0x40e640e6, 0x40e640e6, 0x40e640e6 },
	{ 0x35273527, 0x35273527, 0x35273527, 0x35273527,
	  0x35273527, 0x35273527, 0x35273527, 0x35273527 },
}

return {
	kind = 'integration',
	tests = {
		polygon_dither_and_rectangle_controls = function(t)
			t:wait_ticks(3)
			assert((*gp1 & 0x0d000000) == 0x04000000)
			t:capture('gpu-manual-polygon-dither-and-rectangle-controls')
			for probe = 0, #probe_origins - 1 do
				*gp0 = 0xc0000000
				*gp0 = probe_origins[probe]
				*gp0 = 4 | (4 << 16)
				t:wait_until('dither sample block ready', function()
					return (*gp1 & 0x08000000) ~= 0
				end, 3)
				for index = 0, 7 do
					assert(*gp0 == expected_words[probe][index])
				end
				assert((*gp1 & 0x08000000) == 0)
			end
		end,
	},
}
