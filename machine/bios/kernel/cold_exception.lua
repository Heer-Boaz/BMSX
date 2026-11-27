-- This vector can run before managed program bindings exist. Only the
-- CPU's raw exception words and ordinary SYSTEM commands are available.
local exception_report<const> = require('kernel/exception_report')

if exception_report.report(cop0.cause) then return end
while true do halt_until_irq end
