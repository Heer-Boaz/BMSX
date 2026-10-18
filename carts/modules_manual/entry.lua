module<entry>

local state<const> = require('results')
local settings<const> = require('lib/settings')
local result<const>: *modules_manual_result = state.result

-- Constructors run during startup, before these entry statements.
result.entry_counter_loads = result.counter_loads
result.entry_false_loads = result.false_loads
result.entry_nil_loads = result.nil_loads

local first<const> = require('lib/counter')
local second<const> = require('lib/counter')
result.same_module = first == second and 1 or 0
result.initial_global_nil = modules_manual_step == nil and 1 or 0
modules_manual_step = 2
result.first_step = modules_manual_step
result.first_value = first.advance(settings.step)
modules_manual_step = 4
result.second_value = second.advance(4)

local false_first<const> = require('lib/false_export')
local false_second<const> = require('lib/false_export')
local nil_first<const> = require('lib/nil_export')
local nil_second<const> = require('lib/nil_export')
result.false_exports = false_first ~= nil and not false_first
	and false_second ~= nil and not false_second and 1 or 0
result.nil_exports = nil_first == nil and nil_second == nil and 1 or 0

do
	local modules_manual_step<const> = 99
	result.local_shadow = modules_manual_step
	result.shadow_value = first.advance(1)
end
result.global_after_shadow = modules_manual_step
modules_manual_step = 5
result.changed_global = modules_manual_step
result.final_value = second.advance(2)

print('Modules startup', result.entry_counter_loads,
	result.entry_false_loads, result.entry_nil_loads)
print('Modules dependency', result.nil_seen_from_false)
print('Modules sharing', result.same_module, result.first_value,
	result.second_value, result.counter_loads)
print('Modules exports', result.false_exports, result.nil_exports,
	result.false_loads, result.nil_loads)
print('Modules globals', result.initial_global_nil, result.first_step,
	result.local_shadow, result.shadow_value, result.global_after_shadow,
	result.changed_global, result.final_value)
result.completed = 1

while true do
	halt_until_irq
end
