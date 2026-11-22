local fixture<const> = require('tests/carts/nemesis_s/fixture')
local assets<const> = require('bmsx/assets')
local bin<const> = require('cartlib/bin')
local gp0<const> = require('cartlib/gx/gp0')

local check_layer<const> = function(tiles, original_rows, assets, invisible, harbor_rest, water, phase, first, last)
    local background<const> = harbor_rest == nil
    local size<const> = tiles._tile_size
    local domains<const> = tiles._coordinate_domain_columns
    local capacity<const> = tiles._window_capacity
    for y=1,tiles._row_count do
        local row<const> = tiles._rows[y]
        local original<const> = original_rows[y]
        local original_index = 1
        local slot = row.first_visible_source
        assert(row.source_count <= capacity and row.last_visible_source == slot + row.source_count - 1)
        for x=first,last do
            local id
            if background then
                while original_index <= #original and original[original_index] < x do
                    original_index = original_index + 2
                end
                if original_index <= #original and original[original_index] == x then
                    id = original[original_index + 1]
                    original_index = original_index + 2
                end
            else id = original[x] end
            local source = row.overrides[x]
            if source == nil and not background then source = harbor_rest[y][x] end
            if source == nil and id ~= nil and id ~= 0 and not invisible[id] then
                local art = assets[id]
                if water ~= nil and y >= water.first_row then
                    local family<const> = water.tile_families[id]
                    if family ~= 0 then
                        local strip<const> = (x - 1 - water.origin_column) // 4
                        local pose<const> = ((phase + water.phase_offsets[(strip & 7) + 1]) & 7) + 1
                        art = water.frames[family][pose]
                    end
                end
                source = tiles.art:resolve(art)
            end
            if source ~= nil then
                if slot > row.last_visible_source or row.columns[slot] ~= x then
                    error('visible row lost or reordered an authored column: layer='..tostring(background)
                        ..' row='..y..' expected='..x..' got='..tostring(row.columns[slot])..' first='..first)
                end
                assert(row.sources[slot] == source, 'visible tile differs from authored or animated source')
                assert(row.coordinate_domains[slot] == ((x - 1) // domains) + 1)
                assert(row.position_words[slot] == gp0.pair16(((x - 1) % domains) * size, (y - 1) * size))
                slot = slot + 1
            end
        end
        assert(slot == row.last_visible_source + 1, 'visible row admitted a tile outside the window')
    end
end

return {kind='integration',phase_cycles={bounded_window_preserves_authored_tiles_on_scroll_wrap_and_checkpoints=67737600},tests={
    bounded_window_preserves_authored_tiles_on_scroll_wrap_and_checkpoints=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.scrolling=false
        local original<const> = bin.decode(assets.data_nemesis_s_stage_addr,'window regression source')
        local foreground<const>, background<const> = stage.stage_tiles, stage.background_tiles
        local harbor<const> = original.harbor_animation
        local empty<const> = foreground.art:resolve(harbor.empty)
        local initial<const> = {}
        for y=1,#original.tile_ids do initial[y] = {} end
        for _,clip in ipairs(harbor.clips) do
            for index,cell in ipairs(clip.cells) do
                if clip.visuals then
                    local tile<const> = clip.visuals[index][1]
                    initial[cell[2]][cell[1]] = tile ~= 0 and foreground.art:resolve(tile) or empty
                elseif cell[4] == 0 then initial[cell[2]][cell[1]] = empty end
            end
        end
        local invisible<const> = {}
        for _,id in ipairs(original.sky_actor_ids) do invisible[id] = true end
        local visible<const> = {}
        local count<const> = stage.tile_columns + 2
        local check<const> = function(first)
            local last<const> = math.min(first + count - 1, stage.tape_length_tiles)
            foreground:set_visible_columns(first,count)
            background:set_visible_columns(first,count)
            check_layer(foreground,original.tile_ids,original.tile_assets,invisible,initial,
                original.water_animation,stage.water.phase,first,last)
            check_layer(background,original.background.rows,original.background.tile_assets,visible,nil,nil,0,first,last)
        end
        for x=1,100 do check(x) end
        for x=99,1,-1 do check(x) end
        for _,x in ipairs({127,128,129,255,256,257,432,558,821,900,931,1}) do check(x) end
        -- Scenery changes survive eviction and a backward jump.
        local clip<const> = harbor.clips[1]
        local cell<const> = clip.cells[1]
        local changed<const> = empty
        foreground:set_tile_source(cell[1],cell[2],changed)
        check(1)
        check(cell[1])
        assert(foreground:source_at(cell[1],cell[2])==changed)
        check(1)
        check(cell[1])
        assert(foreground:source_at(cell[1],cell[2])==changed,'eviction lost a changed source')
    end,
}}
