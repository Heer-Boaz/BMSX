module<entry>
-- STAR CATCH: arrows move, Space starts or restarts.
-- Catch twelve gold stars. Dodge red blocks. Three lives.
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
local irq_module<const> = require('cartlib/irq')
local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local framebuffer_size<const> = 320 | (240 << 16)
local vblank_count = 0

gx_display.reset_320x240()
local function init<init>()
    irq_module.register(irq_vblank, function()
        vblank_count = vblank_count + 1
    end)
    input.add_player(1)
end

local next_drop<const> = function()
    starcatch_wave = starcatch_wave + 1
    starcatch_drop_x = 16 + (starcatch_wave * 73 + 75) % 280
    starcatch_drop_y = 28
    starcatch_danger = starcatch_wave % 3 == 0
    starcatch_delay = 20
end

function new_game()
    starcatch_x = 144
    starcatch_score = 0
    starcatch_lives = 3
    starcatch_wave = 0
    starcatch_flash = 0
    starcatch_state = 'play'
    next_drop()
end

local finish_drop<const> = function(caught)
    if starcatch_danger then
        if caught then
            starcatch_lives = starcatch_lives - 1
            starcatch_flash = 15
        end
    elseif caught then
        starcatch_score = starcatch_score + 1
    else
        starcatch_lives = starcatch_lives - 1
        starcatch_flash = 15
    end
    if starcatch_lives == 0 then
        starcatch_state = 'over'
        print('Starcatch: game over. Space to retry.')
    elseif starcatch_score == 12 then
        starcatch_state = 'won'
        print('Starcatch: twelve stars! Space to play again.')
    else
        next_drop()
    end
end

local update_cart<const> = function()
    input.advance_frame()
    if starcatch_state ~= 'play' then
        if input.is_action_just_pressed(1, clock.frame, 'touch') then
            new_game()
        end
        return
    end
    local direction = 0
    if input.is_action_pressed(1, clock.frame, 'left') then
        direction = direction - 1
    end
    if input.is_action_pressed(1, clock.frame, 'right') then
        direction = direction + 1
    end
    starcatch_x = math.max(8, math.min(280, starcatch_x + direction * 4))
    if starcatch_flash > 0 then
        starcatch_flash = starcatch_flash - 1
    end
    if starcatch_delay > 0 then
        starcatch_delay = starcatch_delay - 1
        return
    end
    starcatch_drop_y = starcatch_drop_y + 2 + starcatch_score // 4
    if starcatch_drop_y + 8 >= 204 and starcatch_drop_y <= 212
        and starcatch_drop_x + 8 > starcatch_x
        and starcatch_drop_x < starcatch_x + 32 then
        finish_drop(true)
    elseif starcatch_drop_y > 232 then
        finish_drop(false)
    end
end

local draw_star<const> = function(x, y, color)
    gx_gpu.fill_rect_color(x + 3, y, x + 5, y + 8, color)
    gx_gpu.fill_rect_color(x, y + 3, x + 8, y + 5, color)
   gx_gpu.fill_rect_color(x + 2, y + 2, x + 6, y + 6, color)
end

local draw_cart<const> = function()
    gx_gpu.clear_color(0, framebuffer_size, 0xff101827)
    gx_gpu.fill_rect_color(8, 24, 312, 25, 0xff344763)
    gx_gpu.fill_rect_color(8, 216, 312, 218, 0xff344763)
    for i = 1, 12 do
        local color = 0xff344763
        if i <= starcatch_score then color = 0xffffd866 end
        draw_star(12 + (i - 1) * 18, 8, color)
    end
    for i = 1, starcatch_lives do
        local x<const> = 254 + (i - 1) * 18
        gx_gpu.fill_rect_color(x, 8, x + 4, 13, 0xfff87888)
        gx_gpu.fill_rect_color(x + 6, 8, x + 10, 13, 0xfff87888)
        gx_gpu.fill_rect_color(x + 2, 11, x + 8, 16, 0xfff87888)
        gx_gpu.fill_rect_color(x + 4, 16, x + 6, 18, 0xfff87888)
    end
    local paddle_color = 0xff64dce6
    if starcatch_flash > 0 then paddle_color = 0xffff657a end
    gx_gpu.fill_rect_color(starcatch_x, 204, starcatch_x + 32, 212, paddle_color)
    gx_gpu.fill_rect_color(starcatch_x + 4, 208, starcatch_x + 28, 212, 0xff2c809a)
    if starcatch_state == 'play' then
        local x<const> = starcatch_drop_x
        local y<const> = starcatch_drop_y
        if starcatch_danger then
            gx_gpu.fill_rect_color(x, y, x + 8, y + 8, 0xffff657a)
            gx_gpu.fill_rect_color(x + 3, y + 2, x + 5, y + 6, 0xff401829)
        else
            gx_gpu.fill_rect_color(x + 3, y - 8, x + 5, y, 0xff6a562d)
            draw_star(x, y, 0xffffd866)
        end
    else
        gx_gpu.fill_rect_color(58, 62, 262, 184, 0xff23334d)
        if starcatch_state == 'over' then
            for i = 0, 7 do
                gx_gpu.fill_rect_color(136 + i * 5, 88 + i * 5, 142 + i * 5, 94 + i * 5, 0xffff657a)
                gx_gpu.fill_rect_color(171 - i * 5, 88 + i * 5, 177 - i * 5, 94 + i * 5, 0xffff657a)
            end
        else
           local color = 0xffffd866
            if starcatch_state == 'won' then color = 0xff64e6b4 end
            gx_gpu.fill_rect_color(154, 82, 166, 130, color)
            gx_gpu.fill_rect_color(136, 100, 184, 112, color)
            gx_gpu.fill_rect_color(148, 94, 172, 118, color)
        end
        -- a space-bar keycap: start / retry.
        gx_gpu.fill_rect_color(112, 154, 208, 172, 0xff64dce6)
        gx_gpu.fill_rect_color(116, 154, 204, 166, 0xff23334d)
    end
    -- Direction hints remain below the playfield.
    for i = 0, 3 do
        gx_gpu.fill_rect_color(108 + i * 2, 229 - i, 110 + i * 2, 231 + i, 0xff64dce6)
        gx_gpu.fill_rect_color(210 - i * 2, 229 - i, 212 - i * 2, 231 + i, 0xff64dce6)
    end
end

local wait_vblank<const> = function()
    repeat
        halt_until_irq
    until vblank_count ~= 0
    vblank_count = vblank_count - 1
end

init()
*irq_mask = irq_vblank
new_game()
starcatch_state = 'ready'
print('STAR CATCH: arrows move; Space starts or restarts.')
print('Catch twelve gold stars. Dodge red blocks. Three lives.')
*input_control = 0x00000001
wait_vblank()
while true do
    update_cart()
    *input_control = 0x00000001
    wait_vblank()
    draw_cart()
end
