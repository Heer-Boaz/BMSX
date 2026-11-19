local char<const> = __bmsx_string_char
local table_lib<const> = require('table')
local concat<const> = table_lib.concat
local unpack<const> = table_lib.unpack

local bytes_per_chunk<const> = 256

local from_bytes<const> = function(address, byte_count)
	local bytes<const> = {}
	local chunks
	local source: *u8 = address
	while byte_count > bytes_per_chunk do
		for index = 1, bytes_per_chunk do
			bytes[index] = *source
			source = source + 1
		end
		if chunks == nil then chunks = {} end
		chunks[#chunks + 1] = char(unpack(bytes, 1, bytes_per_chunk))
		byte_count = byte_count - bytes_per_chunk
	end
	for index = 1, byte_count do
		bytes[index] = *source
		source = source + 1
	end
	local last<const> = char(unpack(bytes, 1, byte_count))
	if chunks == nil then return last end
	chunks[#chunks + 1] = last
	return concat(chunks)
end

return { from_bytes = from_bytes }
