module<entry>

local state<const> = require('results')
local result<const>: *cpu_irq_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local system_status<const>: *word = 0x08010350

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		*irq_mask = 0
		result.status = cop0.status
		result.cause = cop0.cause
		result.epc = cop0.epc
		result.system_status = *system_status
		result.flags = flags
		*irq_ack = 0x00000004
		result.services = result.services + 1
	end
end

-- Fresh BIOS cartridge entry; keep the running beam and own this IRQ route.
*irq_mask = 0
*irq_ack = 0x00000004
*irq_mask = 0x00000004
while result.services == 0 do
	halt_until_irq
end

-- The callback returns normally; its generated vector performs RFE.
result.resumed = 1
print(string.format(
	'IRQ CP0 STATUS=%08X CAUSE=%08X', result.status, result.cause))
print(string.format(
	'SYSTEM CONTEXT=%08X SERVICES=%u RESUMED=%u',
	result.system_status, result.services, result.resumed))

while true do
	halt_until_irq
end
