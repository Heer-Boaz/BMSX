module<const>

-- Source basis: a7e9ec46981f0ddaa0c35b640a75a09927aeb104.
-- T/C/H are StringPool's TS/C++ owners; I/J are the String header
-- constants, and M is the memory map. The service read port resolves
-- System ROM addresses and uses bit 31 to select the cartridge socket.
local ram_base<const> = 0x08000000 -- M:6
local cart_rom_base<const> = 0x10000000 -- M:10,12
local ram_word_mask<const> = 0x003ffffc -- T:37,81 C:55 M:7-9
local ram_byte_mask<const> = 0x003fffff -- T:27,37,87,90 C:62,67 M:7
local length_offset<const> = 8 -- T:86 C:61 I:60 J:66
local header_bytes<const> = 16 -- T:90-91 C:66,69 I:56 J:62

local is_ram_string_id<const> = function(id) -- T:34 H:17
	-- A negative Integer is an unsigned address carrying socket bit 31.
	return id >= ram_base and id < cart_rom_base -- T:34 H:17
end

local byte_length<const> = function(id) -- T:85 C:60
	local in_ram<const> = is_ram_string_id(id) -- T:81,87 C:55,62
	local field<const> = id + length_offset -- T:81-82,86 C:55-57,61
	local length<const>: *u32 = in_ram and ram_base + (field & ram_word_mask) or field -- T:35-38,75-82 C:34-36,49-57; ROM bank decode stays in the read port
	local count<const> = *length -- T:81-82,86 C:55-57,61
	return in_ram and (count & ram_byte_mask) or count -- T:87 C:62; u32 load already preserves the signed Integer view for ROM
end

local byte_at<const> = function(id, index) -- T:89 C:65
	local field<const> = id + header_bytes + index -- T:90-91 C:66,69
	local address<const>: *u8 = is_ram_string_id(id) and ram_base + (field & ram_byte_mask) or field -- T:35-38,75-78,90-91 C:34-36,49-51,67-69
	return *address -- T:90-91 C:67-70
end

return {
	is_ram_string_id = is_ram_string_id,
	byte_length = byte_length,
	byte_at = byte_at,
}
