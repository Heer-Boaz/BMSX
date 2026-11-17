require('base')
local api<const> = require('compiler/api')
local chunk<const>, message<const> = api.load([=[
return 2,2.0,2e0,-0.0,0.0,-0,0x80000000,2147483648,-2147483648,
0xffffffff,0x1.8p+2,0x.8p-1,0x1.000001000000000000001p0,
1.00000005960464477539062500000001,
1.00000005960464477539062499999999
]=])
assert(chunk,message)
local flow<const> = assert(api.load([=[
local count = 0
for i=1,3 do count=count+i end
local total=0.0
while count>0 do total=total+0.5;count=count-1 end
if count==0 then return total,0x80000000 else return -1 end
]=]))
local total<const>,word<const> = flow()
return total,word,chunk()
