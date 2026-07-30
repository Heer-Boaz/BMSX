local read_u16le<const> = function(addr)
	return mem8[addr] | (mem8[addr + 1] << 8)
end

local read_u32le<const> = function(addr)
	return mem8[addr]
		+ mem8[addr + 1] * 0x100
		+ mem8[addr + 2] * 0x10000
		+ mem8[addr + 3] * 0x1000000
end

return {
	read_u16le = read_u16le,
	read_u32le = read_u32le,
}
