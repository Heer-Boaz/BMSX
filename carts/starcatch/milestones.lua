local progression<const> = require('cartlib/progression')

-- Match milestones consume authoritative gameplay events, never a frame counter.
return progression.compile_program({
    rules = {
        {
            id = 'sentinel',
            on = 'starcatch.gold_caught',
            when_event = { equals = { score = 3 } },
            set = {{ key = 'sentinel_unlocked', value = true }},
            apply = {{ op = 'unlock_sentinel' }},
            apply_once = true,
        },
        {
            id = 'shield',
            on = 'starcatch.gold_caught',
            when_event = { equals = { score = 6 } },
            set = {{ key = 'shield_boost', value = true }},
            apply = {{ op = 'boost_shield' }},
            apply_once = true,
        },
        {
            id = 'complete',
            on = 'starcatch.gold_caught',
            when_event = { equals = { score = 12 } },
            set = {{ key = 'complete', value = true }},
            apply = {{ op = 'complete' }},
            apply_once = true,
        },
    },
    filters = {},
    handlers = {
        unlock_sentinel = function(game)
            game.sentinel:unlock()
        end,
        boost_shield = function(game)
            game.shield_boost = true
        end,
        complete = function(game)
            game:finish('won')
        end,
    },
})
