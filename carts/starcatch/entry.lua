module<entry>
-- STAR CATCH 3D: arrows move, Space starts/restarts.
-- Gold3 unlocks the sentinel; Gold6 boosts it; Gold12 completes the run.
local gx_display<const> = require('cartlib/gx/display')
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
local irq_module<const> = require('cartlib/irq')
local world<const> = require('cartlib/world/world')
local bt_system<const> = require('cartlib/behaviour_tree/bt_system')
local timeline_system<const> = require('cartlib/timeline/timeline_system')
local game_module<const> = require('game')
local renderer<const> = require('scene_renderer')

local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0

gx_display.reset_320x240()
local function init<init>()
    irq_module.register(irq_vblank, function()
        vblank_count = vblank_count + 1
    end)
    input.add_player(1)
    world:configure({
        framebuffer_count = 1,
        gameplay_interval_vblanks = 1,
        frame_interval_vblanks = 1,
        spaces = { 'arena' },
        systems = { bt_system, timeline_system },
    })
    game_module.install()
    renderer.setup()
end

local wait_vblank<const> = function()
    while vblank_count == 0 do halt_until_irq end
    vblank_count = vblank_count - 1
end

init()
*irq_mask = irq_vblank
starcatch = game_module.new()
*input_control = 1
wait_vblank()

while true do
    input.advance_frame()
    if input.is_action_just_pressed(1, clock.frame, 'touch')
        and starcatch.phase ~= 'play' then
        if starcatch.phase ~= 'ready' then starcatch = game_module.new() end
        starcatch:start()
    end
    starcatch:step()
    world:update()
    starcatch:after_world()
    *input_control = 1
    wait_vblank()
    renderer.draw(starcatch)
end
