local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')

local count_overrides<const> = function(tiles)
    local count = 0
    for y=1,tiles._row_count do
        for _ in pairs(tiles._rows[y].overrides) do count=count+1 end
    end
    return count
end

-- Reconstruct each visible row from the immutable tape and its changed cells,
-- independently of the materialized ring's ordering or current head.
local check_layer<const> = function(tiles, first, count)
    local last<const> = math.min(first+count-1,tiles.columns)
    for y=1,tiles._row_count do
        local row<const> = tiles._rows[y]
        local cells<const>: *u16 = row.tape_address
        local index = 0
        while index<row.tape_count and cells[index*2]<first do index=index+1 end
        local slot = row.first_visible_source
        assert(row.source_count<=count and row.last_visible_source==slot+row.source_count-1,
            'the visible ring exceeded its viewport')
        for column=first,last do
            local source = row.overrides[column]
            if index<row.tape_count and cells[index*2]==column then
                if source==nil then source=tiles.art:resolve(cells[index*2+1]) end
                index=index+1
            end
            if source~=nil then
                assert(slot<=row.last_visible_source and row.columns[slot]==column
                    and row.sources[slot]==source, 'visible ring differs from the ROM row')
                slot=slot+1
            end
        end
        assert(slot==row.last_visible_source+1, 'visible ring contains an extra source')
    end
end

local check_water<const> = function(stage, first, count)
    local water<const>, tiles<const> = stage.water, stage.stage_tiles
    local last<const> = first+count-1
    for strip=(first-1-water.origin)//4,(first+count-2-water.origin)//4 do
        local group<const> = water.groups[strip]
        if group~=nil then
            local pose<const> = ((water.phase+group.offset)&7)+1
            for i=1,#group,3 do
                local column<const>, y<const> = group[i],group[i+1]
                if column>=first and column<=last then
                    assert(tiles:source_at(column,y)==group[i+2][pose],
                        'visible water source is not at the current phase')
                end
            end
        end
    end
end

local check_scenery<const> = function(t,stage,tag)
    local first<const>,count<const> = stage.left_tile,stage.tile_columns+2
    check_layer(stage.stage_tiles,first,count)
    check_layer(stage.background_tiles,first,count)
    check_water(stage,first,count)
    t:log(string.format('%s|%d|overrides=%d',tag,first,count_overrides(stage.stage_tiles)))
end

return {kind='integration',tests={
    full_tape_and_repeated_checkpoint_streaming=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.state_machines:set_enabled(false)
        -- Exercise the real scenery and scrolling, without allocating enemies;
        -- normal enemy admission and retirement are covered by the next case.
        stage.actor_spawn_index=stage.actor_spawn_count+1
        stage.scroll_stop_count=0
        stage.scrolling=true
        local count<const> = stage.tile_columns+2
        local last<const> = stage.tape_length_tiles-stage.tile_columns+1
        check_scenery(t,stage,'start')
        for column=stage.left_tile+1,last do
            stage:advance_tape()
            for _=1,8 do stage.water:tick(stage.left_tile,count); stage.harbor:tick() end
            if (column&63)==0 or column==last then check_scenery(t,stage,'forward') end
        end
        assert(stage.left_tile==last, 'stage did not traverse the whole tape')
        for _,column in ipairs({821,431,0,431,821,0}) do
            stage.start_column=column
            stage:reset_runtime()
            check_scenery(t,stage,'checkpoint')
        end
        assert(stage.water.phase==0, 'checkpoint did not reset the water')
        local saved_overrides<const> = count_overrides(stage.stage_tiles)
        stage.actor_spawn_index=stage.actor_spawn_count+1
        stage.scrolling=true
        for column=stage.left_tile+1,last do
            stage:advance_tape()
            for _=1,8 do stage.water:tick(stage.left_tile,count); stage.harbor:tick() end
            if (column&63)==0 or column==last then check_scenery(t,stage,'repeat') end
        end
        assert(count_overrides(stage.stage_tiles)==saved_overrides,
            'replaying the same scenery added more override positions')
    end,
    natural_enemy_admission_and_retirement=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        local initial_index<const> = stage.actor_spawn_index
        local first_definition<const> = stage.actor_spawns[initial_index].definition_id
        local objects<const> = world:active_definition_view(first_definition).objects
        local seen
        local observed = false
        local retired = false
        local peak_objects = #world._objects
        for elapsed=1,2500 do
            t:wait_ticks(1)
            if not observed and #objects>0 then seen=objects[1]; observed=true end
            if seen~=nil and seen._world_object_index==nil then retired=true; seen=nil end
            if #world._objects>peak_objects then peak_objects=#world._objects end
            if elapsed%250==0 then
                t:log(string.format('natural|%d|tiles=%d|admitted=%d|objects=%d|peak=%d|overrides=%d',
                    elapsed,stage.tile_steps,stage.actor_spawn_index-initial_index,#world._objects,
                    peak_objects,count_overrides(stage.stage_tiles)))
            end
        end
        assert(stage.tile_steps>100, 'natural stage did not scroll through early scenery')
        assert(stage.actor_spawn_index>initial_index, 'the stage did not admit authored enemies')
        assert(observed and retired, 'an admitted enemy was not retired during ordinary movement')
    end,
}}
