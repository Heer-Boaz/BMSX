local create<const> = __bmsx_coroutine_create
local resume<const> = __bmsx_coroutine_resume
local yield<const> = __bmsx_coroutine_yield
local status<const> = __bmsx_coroutine_status
local running<const> = __bmsx_coroutine_running
local close<const> = __bmsx_coroutine_close
local isyieldable<const> = __bmsx_coroutine_isyieldable
local raise<const> = __bmsx_error

local coroutine<const> = {}
function coroutine.create(fn) return create(fn) end
function coroutine.resume(thread, ...) return resume(thread, ...) end
function coroutine.yield(...) return yield(...) end
function coroutine.status(thread) return status(thread) end
function coroutine.running() return running() end
function coroutine.close(thread) return close(thread) end
function coroutine.isyieldable(...) return isyieldable(...) end

local unwrap<const> = function(thread, ok, ...)
	if not ok then close(thread); raise((...)) end
	return ...
end
function coroutine.wrap(fn)
	local thread<const> = create(fn)
	return function(...) return unwrap(thread, resume(thread, ...)) end
end
return coroutine
