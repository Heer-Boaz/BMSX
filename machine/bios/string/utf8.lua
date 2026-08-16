local char<const> = __bmsx_string_char
local table_lib<const> = require('table')
local concat<const> = table_lib.concat
local unpack<const> = table_lib.unpack

local codepoints_per_chunk<const> = 256

-- Converts a mapped UTF-8 byte span to the codepoint representation used by
-- BLua strings. Packed assets retain their byte encoding until this boundary.
local decode<const> = function(address, byte_count)
	local codepoints<const> = {}
	local codepoint_count = 0
	local chunks
	local source: *u8 = address
	local finish<const> = source + byte_count
	while source < finish do
		local lead<const> = *source
		source = source + 1
		local codepoint
		if lead < 0x80 then
			codepoint = lead
		elseif lead < 0xe0 then
			codepoint = ((lead & 0x1f) << 6) | (*source & 0x3f)
			source = source + 1
		elseif lead < 0xf0 then
			codepoint = ((lead & 0x0f) << 12)
				| ((*source & 0x3f) << 6)
				| (source[1] & 0x3f)
			source = source + 2
		else
			codepoint = ((lead & 0x07) << 18)
				| ((*source & 0x3f) << 12)
				| ((source[1] & 0x3f) << 6)
				| (source[2] & 0x3f)
			source = source + 3
		end
		codepoint_count = codepoint_count + 1
		codepoints[codepoint_count] = codepoint
		if codepoint_count == codepoints_per_chunk then
			if chunks == nil then
				chunks = {}
			end
			chunks[#chunks + 1] = char(unpack(codepoints, 1, codepoint_count))
			codepoint_count = 0
		end
	end
	if chunks == nil then
		return char(unpack(codepoints, 1, codepoint_count))
	end
	if codepoint_count > 0 then
		chunks[#chunks + 1] = char(unpack(codepoints, 1, codepoint_count))
	end
	return concat(chunks)
end

return {
	decode = decode,
}
