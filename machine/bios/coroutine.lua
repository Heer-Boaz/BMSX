local creation<const> = require('kernel/thread_create')
local create<const> = creation.create_coroutine
local status<const> = __bmsx_coroutine_status
local running<const> = __bmsx_coroutine_running
local retirement<const> = require('kernel/coroutine_close')
local raise<const> = __bmsx_error
local frame_scopes<const> = require('debug/frame_scopes')
local entries<const> = require('bmsx/startup')
local yieldable<const> = blua32.closure(entries.coroutine_yieldable)

-- The status primitive preserves the CPU ThreadStatus ordinal, including Failed.
local status_names<const> = { [0] = 'suspended', 'running', 'normal', 'suspended', 'dead', 'dead' }
local failed_status<const> = 5
local main_thread<const> = running()

local coroutine<const> = {}
function coroutine.create(fn) return create(fn) end
coroutine.resume = blua32.closure(entries.coroutine_resume)
coroutine.yield = blua32.closure(entries.coroutine_yield)
local resume<const> = coroutine.resume
function coroutine.status(thread) return status_names[status(thread)] end
function coroutine.running() return running() end
local closed<const> = function(thread, ...)
	frame_scopes.retire(thread, 0)
	return ...
end
local close_thread<const> = function(thread) return closed(thread, retirement.close_thread(thread)) end
coroutine.close = close_thread
function coroutine.isyieldable(...)
	local thread = ...
	if blua32.argument_count() == 0 then thread = running() end
	return thread ~= main_thread and yieldable(thread)
end

local unwrap<const> = function(thread, ok, ...)
	if not ok then
		if status(thread) == failed_status then close_thread(thread) end
		raise((...))
	end
	return ...
end
function coroutine.wrap(fn)
	local thread<const> = create(fn)
	return function(...) return unwrap(thread, resume(thread, ...)) end
end
return coroutine
