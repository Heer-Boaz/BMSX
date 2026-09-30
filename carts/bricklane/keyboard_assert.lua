-- A reusable physical-input reproduction; every case owns its own machine.
return {
    kind = 'integration',
    tests = {
        keyboard_moves_paddle_releases_and_serves = function(t)
            t:wait_until('cart startup', function()
                return bricklane ~= nil and bricklane.ticks > 0
            end, 120)
            local before_x = bricklane.paddle_x
            t:down('ArrowRight')
            t:wait_ticks(3)
            t:up('ArrowRight')
            assert(bricklane.paddle_x > before_x, 'right input must move the paddle')
            t:wait_ticks(2)
            local released_x = bricklane.paddle_x
            t:wait_ticks(3)
            assert(bricklane.paddle_x == released_x, 'released input must stop movement')
            t:press('Space', 1)
            t:wait_until('serve', function() return bricklane.phase == 'play' end, 30)
            assert(bricklane.lives == 3 and bricklane.score == 0, 'serve keeps a fresh game')
            t:log('Physical keyboard input moved, released and served the ball')
        end,
    },
}
