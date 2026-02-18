local lithograph = {}
lithograph.__index = lithograph

function lithograph:ctor()
	self.collider.enabled = false
	self:gfx('lithograph')
	self.sprite_component.offset = { x = 0, y = 0, z = 10 }
end

function lithograph:configure_from_room_def(def, room)
	self.room_number = room.room_number
	self.text = def.text
	self.x = def.x
	self.y = def.y
	self.space_id = room.space_id
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
		def_id = 'lithograph.def',
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
