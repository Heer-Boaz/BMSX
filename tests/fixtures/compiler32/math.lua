local math<const> = require('math')
local nan<const> = 0.0/0.0
return math.maxinteger, math.mininteger,
math.type(2), math.type(2.0), math.type(-0.0), math.type(nan), math.type('2'),
math.tointeger(2.0), math.tointeger(0x80000000), math.tointeger(2147483648.0),
math.tointeger(2.5), math.tointeger(nan), math.tointeger('2'),
math.abs(0x80000000), math.abs(-0.0), math.abs(-2.5),
math.floor(0x80000000), math.ceil(0x80000000), math.round(0x80000000),
math.floor(2.5), math.ceil(-2.5), math.round(-2.5), math.round(2.5),
math.round(8388607.0), math.round(8388607.5), math.floor(2147483648.0),
math.fmod(-7,3), math.fmod(7,-3), math.fmod(0x80000000,-1),
math.fmod(-1.0,1e20), math.fmod(7.0,-3), math.fmod(-0.0,3),
math.ult(0,-1), math.ult(-1,0), math.sign(nan),
math.sqrt(0), math.sqrt(-0.0), math.atan(-0.0), math.atan(0,0), math.atan(-0.0,-0.0), math.modf(-2.5)
