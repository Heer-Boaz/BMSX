local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local lithograph<const> = {}
lithograph.__index = lithograph

local register_lithograph_definition<const> = function()
	prefab.define({
		def_id = 'lithograph',
		class = lithograph,
		base = sprite_object,
		defaults = {
			imgid = 'lithograph',
			text = nil,
			room_number = 0,
		},
	})
end

return {
	lithograph = lithograph,
	register_lithograph_definition = register_lithograph_definition,
}
