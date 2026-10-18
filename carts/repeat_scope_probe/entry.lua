module<entry>

-- This owned name distinguishes a global read from the body-local read.
setglobal('repeat_scope_probe_ready', true)
local passes = 0
repeat
	passes += 1
	local repeat_scope_probe_ready<const> = passes >= 3
until repeat_scope_probe_ready

print('Repeat scope', passes)

while true do
	halt_until_irq
end
