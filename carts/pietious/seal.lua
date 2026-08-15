local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local seal<const> = {}
seal.__index = seal

local register_seal_definition<const> = function()
	prefab.define({
		def_id = 'seal',
		class = seal,
		base = sprite_object,
		defaults = {
			imgid = 'seal',
		},
	})
end

return {
	seal = seal,
	register_seal_definition = register_seal_definition,
}
