local read_u16le<const> = function(addr)
	local source<const>: *u8 = addr
	return source[0] | (source[1] << 8)
end

local read_u32le<const> = function(addr)
	local source<const>: *u8 = addr
	return source[0]
		+ source[1] * 0x100
		+ source[2] * 0x10000
		+ source[3] * 0x1000000
end

return {
	read_u16le = read_u16le,
	read_u32le = read_u32le,
}
