local context<const> = {}
context.__index = context

function context.new(kind)
	return setmetatable({ kind = kind }, context)
end

function context:log(message)
	coroutine.yield('log', message)
end

function context:wait_ticks(ticks)
	assert(self.kind == 'integration', 'wait_ticks requires an integration test')
	if ticks == 0 then return end
	coroutine.yield('ticks', ticks)
end

function context:wait_until(label, predicate, max_ticks)
	local elapsed = 0
	while not predicate() do
		assert(elapsed < max_ticks, 'Timed out: ' .. label)
		self:wait_ticks(1)
		elapsed = elapsed + 1
	end
end

function context:at_boundary(receipt, max_ticks)
	assert(self.kind == 'integration', 'at_boundary requires an integration test')
	if receipt.reached then return end
	assert(coroutine.yield('boundary', receipt, max_ticks), 'Mutation boundary timed out')
end

function context:press(code, samples, gamepad)
	assert(self.kind == 'integration', 'press requires an integration test')
	coroutine.yield('press', code, samples, gamepad)
end

function context:down(code, gamepad)
	assert(self.kind == 'integration', 'down requires an integration test')
	coroutine.yield('key', code, true, gamepad)
end

function context:up(code, gamepad)
	assert(self.kind == 'integration', 'up requires an integration test')
	coroutine.yield('key', code, false, gamepad)
end

function context:capture(label)
	assert(self.kind == 'integration', 'capture requires an integration test')
	return coroutine.yield('capture', label)
end

function context:observe_fsm_transitions(recorder)
	coroutine.yield('fsm', recorder)
end

function context:observe_actioneffects(recorder)
	coroutine.yield('actioneffects', recorder)
end

return context
