require('bios/string_base')

local pattern<const> = require('bios/string_pattern')
string.find = pattern.find
string.match = pattern.match
string.gsub = pattern.gsub
string.gmatch = pattern.gmatch



local format<const> = require('bios/string_format')
string.format = format.format

local pack<const> = require('bios/string_pack')
string.pack = pack.pack
string.packsize = pack.packsize
string.unpack = pack.unpack

return string
