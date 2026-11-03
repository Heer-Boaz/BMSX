local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')
return {kind='integration',tests={
    reflectie=function(t)
        local director<const>,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        -- The lamp on the small quay and the houses on the opposite bank.
        stage.start_column=431
        stage:reset_runtime()
        stage.scrolling=false
        pilot:set_global_position(48,48)
        local left<const> = stage.left_tile
        local water<const> = stage.water
        local first_ms
        for i=0,8 do
            local wanted<const> = i&7
            t:wait_until('next settled water pose',function()
                return water.phase==wanted and water.elapsed==2
            end,180)
            assert(stage.left_tile==left and not stage.scrolling)
            if i==0 then first_ms=world.gameplay_time_ms end
            t:capture(string.format('water|%d|%d',i,world.gameplay_time_ms//1))
        end
        assert(world.gameplay_time_ms-first_ms>=1920 and world.gameplay_time_ms-first_ms<1940)
        stage.start_column=0
        stage:reset_runtime()
        assert(stage.left_tile==1 and water.phase==0)
        -- The opposite end of the stage is open space. A checkpoint inside
        -- the canal selects the correct world-anchored drawing immediately.
        stage.start_column=821
        stage:reset_runtime()
        stage.start_column=431
        stage:reset_runtime()
        stage.scrolling=false
        t:wait_until('water resumes after a checkpoint',function() return water.phase==1 end,180)
    end,
}}
