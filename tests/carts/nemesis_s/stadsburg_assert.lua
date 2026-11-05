local fixture<const> = require('tests/carts/nemesis_s/fixture')
local world<const> = require('cartlib/world/world')
require('constants')
local mill_view<const> = world:active_definition_view('nemesis_s.enemy.molen')
local gun_view<const> = world:active_definition_view(ids_kadekanon_def)
local ray_view<const> = world:active_definition_view(ids_schoorsteen_ray_def)
local wreck_view<const> = world:active_definition_view(ids_chimney_wreck_def)
local moon_view<const> = world:active_definition_view(ids_moon_def)
local bullet_view<const> = world:active_definition_view(ids_enemy_bullet_def)

local turret_view<const> = world:active_definition_view(ids_havengeschut_def)
local roodje_view<const> = world:active_definition_view(ids_roodje_def)
local roof_gun_view<const> = world:active_definition_view(ids_schoorsteen_foe_def)
local smoke_generator_view<const> = world:active_definition_view(ids_rook_generator_def)
local smoke_view<const> = world:active_definition_view(ids_rook_def)
local explosion_view<const> = world:active_definition_view(ids_large_explosion_def)
return {kind='integration',tests={
    roof_weapon_mounts=function(t)
        local director<const>,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        local checked=0
        for _,spawn in ipairs(stage.actor_spawns) do
            local laser<const> = spawn.definition_id==ids_schoorsteen_foe_def
            if laser or spawn.definition_id==ids_rook_generator_def then
                stage.start_column=spawn.column-stage.tile_columns
                stage:reset_runtime()
                stage:advance_tape()
                stage.scrolling=false
                local view<const> = laser and roof_gun_view or smoke_generator_view
                local weapon<const> = view.objects[#view.objects]
                -- This includes laser admission 433: the scout at 434 used
                -- to block it, moving the weapon eight pixels past its roof.
                assert(weapon and weapon.health>0 and stage.tape_head-1==spawn.column,
                    'A roof weapon missed its authored admission column')
                local x<const>,y<const> = weapon:get_global_position()
                local width<const> = weapon.sprite_component.source_width
                local height<const> = weapon.sprite_component.source_height
                -- The full-width collision base must rest on this real roof
                -- without overhanging or sinking into the supporting tile row.
                for foot_x=0,width-1 do
                    assert(stage:is_solid_pixel(x+foot_x,y+height)
                        and not stage:is_solid_pixel(x+foot_x,y+height-1),
                        'A roof weapon is floating, embedded or overhanging its support')
                end
                if laser then
                    weapon:enter_opening()
                    weapon:fire_ray()
                    local ray<const> = ray_view.objects[#ray_view.objects]
                    local rx<const>,ry<const> = ray:get_global_position()
                    assert(rx+schoorsteen_ray_tile_size//2==x+width//2
                        and ry==y+schoorsteen_ray_offset_y,
                        'Roof laser left the centre of its chamber')
                    ray:mark_for_disposal()
                else
                    weapon:enter_generating()
                    weapon:spawn_rook(nil,rook_rise_distances[1])
                    local cloud<const> = smoke_view.objects[#smoke_view.objects]
                    local cx<const> = cloud:get_global_position()
                    assert(cx+cloud.sprite_component.source_width//2==x+width//2,
                        'Smoke left the side of its roof chamber')
                    cloud:mark_for_disposal()
                end
                weapon:receive_player_projectile({damage=weapon.health})
                local wreck<const> = wreck_view.objects[#wreck_view.objects]
                local wx<const>,wy<const> = wreck:get_global_position()
                assert(wreck.sprite_component.imgid==assets_chimney_wreck
                    and not wreck.sprite_component.flip_v
                    and wx+wreck.sprite_component.source_width//2==x+width//2
                    and wy+wreck.sprite_component.source_height==y+height,
                    'The roof wreck moved off its weapon support')
                local blast<const> = explosion_view.objects[#explosion_view.objects]
                local bx<const>,by<const> = blast:get_global_position()
                assert(bx+blast.sprite_component.source_width//2==x+width//2
                    and by+blast.sprite_component.source_height//2==y+height//2,
                    'The roof explosion lost the centre of its weapon')
                wreck:mark_for_disposal()
                blast:mark_for_disposal()
                checked=checked+1
            end
        end
        assert(checked==6,'Not all authored roof weapons were checked')
    end,
    small_turrets=function(t)
        local director<const>,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.start_column=139
        stage:reset_runtime()
        while stage.tape_head-1<195 do stage:advance_tape() end
        stage.scrolling=false
        local blue<const>,red<const> = turret_view.objects[1],turret_view.objects[2]
        assert(blue.variant=='blue_floor' and red.variant=='red_floor')
        assert(blue.bank.columns==2 and blue.bank.tile_count==4 and blue.health==1)
        assert(red.drop_definition_id==ids_roodje_def and blue.drop_definition_id==nil)
        local x<const>,y<const> = blue:get_global_position()
        pilot:set_global_position(4,y-9)
        t:wait_until('level barrel to the left',function() return blue.aim==1 end,120)
        pilot:set_global_position(x-4,y-84)
        t:wait_until('steep barrel',function() return blue.aim==3 or blue.aim==4 end,120)
        pilot:set_global_position(x+88,y-9)
        t:wait_until('level barrel to the right',function() return blue.aim==6 end,120)
        pilot:set_global_position(16,53)
        t:wait_until('live round from the blue turret',function() return blue.shot_phase>0 end,180)
        t:capture('turret-01-de-brug')
        local before<const> = #roodje_view.objects
        pilot:set_global_position(x-32,y+1)
        pilot:spawn_bullet(1,x-32,y+1,pilot.primary_projectiles[1])
        t:wait_until('blue turret breaks on an ordinary shot',function() return blue.health==0 end,80)
        t:wait_ticks(38)
        assert(#roodje_view.objects==before)
        local rx<const>,ry<const> = red:get_global_position()
        pilot:set_global_position(rx-32,ry+1)
        pilot:spawn_bullet(1,rx-32,ry+1,pilot.primary_projectiles[1])
        t:wait_until('red turret drops a power capsule',function() return red.health==0 and #roodje_view.objects>before end,100)
        t:capture('turret-02-roodje')
    end,
    hanging_turret=function(t)
        local director<const>,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        stage.start_column=431
        stage:reset_runtime()
        while stage.tape_head-1<482 do stage:advance_tape() end
        stage.scrolling=false
        local gun
        for _,item in ipairs(turret_view.objects) do if item.variant=='red_ceiling' then gun=item end end
        assert(gun and gun.hanging)
        local gx<const>,gy<const> = gun:get_global_position()
        assert(gy==24)
        pilot:set_global_position(gx-68,73)
        t:wait_until('ceiling turret shoots into the navigable lane',function()
            for _,shot in ipairs(bullet_view.objects) do
                local sx<const>,sy<const> = shot:get_global_position()
                if sx>gx-12 and sx<gx+14
                and sy>=gy+9 and shot.motion.velocity_y>0 and shot.motion.velocity_x<0 then return true end
            end
            return false
        end,210)
        t:capture('turret-03-onder-de-hijswerf')
    end,
    early_clear=function(t)
        local director<const>,stage<const>,player<const> = fixture.start_game(t)
        stage.start_column=771
        stage:reset_runtime()
        while stage.tape_head-1<814 do stage:advance_tape() end
        local mill<const> = mill_view.objects[1]
        assert(mill and mill.vulnerable and stage.scrolling)
        mill.step=2
        mill:show_pose()
        local mx<const>,my<const> = mill:get_global_position()
        assert(mill:receive_player_projectile({x=mx+38,y=my+15,damage=12,collider={local_right=3,local_bottom=1}},1))
        assert(mill.health==0 and stage.scrolling)
        while stage.tape_head-1<829 do stage:advance_tape() end
        assert(stage.scrolling)
        while stage.tape_head-1<930 do stage:advance_tape() end
        assert(not stage.scrolling and #moon_view.objects==1)
    end,
    hanging_cannon=function(t)
        local director<const>,stage<const>,player<const> = fixture.start_game(t)
        player.body_collider:set_enabled(false)
        stage.start_column=455
        stage:reset_runtime()
        while stage.tape_head-1<499 do stage:advance_tape() end
        stage.scrolling=false
        local gun<const> = gun_view.objects[1]
        assert(gun and gun.ray_direction==1)
        local gx<const>,gy<const> = gun:get_global_position()
        player:set_global_position(gx-20,90)
        t:wait_until('ceiling chamber fills',function() return gun.sprite_component.imgid=='kade_fill' end,350)
        t:capture('kade-01-lading')
        t:wait_until('downward ray leaves chamber',function() return #ray_view.objects>0 end,180)
        local ray<const> = ray_view.objects[1]
        assert(ray.direction==1 and ray.ray_strip.step_y==8)
        local rx<const>,ry<const> = ray:get_global_position()
        assert(ry+8==gy+24 and rx==gx+12)
        assert(ray.max_tiles>0 and stage:is_solid_pixel(rx,ry+(ray.max_tiles+1)*8))
        t:wait_ticks(7)
        t:capture('kade-02-straal')
        gun:receive_player_projectile({damage=gun.health})
        t:wait_until('shared hanging wreck',function() return #wreck_view.objects>0 end,100)
        local remains<const> = wreck_view.objects[1]
        assert(remains.sprite_component.imgid==assets_chimney_wreck and remains.sprite_component.flip_v)
        t:capture('kade-03-wrak')
    end,
    harbour_to_moon=function(t)
        local director<const>,stage<const>,player<const> = fixture.start_game(t)
        player.body_collider:set_enabled(false)
        local order<const> = stage.actor_spawns
        local saw_mill=false
        local escorts=0
        for i=1,#order-1 do
            local id=order[i].definition_id
            if saw_mill then assert(id==ids_mijter_foe_def) escorts=escorts+1 end
            if id=='nemesis_s.enemy.molen' then saw_mill=true end
        end
        assert(saw_mill and escorts>0 and order[#order].definition_id==ids_moon_def)
        for _,a in ipairs(order) do
            assert(a.definition_id~=ids_bel_def and a.definition_id~=ids_kerk_def and a.definition_id~=ids_sneeuwpop_def)
        end
        stage.start_column=771
        stage:reset_runtime()
        while stage.tape_head-1<828 do stage:advance_tape() end
        local mill<const> = mill_view.objects[1]
        assert(mill and not stage.scrolling and #moon_view.objects==0)
        local x<const>,y<const> = mill:get_global_position()
        assert(x>=120 and x+112<=256)
        assert(mill.vulnerable and mill.axle.enabled and mill.live_mask==15)
        assert(#mill.tile_ids==432 and stage.starfield.mill_arena)
        player:set_global_position(52,84)
        local initial<const> = mill.step
        t:wait_until('next fixed tile pose',function() return mill.step~=initial end,120)
        t:capture('molen-01-tegelstand')
        t:wait_until('snow leaves a sail tip',function()
            for _,shot in ipairs(bullet_view.objects) do if shot.sprite_component.imgid=='molen_ijs' then return true end end
            return false
        end,200)
        t:capture('molen-02-ijs')
        -- A beam test covering both the axle and the left sail deliberately
        -- delivers the axle contact first, as a native overlap list may do.
        local broad<const> = {x=x-20,y=y+15,damage=1,continuous_damage=true,collider={local_right=74,local_bottom=2}}
        mill.step=0
        mill:show_pose()
        local full<const> = mill.health
        assert(mill:receive_player_projectile(broad,1))
        assert(mill.health==full and mill.blade_hp[4]==2)
        assert(mill:receive_player_projectile(broad,5))
        assert(mill.health==full and mill.blade_hp[4]==2)
        -- A normal laser fired by the ship hits this intact sail, independently
        -- of the synthetic multi-contact probe above. Park its pose for this test.
        mill.dwell=-100
        player:set_global_position(x-40,y+11)
        player:spawn_laser(1,x-40,y+11,player,1)
        t:wait_until('ship laser blocked by the horizontal sail',function() return mill.blade_hp[4]<2 end,120)
        assert(mill.health==full)
        local burst<const> = {x=x-20,y=y+15,damage=3,collider={local_right=74,local_bottom=2}}
        if mill.blade_hp[4]>0 then assert(mill:receive_player_projectile(burst,5)) end
        assert(mill.live_mask==7 and not mill.blades[4].enabled and mill.health==full)
        t:capture('molen-03-gebroken-wiek')
        for step=1,16 do
            mill.step=step%16
            mill:show_pose()
            assert(mill.live_mask==7 and not mill.blades[4].enabled)
        end
        -- On the same horizontal line, the damaged pose now exposes the axle.
        player:spawn_laser(1,x-40,y+11,player,1)
        t:wait_until('ordinary laser reaches the visible axle',function() return mill.health<full end,120)
        assert(mill.health>0 and mill.vulnerable and not stage.scrolling)
        t:capture('molen-04-naaf')
        -- Finish intact individual sails at the left of the same registered pose.
        for blade=1,3 do
            mill.step=(12-(blade-1)*4)&15
            mill:show_pose()
            assert(mill:receive_player_projectile(burst,blade+1))
            assert(mill.blade_hp[blade]==0 and not mill.blades[blade].enabled)
        end
        assert(mill.live_mask==0 and mill.health>0)
        mill.health=1
        player:spawn_laser(1,x-40,y+11,player,1)
        t:wait_until('axle defeat releases camera',function() return mill.health==0 and stage.scrolling end,160)
        assert(not mill.axle.enabled and mill.live_mask==0)
        t:capture('molen-05-stilgevallen')
        -- Fly the departure at native speed so escorts retire through the normal game loop.
        t:wait_until('native departure reaches the moon arena',function() return stage.tape_head-1==930 end,2800)
        assert(#moon_view.objects==1 and not stage.scrolling)
        t:wait_until('moon enters the visible arena',function() return moon_view.objects[1]:get_global_position()<=200 end,600)
        t:wait_ticks(4)
        t:capture('maan-05-ruimte')
    end,
}}
