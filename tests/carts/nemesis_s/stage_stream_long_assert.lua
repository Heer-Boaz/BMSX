local fixture<const> = require('tests/carts/nemesis_s/fixture')
local velocity<const> = require('cartlib/velocity')
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
                if source==nil then source=tiles:source_at(column,y) end
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

local check_scenery<const> = function(t,stage,tag)
    local first<const>,count<const> = stage.left_tile,stage.tile_columns+2
    check_layer(stage.stage_tiles,first,count)
    check_layer(stage.background_tiles,first,count)
    t:log(string.format('%s|%d|overrides=%d',tag,first,count_overrides(stage.stage_tiles)))
end

-- This fixture drives two complete 900-column traversals in one guest test
-- phase, rather than distributing their work over normal display ticks.
return {kind='integration',phase_cycles={full_tape_and_repeated_checkpoint_streaming=203212800},tests={
    full_tape_and_repeated_checkpoint_streaming=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.state_machines:set_enabled(false)
        -- Exercise the real scenery and scrolling, without allocating enemies;
        -- normal enemy admission and retirement are covered by the next case.
        stage.actor_cue_index=stage.actor_cue_count
        stage.scroll_stop_count=0
        stage.scrolling=true
        local count<const> = stage.tile_columns+2
        local last<const> = stage.tape_length_tiles-stage.tile_columns+1
        check_scenery(t,stage,'start')
        for column=stage.left_tile+1,last do
            stage:advance_tape()
            for _=1,8 do stage.water:tick(stage.stage_tiles); stage.harbor:tick() end
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
        stage.actor_cue_index=stage.actor_cue_count
        stage.scrolling=true
        for column=stage.left_tile+1,last do
            stage:advance_tape()
            for _=1,8 do stage.water:tick(stage.stage_tiles); stage.harbor:tick() end
            if (column&63)==0 or column==last then check_scenery(t,stage,'repeat') end
        end
        assert(count_overrides(stage.stage_tiles)==saved_overrides,
            'replaying the same scenery added more override positions')
    end,
    natural_enemy_admission_and_retirement=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        local initial_index<const> = stage.actor_cue_index
        local objects<const> = world:active_definition_view(ids_sint_pop_def).objects
        local up<const> = { last_phase = -1 }
        local down<const> = { last_phase = -1 }
        local approach_vx<const> = velocity.pixels_per_second_to_velocity_q8(sint_pop_move_to_player_speed_x_px_per_second)
        local retreat_vx<const> = velocity.pixels_per_second_to_velocity_q8(sint_pop_move_away_speed_x_px_per_second)
        local observe<const> = function(track, vertical_speed)
            local foe<const> = track.foe
            if foe == nil or track.retired then return end
            local phase<const> = foe.flight_phase
            if foe._world_object_index == nil then
                assert(track.last_phase == sint_pop_flight_retreat and foe:get_global_position() > playfield_width,
                    'formation member retired before completing its retreat')
                track.retired = true
            elseif phase ~= track.last_phase then
                assert(phase == track.last_phase + 1, 'formation skipped a flight phase')
                local x<const> = foe:get_global_position()
                local motion<const> = foe.motion
                if phase == sint_pop_flight_approach then
                    assert(x == playfield_width and motion.velocity_x == approach_vx and motion.velocity_y == 0,
                        'the lead member moved before admission')
                elseif phase == sint_pop_flight_vertical then
                    assert(x <= sint_pop_vertical_start_x and motion.velocity_x == approach_vx
                        and motion.velocity_y == velocity.pixels_per_second_to_velocity_q8(vertical_speed),
                        'formation turned at the wrong threshold or with the wrong velocity')
                else
                    assert(x <= sint_pop_retreat_start_x and motion.velocity_x == retreat_vx and motion.velocity_y == 0,
                        'formation retreated at the wrong threshold or with the wrong velocity')
                end
                track.last_phase = phase
            end
        end
        local peak_objects = #world._objects
        for elapsed=1,2500 do
            t:wait_ticks(1)
            if up.foe == nil or down.foe == nil then
                for index=1,#objects do
                    local foe<const> = objects[index]
                    local track<const> = foe.group_type == sint_pop_group_up and up or down
                    if track.foe == nil then track.foe = foe end
                end
            end
            observe(up, sint_pop_move_vertical_up_speed_y_px_per_second)
            observe(down, sint_pop_move_vertical_down_speed_y_px_per_second)
            if #world._objects>peak_objects then peak_objects=#world._objects end
            if elapsed%250==0 then
                t:log(string.format('natural|%d|tiles=%d|admitted=%d|objects=%d|peak=%d|overrides=%d',
                    elapsed,stage.tile_steps,stage.actor_cue_index-initial_index,#world._objects,
                    peak_objects,count_overrides(stage.stage_tiles)))
            end
        end
        assert(stage.tile_steps>100, 'natural stage did not scroll through early scenery')
        assert(stage.actor_cue_index>initial_index, 'the stage did not admit authored enemies')
        assert(up.retired and down.retired, 'both authored formations must complete their flight and retire')
    end,
}}
