module<entry>
-- STAR CATCH: scene-driven orbital shooter.
local display<const> = require('cartlib/gx/display')
local input<const> = require('cartlib/input/input')
local irq<const> = require('cartlib/irq')
local world<const> = require('cartlib/world/world')
local input_system<const> = require('cartlib/input/input_system')
local aem<const> = require('cartlib/aem')
local input_effect_system<const> = require('cartlib/input/actioneffect/system')
local bt_system<const> = require('cartlib/behaviour_tree/bt_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')
local game<const> = require('game')
local renderer<const> = require('scene_renderer')
local vblank_pending = 0

display.reset_320x240()
input.add_player(1)
world:configure({
	framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
	spaces = { 'title', 'intro', 'play', 'won', 'over' },
	systems = { input_system, input_effect_system, aem, bt_system, timeline_system },
})
local function init<init>()
	irq.register(0x0004, function() vblank_pending = vblank_pending + 1 end)
	game.install()
	renderer.setup()
end
init()
starcatch = game.new()

while true do
	while vblank_pending == 0 do halt_until_irq end
	vblank_pending = vblank_pending - 1
	world:update()
	starcatch:step()
	world:render()
end
