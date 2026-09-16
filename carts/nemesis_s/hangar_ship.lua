local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local sprite_object<const> = require('cartlib/sprite')

local hangar_ship<const> = {
	definition_id = 'nemesis_s.hangar_ship',
}

local ship<const> = {}

function ship:ctor()
	self.burst = self:get_component(sprite_component, 'burst')
	self.burst.visible = false
end

function ship:onspawn()
	-- Timelines animate relative to the scene's placement, including edits.
	self.start_y = self.y
end

function hangar_ship.register()
	prefab.define({
		def_id = hangar_ship.definition_id,
		class = ship,
		base = sprite_object,
		defaults = { imgid = 'title_startup_metalion' },
		components = {
			-- The ship body is behind the hangar lip; its exhaust is in front.
			sprite_component.factory({
				id_local = 'burst', imgid = 'title_startup_metalion', offset_z = 2,
			}),
		},
	})
end

return hangar_ship
