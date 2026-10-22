local progression<const> = require('cartlib/progression')

return {
    kind = 'integration',
    setup = function(t)
        t:wait_until('cart ready', function()
            return starcatch ~= nil and starcatch.phase == 'ready'
        end, 120)
    end,
    tests = {
        ['play, animate, unlock, intercept and complete'] = function(t)
            local initial_bob<const> = starcatch.player.bob
            t:wait_ticks(20)
            assert(starcatch.player.bob ~= initial_bob, 'ready idle animation must advance')
            t:capture('ready-3d')
            t:press('Space', 1)
            t:wait_until('game started', function() return starcatch.phase == 'play' end, 8)

            local held = ''
            local saw_catch = false
            local saw_intercept = false
            for tick = 1, 2400 do
                local match<const> = starcatch
                if match.phase ~= 'play' then break end
                local target = math.max(8, math.min(280, match.drop.x - 12))
                if match.drop.danger then
                    if match.drop.x < 160 then target = 280 else target = 8 end
                end
                local desired = ''
                if match.player.x < target - 2 then
                    desired = 'ArrowRight'
                elseif match.player.x > target + 2 then
                    desired = 'ArrowLeft'
                end
                if desired ~= held then
                    if held ~= '' then t:up(held) end
                    held = desired
                    if held ~= '' then t:down(held) end
                end
                if match.player.timelines:get('catch').playing then saw_catch = true end
                if match.sentinel.mode == 'intercept' then saw_intercept = true end
                if match.score >= 3 then
                    assert(progression.get(match, 'sentinel_unlocked') == true)
                    assert(match.sentinel.unlocked)
                end
                if match.score >= 6 then
                    assert(progression.get(match, 'shield_boost') == true)
                    assert(match.shield_boost)
                end
                t:wait_ticks(1)
            end
            if held ~= '' then t:up(held) end
            assert(starcatch.phase == 'won', 'physical play must complete all twelve catches')
            assert(starcatch.score == 12 and starcatch.lives == 3)
            assert(progression.get(starcatch, 'complete') == true)
            assert(saw_catch, 'catch must use the actual timeline')
            assert(saw_intercept and starcatch.blocked > 0, 'the sentinel BT must intercept a real hazard')
            t:wait_ticks(20)
            assert(starcatch.player.opening == 0, 'last catch animation must finish after winning')
            t:capture('twelve-stars')
            t:press('Space', 1)
            t:wait_until('fresh match', function()
                return starcatch.phase == 'play' and starcatch.score == 0
            end, 8)
            assert(starcatch.lives == 3 and not starcatch.sentinel.unlocked)
            assert(progression.get(starcatch, 'sentinel_unlocked') == nil)
        end,
        ['misses lose lives and physical restart resets the match'] = function(t)
            t:press('Space', 1)
            t:wait_until('game started', function() return starcatch.phase == 'play' end, 8)
            -- Move away from gold; the third wave is a deliberate hazard hit.
            t:down('ArrowLeft')
            t:wait_ticks(40)
            t:up('ArrowLeft')
            t:wait_until('game over', function() return starcatch.phase == 'over' end, 600)
            assert(starcatch.lives == 0 and starcatch.score == 0)
            t:wait_ticks(20)
            assert(starcatch.player.recoil == 0, 'hurt animation must finish after game over')
            t:capture('game-over')
            t:press('Space', 1)
            t:wait_until('restarted', function()
                return starcatch.phase == 'play' and starcatch.lives == 3
            end, 8)
            assert(starcatch.score == 0 and starcatch.wave == 1)
        end,
    },
}
