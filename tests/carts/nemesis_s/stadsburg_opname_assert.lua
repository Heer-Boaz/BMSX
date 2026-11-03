local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')
require('constants')
local route<const> = { 60,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,63,63,63,63,63,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,63,63,63,63,63,68,68,68,68,68,68,68,68,68,68,68,68,63,63,63,63,63,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,62,62,62,62,62,62,62,62,62,62,62,62,62,68,68,68,68,68,68,68,68,63,63,63,63,63,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,63,63,63,63,63,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,62,62,62,62,62,62,62,62,62,62,62,62,62,62,62,62,62,54,54,54,54,54,54,54,62,62,62,68,68,68,68,68,68,68,68,68,68,68,68,62,54,54,54,54,54,54,46,46,46,46,46,46,46,46,46,38,30,30,30,30,30,30,30,34,50,66,68,68,68,68,68,68,68,68,68,68,68,72,72,76,92,108,110,110,110,110,108,92,76,68,68,68,68,68,68,68,68,68,72,72,76,92,108,110,110,110,110,108,92,76,68,68,68,68,63,59,59,59,59,59,62,68,68,68,68,71,71,71,71,71,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,80,80,84,100,116,118,118,118,118,116,100,84,72,72,72,72,72,72,72,72,72,72,72,72,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,72,72,72,72,72,72,72,72,68,68,68,68,68,68,68,68,68,68,68,62,54,54,54,54,54,54,54,54,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,58,42,26,22,22,22,22,22,22,38,46,46,54,68,68,68,68,68,68,68,55,39,23,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,23,39,55,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68,68 }
local mills<const> = world:active_definition_view('nemesis_s.enemy.molen')
local moons<const> = world:active_definition_view(ids_moon_def)
local ice_view<const> = world:active_definition_view(ids_enemy_bullet_def)
local spark_view<const> = world:active_definition_view(ids_small_explosion_def)
local flight<const> = function(t, combat_period, approach_period, capture)
    local director<const>,stage<const>,player<const> = fixture.start_game(t)
    player.body_collider:set_enabled(false)
    local stop_ticks,moon_ticks,shots,previous_hp=0,0,0,12
    local wing_phase_end=0
    local first_axle_mask=-1
    local last=world.gameplay_time_ms
    for frame=1,stage.tape_length_tiles*8+1000 do
        t:wait_until('next physical update',function() return world.gameplay_time_ms~=last end,120)
        last=world.gameplay_time_ms
        local head<const> = stage.tape_head-1
        local mill<const> = mills.objects[1]
        local column<const> = stage.left_tile-1
        if head==145 or column==829 or head==924 then
            if stage.scroll_gate==1 then t:log(string.format('route|%d|%d|%d|%d',frame,last//1,head,column)) end
        end
        local target=route[column+1]
        -- Steer below the moving cargo as the two winches come into view.
        if column>=443 and column<=451 then target=116 end
        if column>=461 and column<=473 then target=136 end
        if head==828 and not stage.scrolling then
            stop_ticks=stop_ticks+1
            -- Fire through a gap while the cross is intact, then aim higher
            -- so the recording also shows the separate sails breaking.
            local _,my<const> = mill:get_global_position()
            if stop_ticks<48 then target=my-6
            elseif first_axle_mask<0 or stop_ticks>=wing_phase_end then target=my+9
            else target=my-7 end
        end
        local _,py<const> = player:get_global_position()
        local next_y<const> = py+math.max(-2,math.min(2,target-py))
        player:set_global_position(80,next_y)
        if mill and mill.vulnerable and stop_ticks>60 and math.abs(target-next_y)<3 and frame%combat_period==0 then
            player:fire_weapon_salvo()
            shots=shots+1
        elseif head<804 and frame%approach_period==0 then player:fire_weapon_salvo() end
        if mill and mill.health<previous_hp then
            if first_axle_mask<0 then first_axle_mask=mill.live_mask wing_phase_end=stop_ticks+95 end
            previous_hp=mill.health
        end
        if head==930 and moons.objects[1] and moons.objects[1]:get_global_position()<=200 then moon_ticks=moon_ticks+1 end
        -- Record actual object coordinates to compile the standalone MSX1 film.
        -- The Z80 cartridge replays ship, shots and loose ice as hardware sprites.
        if capture and head==828 and mill then
            local parts=''
            for _,p in ipairs({player.primary_projectiles[1],player.secondary_projectiles[1]}) do
                if p.type~=0 then parts=parts..string.format(',b:%d:%d',p.x//1,p.y//1) end
            end
            for _,ice in ipairs(ice_view.objects) do
                if ice.sprite_component.imgid=='molen_ijs' then
                    local ix<const>,iy<const> = ice:get_global_position()
                    parts=parts..string.format(',i:%d:%d',ix//1,iy//1)
                end
            end
            for _,hit in ipairs(spark_view.objects) do
                local hx<const>,hy<const> = hit:get_global_position()
                parts=parts..string.format(',s:%d:%d',hx//1,hy//1)
            end
            local px<const>,py<const> = player:get_global_position()
            t:log(string.format('vdp|%d|%d|%d|%d|%d|%d|%s|water=%d',frame,mill.step,mill.live_mask,mill.health,
                px//1,py//1,parts,stage.water.phase))
        end
        if capture and (frame%2==0 or (head>=814 and moon_ticks==0)) then
            t:capture(string.format('film|%d|%d|%d|%d|%d|%d',frame,last//1,head,mill and mill.health or -1,mill and mill.step or -1,mill and mill.live_mask or -1))
        end
        if moon_ticks>=72 then
            assert(previous_hp==0 and first_axle_mask>0 and shots>=1 and not stage.scrolling)
            return
        end
    end
    error('The ship did not reach the moon after the mill battle')
end

return {kind='integration',tests={
    -- Match the normal held-fire action effect; the recording does not accelerate the gun.
    scroll=function(t) flight(t,player_fire_repeat_updates,player_fire_repeat_updates,true) end,
    -- Preserve the full-flight workload which exposed exhaustion when the mill threw ice.
    -- Only the boss uses the original three-update stress cadence; approach stays at fourteen.
    spervuur=function(t) flight(t,3,14,false) end,
}}
