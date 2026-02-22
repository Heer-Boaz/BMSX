local lithograph = {}
lithograph.__index = lithograph

function lithograph:ctor()
	self.collider.enabled = false
	self:gfx('lithograph')
end

local function define_lithograph_fsm()
	define_fsm('lithograph.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_lithograph_definition()
	define_prefab({
		def_id = 'lithograph',
		class = lithograph,
		type = 'sprite',
		fsms = { 'lithograph.fsm' },
		defaults = {
			text = '',
			room_number = 0,
		},
	})
end

return {
	lithograph = lithograph,
	define_lithograph_fsm = define_lithograph_fsm,
	register_lithograph_definition = register_lithograph_definition,
}
