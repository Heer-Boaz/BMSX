local read_u16le<const> = function(addr)
	return mem8[addr] | (mem8[addr + 1] << 8)
end

return {
    read_u16le = read_u16le,
}
