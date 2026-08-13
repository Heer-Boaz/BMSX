local load_compiler<const> = require('compiler/load')
local vm_pcall<const> = __bmsx_pcall

local compiler_api<const> = {
	compile_syntax = load_compiler.compile_chunk,
	syntax_factory = require('compiler/syntax_factory'),
}

function compiler_api.load(source, chunk_name, mode, environment)
	local ok<const>, result<const> = vm_pcall(
		load_compiler.compile,
		source,
		chunk_name,
		mode,
		environment
	)
	if ok then
		return result
	end
	return nil, result
end

return compiler_api
