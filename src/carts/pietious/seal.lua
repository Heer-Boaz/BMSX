local seal = {}
seal.__index = seal

function seal:ctor()
	self.collider.enabled = false
	self:gfx('seal')
end

local function define_seal_fsm()
	define_fsm('seal', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_seal_definition()
	define_prefab({
		def_id = 'seal',
		class = seal,
		type = 'sprite',
		fsms = { 'seal' },
		defaults = {
			tick_enabled = false,
		},
	})
end

return {
	seal = seal,
	define_seal_fsm = define_seal_fsm,
	register_seal_definition = register_seal_definition,
}
