local set_string_index<const> = __bmsx_set_string_index
local string<const> = require('string/base')

string.from_utf8 = require('string/utf8').decode

local pattern<const> = require('string/pattern')
string.find = pattern.find
string.match = pattern.match
string.gsub = pattern.gsub
string.gmatch = pattern.gmatch



local format<const> = require('string/format')
string.format = format.format

local pack<const> = require('string/pack')
string.pack = pack.pack
string.packsize = pack.packsize
string.unpack = pack.unpack

set_string_index(string)

return string
