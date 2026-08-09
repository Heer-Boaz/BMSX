local compiler<const> = require('compiler/compiler')
local linker<const> = require('compiler/linker')
local parser<const> = require('compiler/parser')

local load_compiler<const> = {}
local byte<const> = __bmsx_string_byte
local root_const_pool_register<const> = 1

local mode_accepts_text<const> = function(mode)
	if mode == nil then
		return true
	end
	for index = 1, #mode do
		if byte(mode, index) == 116 then
			return true
		end
	end
	return false
end

local create_root_closure<const> = function(function_address, const_pool)
	-- CLOSURE.R reads the generated root record, whose upvalue descriptor
	-- captures this call frame's r1 constant-pool parameter.
	return blua32.closure(function_address)
end

function load_compiler.compile(source, chunk_name, mode, _environment)
	if not mode_accepts_text(mode) then
		error("attempt to load a text chunk (mode is '" .. mode .. "')")
	end
	chunk_name = chunk_name or '=(load)'
	local chunk<const> = parser.parse(source, chunk_name)
	local function_address<const>, const_pool<const> = linker.link(
		compiler.compile(chunk, chunk_name, root_const_pool_register)
	)
	return create_root_closure(function_address, const_pool)
end

return load_compiler
