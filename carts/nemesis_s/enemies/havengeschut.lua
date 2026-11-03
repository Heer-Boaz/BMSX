local storage<const> = require('collision_storage')
local collider<const> = require('cartlib/collision/collider_2d_component')
local tile_layer<const> = require('cartlib/component/tile_layer_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local foe<const> = require('enemies/foe')
local enemy<const> = require('enemies/enemy')
local enemy_bullet<const> = require('enemies/enemy_bullet')
local follower<const> = require('stage_scroll_follower_component')
local frames<const> = require('enemies/turret_tiles')
require('constants')

local turret<const> = {}
turret.__index = turret
setmetatable(turret, { __index = foe })
local turret_fsm_id<const> = 'nemesis_s.enemy.havengeschut.fsm'
local muzzle_x<const> = {1,2,3,12,13,14}
local muzzle_y<const> = {5,2,1,1,2,5}
local players

function turret:point_at(index)
    if self.aim==index then return end
    self.aim=index
    local names<const> = self.poses[index]
    for cell=1,4 do self.bank:set_tile(cell,names[cell]) end
end

function turret:ctor()
    self.bank=self:get_component(tile_layer)
end

function turret:onspawn()
    self.poses=frames[self.variant]
    self.hanging=self.poses.hanging
    if self.poses.red then
        self.drop_definition_id=ids_roodje_def
    end
    self.wait_shot=40+(self.spawn_column&3)
    self.shot_phase=0
    self.bank:set_tile_size(8)
    self.bank:resize(4,2)
    self:point_at(1)
end

function turret:track()
    if enemy.dispose_if_left_of_stage(self,16) then return end
    self.wait_shot=self.wait_shot-1
    if (self.wait_shot&3)~=0 then return end
    local x<const>,y<const> = self:get_global_position()
    if x<0 then return end
    local tx,ty,nearest
    for _,pilot in ipairs(players.objects) do
        local pilot_x<const>,pilot_y<const> = pilot:get_global_position()
        local dx<const>,dy<const> = pilot_x-x,pilot_y+5-(y+7)
        local distance<const> = dx*dx+dy*dy
        if not nearest or distance<nearest then
            nearest=distance
            tx=pilot_x+8
            ty=pilot_y+5
        end
    end
    if not tx then return end
    local dx<const>,dy<const> = tx-(x+8),ty-(y+7)
    local angle<const> = enemy_bullet.horizontal_aim_angle(dx,dy)
    self:point_at(6-math.min(5,angle//21))
    if self.wait_shot>0 or (self.hanging and dy<0) or (not self.hanging and dy>0) then return end
    local mx<const> = x+muzzle_x[self.aim]
    local my<const> = y+(self.hanging and 15-muzzle_y[self.aim] or muzzle_y[self.aim])
    local vx<const>,vy<const> = enemy_bullet.aim_velocity(tx-mx,ty-my)
    if not vx or self.stage.last_turret_shot==world.gameplay_time_ms then return end
    self.stage.last_turret_shot=world.gameplay_time_ms
    self.scene:spawn(ids_enemy_bullet_def,{
        position={x=mx-2,y=my-2},stage=self.stage,
        velocity_x=vx,velocity_y=vy,
    })
    self.shot_phase=(self.shot_phase+1)&3
    self.wait_shot=self.shot_phase==0 and 160 or 80
end

function turret.register()
    players=world:active_definition_view(ids_player_def)
    fsm_library.register(turret_fsm_id,{initial='mounted',states={mounted={update=turret.track}}})
    prefab.define({def_id=ids_havengeschut_def,class=turret,components={
            function(owner) return tile_layer.new(owner,owner) end,
            collider.factory({id_local=0,geometry_pool=storage.area,local_area={left=0,top=0,right=16,bottom=16},
                layer=collision_enemy_layer,mask=collision_enemy_mask}),
            follower.new,fsm_component.factory({turret_fsm_id}),
        },defaults={order=schoorsteen_foe_draw_z,max_health=1,small_fry=true}})
end

return turret
