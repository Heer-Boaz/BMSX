require('base')
local p<const> = require('string/pack')
local s<const> = require('string/base')
local packed<const> =p.pack('<jJni8I8',0x80000000,-1,2.0,-1,-1)
local a,b,c,d,e,pos=p.unpack('<jJni8I8',packed)
return a,b,blua32.float_bits(c),d,e,pos,p.packsize('jJn'),packed,
p.pack('>d',16777217),p.pack('>f',0x7fffffff),p.pack('>f',blua32.float_from_bits(0xffa12345)),
blua32.float_bits(p.unpack('>d',s.char(0x3f,0xf0,0,0,0x10,0,0,1))),
blua32.float_bits(p.unpack('>f',s.char(0xff,0xa1,0x23,0x45)))
