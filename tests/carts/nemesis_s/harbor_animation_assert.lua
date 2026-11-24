local fixture<const> = require('tests/carts/nemesis_s/fixture')
local assets<const> = require('bmsx/assets')
local bin<const> = require('cartlib/bin')

return {kind='integration', tests={
    moving_cargo_keeps_art_collision_and_damage_in_step = function(t)
        local _, stage<const>, pilot<const> = fixture.start_game(t)
        stage.scrolling = false
        pilot.body_collider:set_enabled(false)
        local original<const> = bin.decode(assets.data_nemesis_s_stage_addr, 'harbor regression source')
        local spec<const> = original.harbor_animation
        local clip
        for _, authored in ipairs(spec.clips) do
            if authored.label == 'lier_475' then clip = authored; break end
        end
        assert(clip ~= nil)
        local harbor<const>, tiles<const> = stage.harbor, stage.stage_tiles
        local size<const> = stage.tile_size
        local empty<const> = tiles.art:resolve(spec.empty)
        local origin_x<const>, origin_y<const> = stage:get_global_position()
        local left<const> = clip.start
        local width<const> = stage.tile_columns + 2
        stage.total_scroll_px = left * size
        tiles:set_visible_columns(left + 1, width)

        local screen<const> = function(x, y)
            return (x - 1) * size - stage.total_scroll_px + origin_x, (y - 1) * size + origin_y
        end
        local solid<const> = function(x, y)
            return stage:is_solid_pixel(screen(x, y))
        end
        harbor:reset(left)
        local original_art<const> = tiles:source_at(480, 9)
        assert(original_art ~= empty and solid(480, 9))
        assert(tiles:source_at(480, 13) == empty and not solid(480, 13))

        -- Four authored holds expire, dropping the load one tile. The rope
        -- and hook can be solid even though neither cell accepts cargo hits.
        for i = 1, 4 do
            for _ = 1, clip.steps[i][2] do harbor:tick() end
        end
        assert(tiles:source_at(480, 9) == empty and not solid(480, 9))
        assert(tiles:source_at(480, 13) ~= empty and solid(480, 13))
        assert(tiles:source_at(481, 8) ~= empty and solid(481, 8))
        local hook_x<const>, hook_y<const> = screen(481, 8)
        assert(not stage:receive_projectile_impact({damage = 1}, hook_x, hook_y, 0))

        local hits, destructions = 0, 0
        stage.events:on({event = 'enemy.structure.hit', handler = function() hits = hits + 1 end})
        stage.events:on({event = 'enemy.structure.destroyed', handler = function() destructions = destructions + 1 end})
        local tile_x<const>, tile_y<const> = screen(480, 13)
        local x<const>, y<const> = tile_x + 0.5, tile_y + 0.5
        local missile<const> = {x = x, y = y, damage = 1, continuous_damage = true}
        assert(stage:receive_projectile_impact(missile, x, y, 0))
        stage:receive_projectile_blast(missile, size * 2, size)
        assert(hits == 1 and destructions == 0, 'impact and same-tick overlapping blast counted twice')
        assert(stage:receive_projectile_impact({damage = 1}, x, y, 0))
        assert(stage:receive_projectile_impact({damage = 1}, x, y, 0))
        assert(hits == 2 and destructions == 1)
        assert(tiles:source_at(480, 13) == empty and not solid(480, 13) and solid(481, 8))
        assert(not stage:receive_projectile_impact({damage = 1}, x, y, 0))

        -- Finishing the one-shot retires playback, not the damaged load.
        for i = 5, #clip.steps do
            for _ = 1, clip.steps[i][2] do harbor:tick() end
        end
        assert(tiles:source_at(480, 9) == empty and not solid(480, 9))
        harbor:reset(left)
        assert(tiles:source_at(480, 9) == original_art and solid(480, 9))
        local reset_x<const>, reset_y<const> = screen(480, 9)
        missile.x, missile.y = reset_x, reset_y
        assert(stage:receive_projectile_impact(missile, reset_x, reset_y, 0))
        assert(hits == 3 and destructions == 1, 'checkpoint reset retained old hit history')
    end,
}}
