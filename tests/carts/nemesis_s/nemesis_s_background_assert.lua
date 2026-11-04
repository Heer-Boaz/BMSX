local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')

local wait_update<const> = function(t)
    local before<const> = world.gameplay_time_ms
    t:wait_until('next gameplay update',function() return world.gameplay_time_ms~=before end,120)
end

local assert_window<const> = function(stage)
    local background<const> = stage.background_tiles
    local foreground<const> = stage.stage_tiles
    assert(background.owner==stage and background~=foreground and background.tile_count>0,
        'the backdrop must remain a separate stage-owned visual')
    assert(background._first_visible_column==foreground._first_visible_column
        and background._last_visible_column==foreground._last_visible_column,
        'the backdrop did not follow the terrain camera window')
    assert(stage.starfield.stage==stage,
        'the starfield retained a different camera owner')
end

local flight_and_checkpoints<const> = function(t)
    local director<const>,stage<const>,ship<const> = fixture.start_game(t)
    local flying<const> = ship.state_machines:bind_state_path('/active/flying')
    t:wait_until('vulnerable pilot',function()
        return ship.state_machines:matches_state(flying)
    end,120)
    stage.start_column=558
    stage:reset_runtime()
    stage.scrolling=false
    ship:set_global_position(26,136)
    wait_update(t)
    local background<const> = stage.background_tiles
    local rows<const> = background._rows
    local stars<const> = stage.starfield
    local spans<const> = stars.star_spans
    assert(spans and #spans>0,'the authored space boundaries were not admitted')
    assert_window(stage)
    local solids<const> = {}
    for y,row in ipairs(stage.solid_tape) do
        local copy<const> = {}
        for word,value in ipairs(row) do copy[word]=value end
        solids[y]=copy
    end
    local lives<const> = ship.player_state.lives
    local initial_x<const> = ship:get_global_position()
    local crossed_art=false
    local crossed_source,crossed_column,crossed_row
    t:capture('backdrop flight begins over the inner harbor')
    t:down('right',1)
    for update=1,24 do
        wait_update(t)
        assert(ship.player_state.lives==lives and ship.state_machines:matches_state(flying),
            'background scenery killed the vulnerable pilot')
        assert(ship.body_collider.enabled and ship.body_collider.mask==collision_player_mask,
            'background flight must retain the ordinary player collider')
        local x<const>,y<const> = ship:get_global_position()
        local row<const> = rows[(y+4)//stage.tile_size+1]
        local column<const> = stage.left_tile+(x+8)//stage.tile_size
        for slot=1,row.source_count do
            if row.columns[slot]==column and row.sources[slot] then
                crossed_art=true
                crossed_source=row.sources[slot]
                crossed_column=column
                crossed_row=(y+4)//stage.tile_size+1
                break
            end
            if row.columns[slot]>column then break end
        end
    end
    t:up('right',1)
    assert(ship:get_global_position()>initial_x and crossed_art,
        'normal input did not cross any populated background tiles')
    t:capture('vulnerable pilot flies through the distant waterfront')
    stage:advance_tape()
    assert_window(stage)

    -- Reset selects the same world window immediately. Visual camera
    -- changes must not rewrite terrain roles or retain an old water pose.
    for _,left in ipairs({0,225,431,558,720,850,433}) do
        stage.start_column=left
        stage:reset_runtime()
        stage.scrolling=false
        assert_window(stage)
        assert(stage.background_tiles==background and background._rows==rows,
            'a checkpoint rebuilt the retained backdrop')
        assert(stage.starfield==stars and stars.star_spans==spans and not stars.mill_arena,
            'a checkpoint retained the mill sky or replaced the authored star spans')
        assert(stage.water.phase==0 and stage.water.elapsed==0,
            'background selection changed the water reset contract')
        for y,row in ipairs(stage.solid_tape) do
            for word,value in ipairs(row) do
                assert(value==solids[y][word],
                    'a scenery checkpoint changed the native terrain collision tape')
            end
        end
    end
    ship:set_global_position(48,48)
    wait_update(t)
    t:capture('checkpoint restores the wharf backdrop')

    -- Keep only identities and storage that disposal clears. Holding the old
    -- stage/ship/rows here would make the fixture retain two full levels.
    return director,{
        stage_id=stage.id,background_id=background.id,starfield_id=stars.id,
        stage_components=stage._components,starfield_components=stars._components,
        stages=world:active_definition_view(stage.definition_id),
        source=crossed_source,column=crossed_column,row=crossed_row,
    }
end

return {kind='integration',tests={
    backdrop_flight_camera_checkpoint_and_scene_lifetime=function(t)
        local director<const>,previous<const> = flight_and_checkpoints(t)
        director.state_machines:transition_to('/game_start')
        t:wait_until('replacement gameplay composition',function()
            return director.stage~=nil and director.stage._components~=previous.stage_components
        end,120)
        assert(#previous.stage_components==0 and #previous.starfield_components==0,
            'scene replacement retained the old stage or starfield components')
        director.state_machines:transition_to('/gameplay')
        local next_stage<const> = director.stage
        t:wait_until('replacement background admission',function()
            return next_stage.background_tiles.tile_count>0
        end,120)
        assert_window(next_stage)
        assert(#previous.stages.objects==1 and previous.stages.objects[1]==next_stage,
            'scene replacement retained another active stage')
        assert(next_stage.starfield._components~=previous.starfield_components,
            'the replacement stage reused the disposed starfield storage')
        local registered_stage<const> = registry:get(previous.stage_id)
        local registered_background<const> = registry:get(previous.background_id)
        local registered_stars<const> = registry:get(previous.starfield_id)
        assert((registered_stage==nil or registered_stage==next_stage)
            and (registered_background==nil or registered_background==next_stage.background_tiles)
            and (registered_stars==nil or registered_stars==next_stage.starfield),
            'scene replacement retained an old registered scenery owner')
        local reused_view=false
        local next_row<const> = next_stage.background_tiles._rows[previous.row]
        for slot=1,next_row.source_count do
            if next_row.columns[slot]==previous.column then
                reused_view=next_row.sources[slot]==previous.source
                break
            end
        end
        assert(reused_view,
            'a new game allocated another atlas-held view for the same background tile')
        wait_update(t)
        t:capture('new game restores the space approach')
    end,
}}
