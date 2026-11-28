local entries<const> = require('bmsx/startup')
local load_compiler<const> = require('compiler/load')
local call_protected<const> = blua32.code_function(entries.protected_call)

local compiler_api<const> = {
	compile_syntax = load_compiler.compile_chunk,
	syntax_factory = require('compiler/syntax_factory'),
}

function compiler_api.load(source, chunk_name, mode, environment, external_scope)
	local ok<const>, result<const> = call_protected(
		load_compiler.compile,
		source,
		chunk_name,
		mode,
		environment,
		external_scope
	)
	if ok then
		return result
	end
	return nil, result
end

return compiler_api
