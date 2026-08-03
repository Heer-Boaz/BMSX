local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local lithograph<const> = {}
lithograph.__index = lithograph

function lithograph:ctor()
	self.collider:set_enabled(false)
	self:gfx('lithograph')
end

local register_lithograph_definition<const> = function()
	prefab.define({
		def_id = 'lithograph',
		class = lithograph,
		base = spriteobject,
		defaults = {
			text = nil,
			room_number = 0,
		},
	})
end

return {
	lithograph = lithograph,
	register_lithograph_definition = register_lithograph_definition,
}
