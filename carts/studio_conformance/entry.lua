module<entry>

local gx_display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
local scene<const> = require('scene')

gx_display.reset_320x240()
scene.register()
world:configure(world_module)
world:spawn(scene.definition_id, {
	id = 'studio.conformance.instance',
	pos = { x = 80, y = 72, z = 4 },
})
vblank.wait()

while true do
	world:update()
	vblank.wait()
	world:render()
end
