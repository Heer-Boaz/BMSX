local state<const> = require('results')
local result<const>: *gte_clip_result = state.result
local framebuffer<const>: *word = 0x0801035c
local gp1<const>: *word = 0x08010240

rodata screen: word[3][3] = {
	{ 0x00200080, 0x008000b0, 0x00800050 },
	{ 0x006000a0, 0x008000b0, 0x00800050 },
	{ 0x006000a0, 0x00800050, 0x00600060 },
}
rodata depth: word[3][4] = {
	{ 0, 128, 512, 512 },
	{ 512, 256, 512, 512 },
	{ 512, 256, 512, 256 },
}
rodata areas: word[3] = { 9216, 3072, 2048 }
rodata flags: word[3] = { 0x80020000, 0, 0 }
-- These are raw halfword reads, not signed coordinate conversions.
rodata quad_x: u16[4] = { 32, 96, 0xffa0, 0xffe0 }
rodata quad_y: u16[4] = { 0, 64, 64, 0 }
rodata quad_z: u16[4] = { 256, 512, 512, 256 }

return {
	kind = 'integration',
	tests = {
		near_plane_geometry_and_display = function(t)
			t:wait_until('original triangle published', function()
				return result.completed == 1
			end, 4)
			assert(*framebuffer == 0x000fa000)
			assert(result.after_vblank[0] > result.before_vblank[0])
			assert(result.probe_words[0][0] == 0xf288)
			assert(result.probe_words[0][1] == 0xf288)
			t:wait_until('two constructed triangles published', function()
				return result.completed == 2
			end, 8)
			for sample = 0, 2 do
				for vertex = 0, 2 do
					assert(result.screen[sample][vertex] == screen[sample][vertex])
				end
				for index = 0, 3 do
					assert(result.depth[sample][index] == depth[sample][index])
				end
				assert(result.projection_flags[sample] == flags[sample])
				assert(result.projection_cycles[sample] == 23)
				assert(result.ir0[sample] == 0)
				assert(result.area[sample] == areas[sample])
				assert(result.area_flags[sample] == 0)
			end
			for index = 0, 3 do
				assert(result.quad[index].x == quad_x[index])
				assert(result.quad[index].y == quad_y[index])
				assert(result.quad[index].z == quad_z[index])
				assert(result.quad[index].pad == 0)
			end
			assert(result.probe_words[1][0] == 0x8000)
			assert(result.probe_words[1][1] == 0xf288)
			assert(result.after_vblank[1] > result.before_vblank[1])
			assert(result.before_vblank[1] - result.after_vblank[0] >= 2)
			assert((result.system_origin >> 16) >= 448)
			assert(result.system_size == 0x00fc0140)
			assert(*framebuffer == 0x000fa040)
			assert((*gp1 & 0x0c000000) == 0x04000000)
			t:log('constructed D/B/C/E, all RTPT SXY/SZ/FLAG/IR0/cycle rows, NCLIP areas, raw probes, firmware exclusion and both fresh VBlanks passed; full images checked separately')
		end,
	},
}
