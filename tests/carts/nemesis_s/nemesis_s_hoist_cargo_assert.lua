local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')

local wait_update<const> = function(t)
    local before<const> = world.gameplay_time_ms
    t:wait_until('next gameplay update',function() return world.gameplay_time_ms~=before end,120)
end

local assert_flying<const> = function(ship,lives,flying)
    assert(ship.player_state.lives==lives,'the vulnerable pilot lost a life at the hoist')
    assert(ship.state_machines:matches_state(flying),
        'the hoist passage entered death or respawn invulnerability')
    assert(ship.body_collider.enabled and ship.body_collider.mask==collision_player_mask,
        'the passage must retain the ordinary player collider')
end

local assert_cargo_clear<const> = function(harbor,cargo)
    assert(cargo.health==0,'ordinary fire did not destroy the load')
    for _,cell in ipairs(cargo.cells) do
        if harbor.cargo_patterns[cell[cargo.pose+3]] then
            assert(cell.pattern==0 and cell.sources[cell.slot]==harbor.patterns[0],
                'destroyed cargo returned in the animated tile layer')
            assert((cell.solid_row[cell.solid_word]&cell.solid_mask)==0,
                'destroyed cargo left an invisible solid tile')
        end
    end
end

local passage<const> = function(t,left,anchor,row,altitude,moving,rewind)
    local _,stage<const>,ship<const> = fixture.start_game(t)
    local flying<const> = ship.state_machines:bind_state_path('/active/flying')
    t:wait_until('vulnerable pilot',function()
        return ship.state_machines:matches_state(flying)
    end,120)
    -- Only the initial checkpoint/approach is placed by the fixture. From
    -- here on, physical gamepad input and the scrolling stage move the ship.
    stage.start_column=left
    stage:reset_runtime()
    ship:set_global_position(26,altitude)
    wait_update(t)
    local cargo<const> = stage.harbor.cargo_rows[row][anchor+1].cargo
    local lives<const> = ship.player_state.lives
    local rest_pose<const> = cargo.pose
    local saw_motion=false
    local previous_health=cargo.health
    local hits=0
    t:capture('hoist approach')
    t:down('a',1)
    for update=1,110 do
        wait_update(t)
        assert_flying(ship,lives,flying)
        if cargo.pose~=rest_pose then saw_motion=true end
        if cargo.health<previous_health then
            hits=hits+previous_health-cargo.health
            previous_health=cargo.health
            if hits==1 then t:capture('first ordinary shot hits the load') end
        end
        if cargo.health==0 then break end
    end
    assert(hits==3,'three default bullets must destroy the hoist load')
    assert(not moving or saw_motion,'the live winch did not move during the approach')
    assert_cargo_clear(stage.harbor,cargo)
    t:capture('load destroyed and route open')

    t:down('right',1)
    local crossed=false
    for update=1,100 do
        wait_update(t)
        assert_flying(ship,lives,flying)
        assert_cargo_clear(stage.harbor,cargo)
        local x<const> = ship:get_global_position()
        if x+stage.total_scroll_px>=(anchor+2)*stage.tile_size then
            crossed=true
            break
        end
    end
    t:up('right',1)
    t:up('a',1)
    assert(crossed and stage.left_tile>left+1,
        'normal input must cross the whole load while the level scrolls')
    t:capture('vulnerable pilot past the load')

    if rewind then
        stage.scrolling=false
        -- A completed one-shot winch has left the animation active list.
        -- Damage must still persist, and checkpoint reset must restore it.
        for update=1,140 do
            wait_update(t)
            assert_flying(ship,lives,flying)
            assert_cargo_clear(stage.harbor,cargo)
        end
        for _,clip in ipairs(stage.harbor.active) do
            assert(clip~=cargo,'the reset regression must cover a completed winch')
        end
        stage:reset_runtime()
        stage.scrolling=false
        assert(cargo.health==cargo.max_health,'checkpoint reset did not restore cargo health')
        for _,cell in ipairs(cargo.cells) do
            if stage.harbor.cargo_patterns[cell[4]] then
                local art<const> = cell.visuals and cell.visuals[1] or stage.harbor.patterns[cell[4]]
                assert(cell.pattern==cell[4] and cell.sources[cell.slot]==art,
                    'checkpoint reset did not restore cargo art')
                assert((cell.solid_row[cell.solid_word]&cell.solid_mask)~=0,
                    'checkpoint reset did not restore cargo collision')
            end
        end
        t:capture('checkpoint restores the load')
    end
end

return {kind='integration',tests={
    first_winch_normal_fire_and_passage=function(t)
        passage(t,431,459,9,82,true,false)
    end,
    second_winch_normal_fire_passage_and_reset=function(t)
        passage(t,459,480,9,94,true,true)
    end,
    stationary_load_normal_fire_and_passage=function(t)
        passage(t,611,634,10,82,false,false)
    end,
    missiles_hit_cargo_from_above_and_napalm_keeps_its_blast=function(t)
        local _,stage<const>,ship<const> = fixture.start_game(t)
        stage.start_column=611
        stage:reset_runtime()
        stage.scrolling=false
        ship:set_global_position(26,82)
        wait_update(t)
        local cargo<const> = stage.harbor.cargo_rows[10][635].cargo
        local missile<const> = ship.missile_projectiles[1]
        for level=1,3 do
            stage:reset_runtime()
            stage.scrolling=false
            -- This is the normal surface-contact sample above the right
            -- shoulder, clear of the central hook. It must hit the load,
            -- while ordinary scenery still supports a travelling missile.
            ship:spawn_missile(1,184,57,level)
            ship:update_weapons()
            assert(cargo.health==cargo.max_health-1,
                'a missile landing on the load failed to damage it')
            if level<3 then
                assert(missile.type==0,'a standard missile was not consumed by its cargo hit')
            else
                assert(missile.type==6,'Napalm hit the load without admitting its blast')
                ship:update_weapons()
                assert(cargo.health==cargo.max_health-1,
                    'overlapping blast tiles damaged one load repeatedly in the same update')
                wait_update(t)
                assert(cargo.health==cargo.max_health-2,
                    'a continuing Napalm blast must damage the load once on its next update')
                wait_update(t)
                assert_cargo_clear(stage.harbor,cargo)
                ship:despawn_missile(missile,'test_reset')
            end
        end
        stage:reset_runtime()
        stage.scrolling=false
        ship:spawn_missile(1,160,73,3)
        ship:update_weapons()
        assert(cargo.health==cargo.max_health-1 and missile.type==6,
            'a side impact must also retain Napalm damage and detonation')
    end,
    laser_and_uplaser_hit_the_load_once_per_projectile=function(t)
        local _,stage<const>,ship<const> = fixture.start_game(t)
        stage.start_column=611
        stage:reset_runtime()
        stage.scrolling=false
        ship:set_global_position(26,82)
        wait_update(t)
        local cargo<const> = stage.harbor.cargo_rows[10][635].cargo
        ship:spawn_laser(1,26,82,ship,1)
        t:wait_until('laser hits cargo',function() return cargo.health<cargo.max_health end,120)
        t:wait_until('retained laser retracts',function() return ship.primary_projectiles[1].type==0 end,120)
        assert(cargo.health==cargo.max_health-1,'a retracting laser damaged the same load twice')
        ship:spawn_uplaser(1,176,108,1)
        t:wait_until('up-laser hits cargo',function() return ship.secondary_projectiles[1].type==0 end,120)
        assert(cargo.health==cargo.max_health-2,'the up-laser did not damage the load from below')
    end,
}}
