local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')

local scene<const> = function(t, left, warm)
    local _,stage<const>,ship<const> = fixture.start_game(t)
    stage.start_column=left-warm
    stage:reset_runtime()
    while stage.left_tile-1<left do stage:advance_tape() end
    stage.scrolling=false
    ship:set_global_position(26,72)
    return stage,ship
end

local wait_update<const> = function(t)
    local old<const> = world.gameplay_time_ms
    t:wait_until('volgende spelupdate',function() return world.gameplay_time_ms~=old end,120)
end

local environment<const> = function(t,tag,left,frames,cycles)
    local st<const>,ship<const> = scene(t,left,32)
    ship.body_collider:set_enabled(false)
    -- Wind changes the drawing, never the native terrain collision. Keep the
    -- camera still so the captured pixels also prove movement within the art.
    local solids<const> = {}
    for y,row in ipairs(st.solid_tape) do
        local saved<const> = {}
        for word,value in ipairs(row) do saved[word]=value end
        solids[y]=saved
    end
    if frames==nil then
        frames=0
        for _,clip in ipairs(st.harbor.active) do
            if clip.label=='linde' or string.sub(clip.label,1,6)=='groen_' then
                local duration=0
                for _,cue in ipairs(clip.steps) do duration=duration+cue[2] end
                frames=math.max(frames,duration*cycles+2)
            end
        end
        assert(frames>0,'the held-camera scene must contain animated greenery')
        if tag=='plantsoen' then
            -- The shrubs retain different periods. Find a real shared rest
            -- interval after two cycles, rather than assuming their endpoints
            -- coincide with the tree's endpoint.
            local timelines<const> = {}
            local period=1
            for _,clip in ipairs(st.harbor.active) do
                if clip.label=='linde' or string.sub(clip.label,1,6)=='groen_' then
                    local duration=0
                    for _,cue in ipairs(clip.steps) do duration=duration+cue[2] end
                    timelines[#timelines+1]={clip.steps,duration}
                    local a,b=period,duration
                    while b~=0 do a,b=b,a%b end
                    period=(period//a)*duration
                end
            end
            local minimum<const> = frames-2
            frames=0
            for tick=minimum,minimum+period do
                local calm=true
                for _,timeline in ipairs(timelines) do
                    local phase=tick%timeline[2]
                    for _,cue in ipairs(timeline[1]) do
                        if phase<cue[2] then
                            if cue[1]~=1 or cue[2]-phase<3 then calm=false end
                            break
                        end
                        phase=phase-cue[2]
                    end
                    if not calm then break end
                end
                if calm then frames=tick+2;break end
            end
            assert(frames>0,'garden animation has no shared rest interval for the native loop')
        end
    end
    for i=1,frames do
        wait_update(t)
        assert(not st.scrolling and st.left_tile-1==left,'wind capture camera moved')
        for y,row in ipairs(solids) do
            for word,value in ipairs(row) do
                assert(st.solid_tape[y][word]==value,'wind animation changed terrain collision')
            end
        end
        t:capture(string.format('werf|%s|%d|%d|%d|0',tag,i,world.gameplay_time_ms//1,st.left_tile-1))
    end
end

local cargo<const> = function(t,tag,anchor,left,travel,frames)
    -- Starting at the same position as a checkpoint admits the winch at rest.
    local st<const>,ship<const> = scene(t,left,0)
    local lives<const> = ship.player_state.lives
    local sx<const> = (anchor-left)*8+4
    ship:set_global_position(sx-76,96+8*travel+3)
    local seen,previous,passed_under=0,0,false
    for i=1,frames do
        wait_update(t)
        local depth=0
        while st:is_solid_pixel(sx,96+8*depth) do depth=depth+1 end
        assert(depth<=travel and math.abs(depth-previous)<=1)
        assert(st:is_solid_pixel(sx,95+8*depth))
        local old_shoulder<const> = st:is_solid_pixel(sx-8,67)
        assert(old_shoulder==(depth==0),'old sack tile must be clear when only the narrow chain is there')
        assert(st:first_solid_vertical_tile_offset(sx,128,15,-1)==(128//8-(95+8*depth)//8))
        if depth>seen then seen=depth end
        previous=depth
        -- A real, vulnerable pilot crosses under the full extended load.
        local px<const> = math.min(sx+20,sx-76+i*(travel==2 and 2 or 1))
        ship:set_global_position(px,96+8*travel+3)
        if depth==travel and px+14>=sx-8 and px<sx+16 then passed_under=true end
        assert(ship.player_state.lives==lives)
        t:capture(string.format('werf|%s|%d|%d|%d|%d',tag,i,world.gameplay_time_ms//1,left,depth))
    end
    assert(seen==travel and previous==0 and (travel==2 or passed_under))
    -- Rewind during travel: the native solid tape and its tile layer reset together.
    st:reset_runtime();st.scrolling=false
    t:wait_until('lier viert opnieuw',function() return st:is_solid_pixel(sx,100) end,180)
    st:reset_runtime();st.scrolling=false
    assert(not st:is_solid_pixel(sx,100) and st:is_solid_pixel(sx-8,67))
end

return {kind='integration',tests={
    -- A second cycle exposes every branch pose after passing game sprites.
    linde=function(t) environment(t,'linde',157,nil,2) end,
    winkelgroen=function(t) environment(t,'winkelgroen',255,nil,1) end,
    straatgroen=function(t) environment(t,'straatgroen',282,nil,2) end,
    -- Two complete longest wind cycles give the native GIF a quiet loop.
    plantsoen=function(t) environment(t,'plantsoen',331,nil,2) end,
    kadetuin=function(t) environment(t,'kadetuin',400,nil,2) end,
    haventuin=function(t) environment(t,'haventuin',599,nil,2) end,
    sluisgroen=function(t) environment(t,'sluisgroen',678,nil,2) end,
    dak=function(t) environment(t,'dak',649,80,1) end,
    eerste_lier=function(t) cargo(t,'eerste',459,431,2,90) end,
    tweede_lier=function(t) cargo(t,'tweede',480,459,4,140) end,
    botsing=function(t)
        local st<const>,ship<const> = scene(t,459,0)
        local before<const> = ship.player_state.lives
        local sx<const> = (480-459)*8
        ship:set_global_position(sx-4,116)
        assert(not st:is_solid_pixel(sx+4,121))
        t:wait_until('dalende zak raakt het schip',function() return ship.player_state.lives<before end,400)
        assert(st:is_solid_pixel(sx+4,121) and ship.player_state.lives==before-1)
    end,
}}
