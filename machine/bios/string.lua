local ids<const> = require('kernel/heap_control_ids')
local string<const> = require('string/base')

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

blua32.svc_value(ids.string_index, string)

return string
