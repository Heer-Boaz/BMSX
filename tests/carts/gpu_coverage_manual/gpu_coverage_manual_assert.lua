local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

-- Relative Y, last once-written X, last twice-written X, all inclusive.
-- Literal bounds come from the triangle edge equations, not a capture.
rodata overlap_rows: word[6][3] = {
	{ 0, 95, 95 },
	{ 1, 90, 92 },
	{ 8, 55, 71 },
	{ 16, 15, 47 },
	{ 24, 7, 23 },
	{ 31, 0, 2 },
}

return {
	kind = 'integration',
	tests = {
		shared_polygon_edge_and_polyline_joint = function(t)
			t:wait_ticks(3)
			assert((*gp1 & 0x0d000000) == 0x04000000)
			t:capture('gpu-manual-shared-polygon-edge-and-polyline-joint')

			-- Six complete 96-pixel rows from each quad's comparison box.
			for row = 0, #overlap_rows - 1 do
				for panel = 0, 1 do
					*gp0 = 0xc0000000
					*gp0 = (16 + panel * 128) | ((24 + overlap_rows[row][0]) << 16)
					*gp0 = 96 | (1 << 16)
					t:wait_until('coverage row ready', function()
						return (*gp1 & 0x08000000) ~= 0
					end, 3)
					for pair = 0, 47 do
						local expected = 0x110c110c
						if panel == 1 then
							local low = 0
							local high = 0
							if pair * 2 <= overlap_rows[row][1] then
								low = 0x110c
							elseif pair * 2 <= overlap_rows[row][2] then
								low = 0x2218
							end
							if pair * 2 + 1 <= overlap_rows[row][1] then
								high = 0x110c
							elseif pair * 2 + 1 <= overlap_rows[row][2] then
								high = 0x2218
							end
							expected = low | (high << 16)
						end
						assert(*gp0 == expected)
					end
					assert((*gp1 & 0x08000000) == 0)
				end
			end

			-- One complete 97-pixel polyline row, including the zero high tail.
			*gp0 = 0xc0000000
			*gp0 = 16 | (124 << 16)
			*gp0 = 97 | (1 << 16)
			t:wait_until('polyline joint row ready', function()
				return (*gp1 & 0x08000000) ~= 0
			end, 3)
			for pair = 0, 47 do
				if pair == 24 then
					assert(*gp0 == 0x110c2218)
				else
					assert(*gp0 == 0x110c110c)
				end
			end
			assert(*gp0 == 0x0000110c)
			assert((*gp1 & 0x08000000) == 0)
			t:log('12 complete quad rows and one 97-pixel joint row matched: 625 GPUREAD words, black uncovered samples, doubled material, and zero odd high tail')
		end,
	},
}
