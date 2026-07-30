local set_string_index<const> = __bmsx_set_string_index
local string<const> = require('stdlib/string_base')

local pattern<const> = require('stdlib/string_pattern')
string.find = pattern.find
string.match = pattern.match
string.gsub = pattern.gsub
string.gmatch = pattern.gmatch



local format<const> = require('stdlib/string_format')
string.format = format.format

local pack<const> = require('stdlib/string_pack')
string.pack = pack.pack
string.packsize = pack.packsize
string.unpack = pack.unpack

set_string_index(string)

return string
