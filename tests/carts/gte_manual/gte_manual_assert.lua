local data<const>: *word[32] = 0x08010244
local control<const>: *word[32] = 0x080102c4
local command<const>: *word = 0x08010344
local framebuffer<const>: *word = 0x0801035c

return {
	kind = 'integration',
	tests = {
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
