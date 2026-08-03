local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local seal<const> = {}
seal.__index = seal

function seal:ctor()
	self.collider:set_enabled(false)
	self:gfx('seal')
end

local function register_seal_definition<init>()
	prefab.define({
		def_id = 'seal',
		class = seal,
		base = spriteobject,
		defaults = {
		},
	})
end

return {
	seal = seal,
}
