local compiler<const> = require('compiler/compiler')
local linker<const> = require('compiler/linker')
local parser<const> = require('compiler/parser')
local bind_ram_function<const> = require('kernel/heap_control_ids').bind_ram_function

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
	-- The generated root captures this call frame's r1 constant-pool parameter.
	return blua32.svc_value(bind_ram_function, function_address)
end

function load_compiler.compile_chunk(chunk, chunk_name, environment, external_scope)
	local function_address<const>, const_pool<const> = linker.link(
		compiler.compile(
			chunk,
			chunk_name,
			root_const_pool_register,
			environment,
			external_scope
		)
	)
	return create_root_closure(function_address, const_pool)
end

function load_compiler.compile(source, chunk_name, mode, environment, external_scope)
	if not mode_accepts_text(mode) then
		error("attempt to load a text chunk (mode is '" .. mode .. "')")
	end
	chunk_name = chunk_name or '=(load)'
	local chunk<const> = parser.parse(source, chunk_name)
	return load_compiler.compile_chunk(chunk, chunk_name, environment, external_scope)
end

return load_compiler
