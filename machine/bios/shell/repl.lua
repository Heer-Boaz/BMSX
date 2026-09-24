local compiler<const> = require('compiler/api')

-- A firmware-owned Lua session. Its environment is ordinary saved guest state,
-- not a copy of the CPU's global registerfile or of a stopped stack frame.
local repl<const> = {}
local environment

local create_environment<const> = function()
	local value<const> = {
		assert = assert, error = error, pcall = pcall, xpcall = xpcall,
		type = type, tostring = tostring, tonumber = tonumber, print = print,
		next = next, pairs = pairs, ipairs = ipairs, select = select,
		rawget = rawget, rawset = rawset, rawequal = rawequal,
		getglobal = getglobal, setglobal = setglobal,
		getmetatable = getmetatable, setmetatable = setmetatable,
		table = table, string = string, math = math, os = os,
		coroutine = coroutine, lua_compiler = lua_compiler,
	}
	-- Unlike the public BIOS loader, a session loader has an implicit environment.
	value.load = function(source, chunk_name, mode, explicit_environment)
		if explicit_environment == nil then
			explicit_environment = value
		end
		return compiler.load(source, chunk_name, mode, explicit_environment)
	end
	return value
end

function repl.evaluate(source, chunk_name)
	if environment == nil then
		environment = create_environment()
	end
	-- Lua's interactive loader tries an expression before a statement. Neither
	-- attempt executes input; only the successfully compiled chunk is called.
	local chunk, message = compiler.load('return ' .. source, chunk_name, 't', environment)
	if chunk == nil then
		chunk, message = compiler.load(source, chunk_name, 't', environment)
	end
	if chunk == nil then
		return false, message
	end
	return pcall(chunk)
end

return repl
