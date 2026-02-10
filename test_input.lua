local function to_signed_16(val)
val = val & 0xFFFF
return (val >= 0x8000) and (val - 0x10000) or val
end

local function to_unsigned_16(val)
return val & 0xFFFF
end

-- Simulate basic ground walk logic
local current = 0
local target = 0x0200 -- Right walk
local profile_3_divisor = 64

print(string.format("Start: current=%d, target=%d", current, target))
for i=1,10 do
    local delta = target - current
    local abs_delta = math.abs(delta)
    local step = math.floor(abs_delta / 64) -- data_bfb255_profile(3, ...)
    if step == 0 then current = target else current = current + step end
    print(string.format("Step %d: current=%d", i, current))
end

-- Simulate ground stop (Neutral)
print("\nStopping (Neutral):")
target = 0
for i=1,150 do
    local delta = target - current
    local abs_delta = math.abs(delta)
    local step = math.floor(abs_delta / 64)
    if step == 0 then 
        current = target 
        print(string.format("Step %d: SNAPPED to 0!", i))
        break
    else 
        current = current + (delta < 0 and -step or step)
    end
    if i % 10 == 0 then print(string.format("Step %d: current=%d", i, current)) end
end
