return {
	kind = 'unit',
	tests = {
		format_char_call_results = function()
			local nul<const> = string.format('%c', 0)
			local letter<const> = string.format('%c', 65)
			print('Format c counts', #nul, string.byte(nul, 1), string.byte(nul, 2),
				#letter, string.byte(letter, 1), string.byte(letter, 2))
			print('Direct char count', #string.char(0), #string.char((math.modf(0))))
			print('Grouped result counts', select('#', (math.modf(0))),
				select('#', math.modf(0)))
			assert(#nul == 2 and string.byte(nul, 1) == 0 and string.byte(nul, 2) == 0)
			assert(#letter == 2 and string.byte(letter, 1) == 65 and string.byte(letter, 2) == 0)
			assert(#string.char(0) == 1 and #string.char((math.modf(0))) == 2)
			assert(select('#', (math.modf(0))) == 2)
			assert(select('#', math.modf(0)) == 2)
			local fractional<const> = string.format('%c', 65.75)
			assert(#fractional == 2 and string.byte(fractional, 1) == 65 and string.byte(fractional, 2) == 0)
			local padded<const> = string.format('%3c', 65)
			assert(#padded == 3 and string.byte(padded, 1) == 32
				and string.byte(padded, 2) == 65 and string.byte(padded, 3) == 0)
		end,
	},
}
