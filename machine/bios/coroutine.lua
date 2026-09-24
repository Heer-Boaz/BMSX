local create<const> = __bmsx_coroutine_create
local resume<const> = __bmsx_coroutine_resume
local yield<const> = __bmsx_coroutine_yield
local status<const> = __bmsx_coroutine_status
local running<const> = __bmsx_coroutine_running
local close<const> = __bmsx_coroutine_close
local isyieldable<const> = __bmsx_coroutine_isyieldable
local raise<const> = __bmsx_error
local frame_scopes<const> = require('debug/frame_scopes')

-- The status primitive preserves the CPU ThreadStatus ordinal, including Failed.
local status_names<const> = { [0] = 'suspended', 'running', 'normal', 'suspended', 'dead', 'dead' }
local failed_status<const> = 5

local coroutine<const> = {}
function coroutine.create(fn) return create(fn) end
function coroutine.resume(thread, ...) return resume(thread, ...) end
function coroutine.yield(...) return yield(...) end
function coroutine.status(thread) return status_names[status(thread)] end
function coroutine.running() return running() end
local closed<const> = function(thread, ...)
	frame_scopes.retire(thread, 0)
	return ...
end
local close_thread<const> = function(thread) return closed(thread, close(thread)) end
coroutine.close = close_thread
function coroutine.isyieldable(...) return isyieldable(...) end

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
