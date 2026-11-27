local byte<const> = __bmsx_string_byte
local byte_char<const> = require('string/char')
local tointeger<const> = __bmsx_tointeger

local encode<const> = function(value)
	local code<const> = tointeger(value)
	if code == nil or code < 0 or code > 0x10ffff or code >= 0xd800 and code <= 0xdfff then
		error('Invalid Unicode scalar.')
	end
	if code < 0x80 then return byte_char(code) end
	if code < 0x800 then return byte_char(0xc0 | (code >> 6), 0x80 | (code & 0x3f)) end
	if code < 0x10000 then
		return byte_char(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
	end
	return byte_char(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
		0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
end

local char<const> = function(...)
	local count<const> = select('#', ...)
	if count == 1 then return encode(...) end
	local text = ''
	for index = 1, count do
		text = text .. encode(select(index, ...))
	end
	return text
end

-- Text projection for display and layout. Invalid bytes are not rewritten
-- in the source string. An invalid lead consumes one byte.
local read<const> = function(text, position, last)
	local lead<const> = byte(text, position)
	if lead < 0x80 then return lead, position + 1 end
	local count, code, minimum
	if lead >= 0xc2 and lead <= 0xdf then
		count, code, minimum = 1, lead & 0x1f, 0x80
	elseif lead >= 0xe0 and lead <= 0xef then
		count, code, minimum = 2, lead & 0x0f, 0x800
	elseif lead >= 0xf0 and lead <= 0xf4 then
		count, code, minimum = 3, lead & 0x07, 0x10000
	else
		return 0xfffd, position + 1
	end
	if position + count > last then return 0xfffd, position + 1 end
	for index = 1, count do
		local continuation<const> = byte(text, position + index)
		if (continuation & 0xc0) ~= 0x80 then return 0xfffd, position + 1 end
		code = (code << 6) | (continuation & 0x3f)
	end
	if code < minimum or code > 0x10ffff or code >= 0xd800 and code <= 0xdfff then
		return 0xfffd, position + 1
	end
	return code, position + count + 1
end

local count<const> = function(text)
	local last<const> = #text
	local length, position = 0, 1
	while position <= last do
		if byte(text, position) < 0x80 then
			position = position + 1
		else
			local _<const>, next_position<const> = read(text, position, last)
			position = next_position
		end
		length = length + 1
	end
	return length
end

return { char = char, read = read, count = count }
