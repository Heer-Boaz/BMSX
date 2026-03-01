local seal = {}
seal.__index = seal

function seal:ctor()
	self.collider.enabled = false
	self:gfx('seal')
end

local function register_seal_definition()
	define_prefab({
		def_id = 'seal',
		class = seal,
		type = 'sprite',
		defaults = {
		},
	})
end

return {
	seal = seal,
	register_seal_definition = register_seal_definition,
}
