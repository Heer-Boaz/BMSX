local compile_load<const> = require('compiler/load').compile
local vm_pcall<const> = __bmsx_pcall

local compiler_api<const> = {}

function compiler_api.load(source, chunk_name, mode, environment)
	local ok<const>, result<const> = vm_pcall(
		compile_load,
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
