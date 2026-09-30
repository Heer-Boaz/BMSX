module<entry>
-- BRICKLANE: Left/Right move. Space serves or restarts. Clear all six bricks.
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
local irq_module<const> = require('cartlib/irq')
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
local clamp<const> = require('cartlib/util/clamp')
local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local framebuffer_size<const> = 320 | (240 << 16)
local brick_colors<const> = { 0xffff7185, 0xffffa75f, 0xffffd76b, 0xff8de3b2, 0xff66cee8, 0xffb99afa }
local terminal_phases<const> = { won = true, over = true }
local vblank_count = 0

gx_display.reset_320x240()
local function init<init>()
    irq_module.register(irq_vblank, function()
        vblank_count = vblank_count + 1
    end)
    input.add_player(1)
end

function new_game()
    bricklane = {
        phase = 'ready', score = 0, lives = 3, ticks = 0,
        paddle_x = 136,
        ball = { x = 157, y = 196, vx = 2, vy = -3 },
        bricks = { true, true, true, true, true, true },
    }
end

local update_cart<const> = function()
    input.advance_frame()
    local game<const> = bricklane
    game.ticks = game.ticks + 1
    local start<const> = input.is_action_just_pressed(1, clock.frame, 'touch')
    if terminal_phases[game.phase] then
        if start then new_game() end
        return
    end
    local direction = 0
    if input.is_action_pressed(1, clock.frame, 'left') then direction = direction - 1 end
    if input.is_action_pressed(1, clock.frame, 'right') then direction = direction + 1 end
    game.paddle_x = clamp(game.paddle_x + direction * 4, 8, 264)
    local ball<const> = game.ball
    if game.phase ~= 'play' then
        ball.x = game.paddle_x + 21
        ball.y = 196
        if start then
            ball.vx = 2
            ball.vy = -3
            game.phase = 'play'
        end
        return
    end

    local previous_x<const> = ball.x
    local previous_y<const> = ball.y
    ball.x = ball.x + ball.vx
    ball.y = ball.y + ball.vy
    if ball.x < 8 then ball.x = 8; ball.vx = -ball.vx end
    if ball.x > 306 then ball.x = 306; ball.vx = -ball.vx end
    if ball.y < 28 then ball.y = 28; ball.vy = -ball.vy end

    if ball.vy > 0 and previous_y + 6 <= 204 and ball.y + 6 >= 204
        and ball.x + 6 > game.paddle_x and ball.x < game.paddle_x + 48 then
        ball.y = 198
        ball.vy = -3
        local impact<const> = ball.x + 3 - (game.paddle_x + 24)
        if impact < -8 then ball.vx = -3
        elseif impact < 0 then ball.vx = -2
        elseif impact > 8 then ball.vx = 3
        else ball.vx = 2 end
    end

    for index = 1, 6 do
        local x<const> = 14 + (index - 1) * 48
        if game.bricks[index] and ball.x + 6 > x and ball.x < x + 44
            and ball.y + 6 > 48 and ball.y < 60 then
            game.bricks[index] = false
            game.score = game.score + 1
            if previous_y >= 60 then ball.y = 60; ball.vy = 3
            elseif previous_y + 6 <= 48 then ball.y = 42; ball.vy = -3
            elseif previous_x + 6 <= x then ball.x = x - 6; ball.vx = -ball.vx
            else ball.x = x + 44; ball.vx = -ball.vx end
            if game.score == 6 then
                game.phase = 'won'
                print('BRICKLANE: all bricks cleared! Space to restart.')
            end
            break
        end
    end
    if ball.y > 236 then
        game.lives = game.lives - 1
        if game.lives == 0 then
            game.phase = 'over'
            print('BRICKLANE: game over. Space to restart.')
        else
            game.phase = 'serve'
            ball.x = game.paddle_x + 21
            ball.y = 196
        end
    end
end

local draw_cart<const> = function()
    local game<const> = bricklane
    gx_gpu.clear_color(0, framebuffer_size, 0xff111b2c)
    gx_gpu.fill_rect_color(6, 26, 8, 220, 0xff344864)
    gx_gpu.fill_rect_color(312, 26, 314, 220, 0xff344864)
    gx_gpu.fill_rect_color(6, 24, 314, 26, 0xff344864)
    gx_gpu.fill_rect_color(8, 220, 312, 222, 0xff344864)
    for index = 1, 6 do
        local x<const> = 14 + (index - 1) * 48
        local marker_color = 0xff344864
        if index <= game.score then marker_color = 0xff8de3b2 end
        gx_gpu.fill_rect_color(14 + (index - 1) * 16, 10, 24 + (index - 1) * 16, 16, marker_color)
        if game.bricks[index] then
            gx_gpu.fill_rect_color(x, 48, x + 44, 60, brick_colors[index])
            gx_gpu.fill_rect_color(x + 2, 50, x + 42, 52, 0xfff8f4e8)
        end
    end
    for index = 1, game.lives do
        local x<const> = 266 + (index - 1) * 16
        gx_gpu.fill_rect_color(x, 9, x + 8, 17, 0xffff7185)
        gx_gpu.fill_rect_color(x + 2, 7, x + 6, 19, 0xffff7185)
    end
    gx_gpu.fill_rect_color(game.paddle_x, 204, game.paddle_x + 48, 212, 0xff66cee8)
    gx_gpu.fill_rect_color(game.paddle_x + 3, 205, game.paddle_x + 45, 207, 0xfff8f4e8)
    gx_gpu.fill_rect_color(game.ball.x, game.ball.y, game.ball.x + 6, game.ball.y + 6, 0xfffff4d0)
    gx_gpu.draw_triangle_color(116, 229, 122, 225, 122, 233, 0xff66cee8)
    gx_gpu.draw_triangle_color(204, 229, 198, 225, 198, 233, 0xff66cee8)
    if game.phase ~= 'play' then
        gx_gpu.fill_rect_color(83, 82, 237, 164, 0xff24354e)
        if game.phase == 'over' then
            for index = 0, 6 do
                gx_gpu.fill_rect_color(145 + index * 4, 96 + index * 4, 150 + index * 4, 101 + index * 4, 0xffff7185)
                gx_gpu.fill_rect_color(169 - index * 4, 96 + index * 4, 174 - index * 4, 101 + index * 4, 0xffff7185)
            end
        elseif game.phase == 'won' then
            gx_gpu.fill_rect_color(143, 94, 177, 110, 0xffffd76b)
            gx_gpu.fill_rect_color(153, 110, 167, 122, 0xffffd76b)
            gx_gpu.fill_rect_color(142, 122, 178, 126, 0xffffd76b)
        else
            gx_gpu.draw_triangle_color(150, 96, 150, 124, 176, 110, 0xff8de3b2)
        end
        -- Space-bar keycap; arrows below the arena show movement controls.
        gx_gpu.fill_rect_color(120, 140, 200, 154, 0xff66cee8)
        gx_gpu.fill_rect_color(124, 140, 196, 149, 0xff24354e)
    end
end

local wait_vblank<const> = function()
    repeat halt_until_irq until vblank_count ~= 0
    vblank_count = vblank_count - 1
end

init()
*irq_mask = irq_vblank
new_game()
print('BRICKLANE: Left/Right move. Space serves or restarts.')
print('Clear all six bricks. Three lives. Paddle edges steer the ball.')
*input_control = 0x00000001
wait_vblank()
while true do
    update_cart()
    *input_control = 0x00000001
    wait_vblank()
    draw_cart()
end
