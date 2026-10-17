module<entry>

local state<const> = require('results')
local result<const>: *coroutines_manual_result = state.result

local ok<const>, sum<const>, gap<const>, difference<const> = pcall(function(a, b)
	return a + b, nil, a - b
end, 7, 3)
result.protected_values[0] = sum
result.protected_values[1] = difference
result.protected_flags[0] = ok and 1 or 0
result.protected_flags[1] = gap == nil and 1 or 0

local failure<const> = { code = 72 }
local caught<const>, object<const> = pcall(function()
	result.protected_values[2] = 77
	error(failure)
end)
result.protected_flags[2] = not caught and object == failure and 1 or 0
print('Caught object', caught, object == failure)
local nil_ok<const>, nil_error<const> = pcall(error, nil)
result.protected_flags[3] = not nil_ok and nil_error == nil and 1 or 0
print('Caught nil', nil_ok, nil_error)
local handled<const>, code<const> = xpcall(function() error(failure) end,
	function(value) return value.code * 2, 'discarded' end)
result.protected_flags[4] = not handled and code == 144 and 1 or 0
print('Handled error', handled, code)
local broken<const>, message<const> = xpcall(function() error('body') end,
	function() error('handler') end)
result.protected_flags[5] = not broken and message == 'error in error handling' and 1 or 0
print('Handler failure', broken, message)
local index_ok<const>, index_error<const> = pcall(rawget, {}, nil)
result.protected_flags[6] = not index_ok and index_error == 'Table index is nil.' and 1 or 0
print('Nil index', index_ok, index_error)
result.protected_flags[7] = result.protected_values[2] == 77 and 1 or 0

local main<const>, is_main<const> = coroutine.running()
result.thread_flags[0] = is_main and 1 or 0
result.thread_flags[1] = not coroutine.isyieldable() and 1 or 0
local producer<const> = coroutine.create(function(a, b)
	local self<const>, root<const> = coroutine.running()
	result.thread_flags[2] = coroutine.isyieldable() and 1 or 0
	result.thread_flags[3] = not root and coroutine.status(self) == 'running' and 1 or 0
	result.thread_flags[4] = coroutine.status(main) == 'normal' and 1 or 0
	local x<const>, y<const>, z<const> = coroutine.yield(a + b, nil, 'ready')
	result.thread_flags[5] = x == 17 and y == nil and z == 23 and 1 or 0
	return x + z, nil, b
end)
result.thread_flags[6] = coroutine.status(producer) == 'suspended' and 1 or 0
local first_ok<const>, first<const>, hole<const>, label<const> =
	coroutine.resume(producer, 10, 3)
result.thread_values[0] = first
result.thread_flags[7] = first_ok and hole == nil and label == 'ready' and 1 or 0
print('First resume', first_ok, first, hole, label)
result.thread_flags[8] = coroutine.status(producer) == 'suspended' and 1 or 0
local last_ok<const>, last<const>, middle<const>, original<const> =
	coroutine.resume(producer, 17, nil, 23)
result.thread_values[1] = last
result.thread_values[2] = original
result.thread_flags[9] = last_ok and middle == nil and 1 or 0
print('Final resume', last_ok, last, middle, original)
result.thread_flags[10] = coroutine.status(producer) == 'dead' and 1 or 0
local dead_ok<const>, dead_error<const> = coroutine.resume(producer)
result.thread_flags[11] = not dead_ok
	and dead_error == 'cannot resume non-suspended coroutine' and 1 or 0
print('Dead resume', dead_ok, dead_error)
result.thread_flags[12] = coroutine.close(producer) and 1 or 0
result.thread_flags[13] = coroutine.status(main) == 'running' and 1 or 0

local failed<const> = coroutine.create(function() error(failure) end)
local failed_ok<const>, failed_error<const> = coroutine.resume(failed)
result.failed_flags[0] = not failed_ok and failed_error == failure and 1 or 0
print('Failed resume', failed_ok, failed_error == failure)
result.failed_flags[1] = coroutine.status(failed) == 'dead' and 1 or 0
local close_ok<const>, close_error<const> = coroutine.close(failed)
result.failed_flags[2] = not close_ok and close_error == failure and 1 or 0
print('Failed close', close_ok, close_error == failure)
result.failed_flags[3] = coroutine.close(failed) and 1 or 0

local read
local abandoned<const> = coroutine.create(function()
	local value = 19
	read = function() return value end
	coroutine.yield(value)
	value = 20
end)
local started<const>, yielded<const> = coroutine.resume(abandoned)
result.close_flags[0] = started and 1 or 0
print('Before close', started, yielded)
result.close_flags[1] = coroutine.close(abandoned) and 1 or 0
result.close_value = read()
result.close_flags[2] = coroutine.status(abandoned) == 'dead' and 1 or 0

local wrapped<const> = coroutine.wrap(function()
	local next_value<const> = coroutine.yield(12)
	return next_value
end)
result.wrap_values[0] = wrapped()
result.wrap_values[1] = wrapped(34)
local failed_wrapper_thread
local wrap_ok<const>, wrap_error<const> = pcall(coroutine.wrap(function()
	failed_wrapper_thread = coroutine.running()
	error(failure)
end))
result.wrap_flags[0] = not wrap_ok and wrap_error == failure and 1 or 0
print('Wrapped failure', wrap_ok, wrap_error == failure)
result.wrap_flags[1] = coroutine.close(failed_wrapper_thread) and 1 or 0

print('Protected return', ok, sum, gap, difference)
print('Retained before error', result.protected_values[2])
print('Coroutine values', first, last, original)
print('Closed capture', result.close_value)
print('Wrapped values', result.wrap_values[0], result.wrap_values[1])
result.completed = 1
while true do
	halt_until_irq
end
