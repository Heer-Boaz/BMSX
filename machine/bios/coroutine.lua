local creation<const> = require('kernel/thread_create')
local create<const> = creation.create_coroutine
local resume<const> = __bmsx_coroutine_resume
local yield<const> = __bmsx_coroutine_yield
local status<const> = __bmsx_coroutine_status
local running<const> = __bmsx_coroutine_running
local retirement<const> = require('kernel/coroutine_close')
local raise<const> = __bmsx_error
local frame_scopes<const> = require('debug/frame_scopes')
local frame_count<const>, frame_header<const> = __bmsx_frame_count, __bmsx_frame_header
local entries<const> = require('bmsx/startup')

-- The status primitive preserves the CPU ThreadStatus ordinal, including Failed.
local status_names<const> = { [0] = 'suspended', 'running', 'normal', 'suspended', 'dead', 'dead' }
local failed_status<const> = 5
local system_domain<const> = -1
local main_thread<const> = running()

local can_yield<const> = function(thread)
	if thread == main_thread then return false end
	for i = frame_count(thread) - 1, 0, -1 do
		local fn<const>, _<const>, _<const>, completion<const>, domain<const>, exception<const> = frame_header(thread, i)
		if exception or completion or (domain == system_domain and fn == entries.protected_handler) then return false end
	end
	return true
end

local coroutine<const> = {}
function coroutine.create(fn) return create(fn) end
function coroutine.resume(thread, ...) return resume(thread, ...) end
function coroutine.yield(...)
	if not can_yield((running())) then raise('Invalid argument.') end
	return yield(...)
end
function coroutine.status(thread) return status_names[status(thread)] end
function coroutine.running() return running() end
local closed<const> = function(thread, ...)
	frame_scopes.retire(thread, 0)
	return ...
end
local close_thread<const> = function(thread) return closed(thread, retirement.close_thread(thread)) end
coroutine.close = close_thread
function coroutine.isyieldable(...)
	if blua32.argument_count() == 0 then return can_yield((running())) end
	return can_yield((...))
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
