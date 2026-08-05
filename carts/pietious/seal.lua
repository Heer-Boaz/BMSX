local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local seal<const> = {}
seal.__index = seal

function seal:ctor()
	self.collider:set_enabled(false)
	self:set_imgid('seal')
end

local register_seal_definition<const> = function()
	prefab.define({
		def_id = 'seal',
		class = seal,
		base = sprite_object,
		defaults = {
		},
	})
end

return {
	seal = seal,
	register_seal_definition = register_seal_definition,
}
