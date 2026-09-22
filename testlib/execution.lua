local context<const> = require('testlib/context')
local execution<const> = {}
local suite, name, fixture, t
local threads<const> = {}

function execution.bind(definition, case_name)
	suite = definition
	name = case_name
	fixture = {}
	t = context.new(suite.kind)
end

local response<const> = function(thread, ok, ...)
	if not ok then return 'failed', thread, (...) end
	if coroutine.status(thread) == 'dead' then return 'returned' end
	return 'yielded', ...
end

-- The module, not the adapter's borrowed values, retains every phase thread.
-- In particular, teardown does not unwind or replace a failed body stack.
function execution.resume(phase, ...)
	local thread = threads[phase]
	if thread == nil then
		local fn
		if phase == 'body' then fn = suite.tests[name] else fn = suite[phase] end
		thread = coroutine.create(fn)
		threads[phase] = thread
		return response(thread, coroutine.resume(thread, t, fixture))
	end
	return response(thread, coroutine.resume(thread, ...))
end

function execution.cancel(phase)
	local thread<const> = threads[phase]
	if thread ~= nil then coroutine.close(thread) end
	return 'returned'
end

return execution
