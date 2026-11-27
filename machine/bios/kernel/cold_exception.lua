-- This vector can run before managed program bindings exist. Only the
-- CPU's raw exception words and ordinary SYSTEM commands are available.
local control<const>: *word = 0x0801034c
local nmi<const> = 0x00010000
local enter<const>, leave<const> = 0x02, 0x04
local fault<const>, publish<const> = 0x08, 0x10

if (cop0.cause & nmi) ~= 0 then
	-- A SYSTEM-key request has quiesced the running devices. Complete
	-- its entry and leave in one write before retrying the boot opcode.
	*control = enter | leave
	return
end

-- Capture the raw cause, EPC, address, reason and domain before making
-- the report visible. Do not reissue the failing boot instruction.
*control = fault | publish
while true do halt_until_irq end
