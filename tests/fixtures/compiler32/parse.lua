require('base')
local parse<const> = require('number/parse')
return tonumber('2147483647'),tonumber('-2147483648'),tonumber('2147483648'),
tonumber('-2147483649'),tonumber('0xffffffff'),tonumber('-ffffffff',16),
tonumber('-0'),tonumber('-0.0'),tonumber('2'),tonumber('2.0'),tonumber('1e39'),
tonumber('-1e-1000'),tonumber('1.00000005960464477539062500000001'),
tonumber('1.00000005960464477539062499999999'),tonumber('1.000000178813934326171875'),
parse.literal('0x1.000001000000000000001p0'),parse.literal('0x1.000001p0'),
parse.literal('0x1p-150'),parse.literal('0x1.000000000000001p-150'),
parse.literal('0x1.ffffffp127')
