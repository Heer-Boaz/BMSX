local seal<const> = {}
seal.__index = seal

function seal:ctor()
	self.collider.enabled = false
	self:gfx('seal')
end

local register_seal_definition<const> = function()
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
