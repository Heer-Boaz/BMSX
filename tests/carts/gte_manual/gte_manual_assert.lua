local gte<const> = require('cartlib/gx/gte')

rodata signed_positions: gte_vector[3] = {
	{ x = -64, y = -64, z = 512, pad = 0 },
	{ x = 64, y = -64, z = 512, pad = 0 },
	{ x = 0, y = 64, z = 512, pad = 0 },
}
rodata ordered_transform: gte_transform = {
	rotation = {
		rows = { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 } },
		pad = 0,
	},
	translation = { -1, 2, -3 },
}

local data<const>: *word[32] = 0x08010244
local control<const>: *word[32] = 0x080102c4
local command<const>: *word = 0x08010344
local framebuffer<const>: *word = 0x0801035c

return {
	kind = 'integration',
	tests = {
		static_operand_layout = function(t)
			assert(sizeof(gte_vector) == 8)
			assert(offsetof(gte_vector.z) == 4)
			assert(offsetof(gte_vector.pad) == 6)
			assert(sizeof(gte_matrix) == 20)
			assert(offsetof(gte_matrix.pad) == 18)
			assert(sizeof(gte_transform) == 32)
			assert(offsetof(gte_transform.translation) == 20)
			assert(sizeof(gte_projection) == 20)
			assert(offsetof(gte_projection.cue_offset) == 16)
			local positions<const>: *word = signed_positions
			assert(positions[0] == 0xffc0ffc0)
			assert(positions[1] == 0x00000200)
			assert(positions[2] == 0xffc00040)
			assert(positions[3] == 0x00000200)
			assert(positions[4] == 0x00400000)
			assert(positions[5] == 0x00000200)
			local transform<const>: *word = ordered_transform
			assert(transform[0] == 0x00020001)
			assert(transform[1] == 0x00040003)
			assert(transform[2] == 0x00060005)
			assert(transform[3] == 0x00080007)
			assert(transform[4] == 0x00000009)
			assert(transform[5] == 0xffffffff)
			assert(transform[6] == 0x00000002)
			assert(transform[7] == 0xfffffffd)
		end,
		geometry_color_and_buffer_lifetime = function(t)
			t:wait_ticks(2)
			assert(data[12] == 0x00400060)
			assert(data[13] == 0x004000a0)
			assert(data[14] == 0x00800080)
			assert(data[20] == 0x000000a0)
			assert(data[21] == 0x00008000)
			assert(data[22] == 0x00400000)
			assert(data[24] == 0x00001000)
			assert(control[31] == 0)
			t:capture('gte-manual-initial-triangle')
			local first<const> = *framebuffer
			assert(first == 0x000fa000 or first == 0x000fa040)
			t:wait_until('next framebuffer', function() return *framebuffer ~= first end, 3)
			t:wait_until('translated triangle', function() return control[5] == 32 end, 40)
			assert(data[12] == 0x00400070)
			assert(data[13] == 0x004000b0)
			assert(data[14] == 0x00800090)
			t:wait_ticks(1)
			t:capture('gte-manual-translated-triangle')

			-- A reversed winding reads back as a raw unsigned word, not -4096.
			local xy1<const> = data[13]
			data[13] = data[14]
			data[14] = xy1
			*command = 0x00000006
			assert(data[24] == 0xfffff000)
			assert((data[24] & 0x80000000) ~= 0)
			assert(control[31] == 0)
		end,
	},
}
