local lithograph = {}
lithograph.__index = lithograph

function lithograph:ctor()
	self.collider.enabled = false
	self:gfx('lithograph')
end

local function register_lithograph_definition()
	define_prefab({
		def_id = 'lithograph',
		class = lithograph,
		type = 'sprite',
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
