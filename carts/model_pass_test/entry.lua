module<entry>
-- Dedicated static-model/GX integration fixture, not a gameplay cartridge.
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local scenes<const> = require('cartlib/world/scene_library')
require('scene')

display.reset_320x240()
world:configure({framebuffer_count=2,gameplay_interval_vblanks=1,frame_interval_vblanks=1,
	spaces={'main'},systems={}})
scenes.instantiate('model_pass.fixture')

while true do
	world:update()
	vblank.wait()
	world:render()
end
