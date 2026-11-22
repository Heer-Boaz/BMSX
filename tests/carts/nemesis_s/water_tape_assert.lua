local assets<const> = require('bmsx/assets')
local bin<const> = require('cartlib/bin')
local fixture<const> = require('tests/carts/nemesis_s/fixture')

local check_water_window<const> = function(tiles, authored, phase, first, count, paint_x, paint_y, paint)
    local spec<const> = authored.water_animation
    local last<const> = math.min(first + count - 1, tiles.columns)
    local water_count = 0
    for y = spec.first_row, #authored.tile_ids do
        local row<const> = tiles._rows[y]
        local cells<const> = authored.tile_ids[y]
        for i = row.first_visible_source, row.last_visible_source do
            local x<const> = row.columns[i]
            assert(x >= first and x <= last, 'admitted a source outside the current window')
            local cell<const> = cells[x]
            local family<const> = cell ~= 0 and spec.tile_families[cell] or 0
            if family ~= 0 then
                local strip<const> = (x - 1 - spec.origin_column) // 4
                local offset<const> = spec.phase_offsets[(strip & 7) + 1]
                local pose<const> = ((phase + offset) & 7) + 1
                local expected<const> = x == paint_x and y == paint_y and paint
                    or tiles.art:resolve(spec.frames[family][pose])
                assert(tiles:source_at(x, y) == expected and row.sources[i] == expected,
                    'the admitted and sampled water sources must share the authored pose')
                assert(row.overrides[x] == (x == paint_x and y == paint_y and paint or nil),
                    'water animation must not publish a persistent change to terrain')
                water_count = water_count + 1
            end
        end
    end
    return water_count
end

return { kind='integration', tests={
    water_pose_survives_partial_windows_backtrack_paint_and_reset=function(t)
        local _, stage<const>, pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.state_machines:set_enabled(false)
        local tiles<const>, water<const> = stage.stage_tiles, stage.water
        local authored<const> = bin.decode(assets.data_nemesis_s_stage_addr,'authored water test')
        local spec<const> = authored.water_animation
        local count<const> = stage.tile_columns + 2
        local first_wet, first_row = tiles.columns, spec.first_row
        for y = spec.first_row, #authored.tile_ids do
            for x = 1, first_wet - 1 do
                local tile<const> = authored.tile_ids[y][x]
                if tile ~= 0 and spec.tile_families[tile] ~= 0 then first_wet, first_row = x, y; break end
            end
        end
        assert(check_water_window(tiles, authored, water.phase, stage.left_tile, count) == 0,
            'the production start fixture should be dry')

        for _=1,spec.ticks_per_pose do water:tick(tiles) end
        local phase<const> = water.phase
        local leading<const> = first_wet - count + 1
        tiles:set_visible_columns(leading, count)
        assert(check_water_window(tiles, authored, phase, leading, count) > 0,
            'the first wet column must enter even when its module is partially visible')
        local paint<const> = tiles.art:resolve(authored.harbor_animation.empty)
        tiles:set_tile_source(first_wet, first_row, paint)
        for pose=1,8 do
            for _=1,spec.ticks_per_pose do water:tick(tiles) end
            assert(water.phase == ((phase + pose) & 7), 'water pose skipped a tick')
            check_water_window(tiles, authored, water.phase, leading, count, first_wet, first_row, paint)
        end
        tiles:set_tile_source(first_wet, first_row, nil)
        check_water_window(tiles, authored, phase, leading, count)
        tiles:set_visible_columns(leading + 1, count)
        check_water_window(tiles, authored, phase, leading + 1, count)
        tiles:set_visible_columns(leading, count)
        check_water_window(tiles, authored, phase, leading, count)
        tiles:set_visible_columns(1, count)
        assert(check_water_window(tiles, authored, phase, 1, count) == 0)
        tiles:set_visible_columns(leading, count)
        check_water_window(tiles, authored, phase, leading, count)

        -- Retrying at the same viewport still replaces the current ripple
        -- with its initial pose; a fast no-scroll return must not bypass it.
        if water.phase == 0 then
            for _=1,spec.ticks_per_pose do water:tick(tiles) end
        end
        stage.start_column = leading - 1
        stage:reset_runtime()
        assert(water.phase == 0 and water.elapsed == 0, 'checkpoint did not reset water time')
        assert(check_water_window(tiles, authored, 0, leading, count) > 0)
    end,
} }
