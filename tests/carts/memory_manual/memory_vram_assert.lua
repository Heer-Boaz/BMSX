local system_vram_region<const> = require('gpu/system_vram_region')

return {
	kind = 'unit',
	tests = {
		firmware_vram_query = function(t)
			local origin<const>, size<const> = system_vram_region()
			-- Observed current firmware assets, not a permanent hardware extent.
			assert(origin == 0x02d002c0)
			assert(size == 0x00fc0140)
			t:log('current BIOS query: origin02d002c0,size00fc0140; x704 Word-columns,y720 rows,width320,height252; query is not release')
		end,
	},
}
