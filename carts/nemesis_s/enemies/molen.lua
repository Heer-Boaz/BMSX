local art<const> = require('enemies/molenpatronen')
local image<const> = require('cartlib/gx/image')
local gp0<const> = require('cartlib/gx/gp0')
local visual2d<const> = require('cartlib/component/visual_2d_component')
local collision_storage<const> = require('collision_storage')
local collider<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local ground_foe<const> = require('enemies/ground_foe')
local follower<const> = require('stage_scroll_follower_component')
require('constants')

local molen<const> = { definition_id = 'nemesis_s.enemy.molen' }
molen.__index = molen
setmetatable(molen, { __index = ground_foe })
local mill_fsm_id<const> = 'nemesis_s.enemy.molen.fsm'
local wreck_event<const> = 'enemy.structure.destroyed'
local axle_left<const>, axle_top<const> = art.hub_x-3,art.hub_y-4
local axle_right<const>, axle_bottom<const> = art.hub_x+3,art.hub_y+4
local players, tile_sheet

-- The GPU copies an 8x8 source rectangle for every occupied name-table cell.
-- One source image serves the entire bank and all poses. The BMSX background
-- clears to the same black as pattern zero, so its empty cells need no draw.
local draw_mill_tiles<const> = function(component, draw)
    component:resolve_pose()
    local grid<const> = component.owner.tile_ids
    local left<const> = component.wox+art.panel_left
    local top<const> = component.woy+art.panel_top
    local first_row<const> = math.max(0,(-top)//8)
    local last_row<const> = math.min(art.rows-1,(playfield_height-1-top)//8)
    local first_col<const> = math.max(0,(-left)//8)
    local last_col<const> = math.min(art.columns-1,(playfield_width-1-left)//8)
    for row=first_row,last_row do
        for column=first_col,last_col do
            local pattern<const> = grid[row*art.columns+column+1]-1
            if pattern~=0 then
                tile_sheet:draw_source_rect(draw,(pattern%art.sheet_columns)*8,(pattern//art.sheet_columns)*8,8,8,
                    left+column*8,top+row*8,0xffffffff,0,gp0.draw_mode_blend_half)
            end
        end
    end
end

local mill_tiles<const> = function(owner)
    local component<const> = visual2d.new(owner,owner,'molenbeeld')
    component:set_draw_function(draw_mill_tiles)
    return component
end

local direction<const> = function(step, blade)
    return (step + (blade-1)*4) & 15
end

function molen:show_pose()
    -- The four intact silhouettes repeat each quarter turn. Rotate the physical
    -- identities with them so that a broken sail stays missing for a full turn.
    local quarter<const> = self.step // 4
    local mask<const> = ((self.live_mask << quarter) | (self.live_mask >> (4-quarter))) & 15
    local rules<const>: *u16 = art.rules
    local shared<const>: *u16 = art.shared
    local cells<const>: *u16 = art.cells
    local offset = (self.step & 3)*art.cell_count*3
    for i=0,art.cell_count-1 do
        local dep<const> = rules[offset]
        local tile = rules[offset+1]
        if dep==16 then
            tile=shared[tile+mask]
        elseif (dep & mask)~=0 then
            tile=rules[offset+2]
        end
        self.tile_ids[cells[i]]=tile
        offset=offset+3
    end
    for blade=1,4 do
        if self.blade_hp[blade]>0 then
            local index<const> = direction(self.step,blade)+1
            local shape<const> = art.shapes[index]
            local part<const> = self.blades[blade]
            part:set_shape_asset(collision_storage.mill_sails[index])
            part:set_local_origin(shape.x,shape.y)
        end
    end
end

function molen:ctor()
    self.axle = self:get_component(collider,1)
    self.blades = {}
    self.blade_hp = {}
    self.blast_hits = {}
    for blade=1,4 do self.blades[blade]=self:get_component(collider,blade+1) end
end

function molen:onspawn()
    self.health = self.max_health * #players.objects
    self.step = 2
    self.dwell = 0
    self.live_mask = 15
    for blade=1,4 do self.blade_hp[blade]=3*#players.objects end
    self.tile_ids={}
    self.stage.starfield.mill_arena=true
    local base<const>: *u16 = art.base
    for cell=1,art.base_count do self.tile_ids[cell]=base[cell-1] end
    self:show_pose()
end

function molen:turn()
    self.dwell=self.dwell+1
    if self.dwell<5 then return end
    self.dwell=0
    self.step=(self.step+1)&15
    self:show_pose()
    if self.stage.scrolling then return end
    local x<const>,y<const> = self:get_global_position()
    -- Snow leaves the end of the sail along a leftward tangent. A broken
    -- sail no longer throws ice, including when the same orientation repeats.
    for blade=1,4 do
        local dir<const> = direction(self.step,blade)
        if self.blade_hp[blade]>0 and (dir==6 or dir==10) then
            local tip<const> = art.tips[dir+1]
            self.scene:spawn(ids_enemy_bullet_def,{
                position={x=x+tip[1]-2,y=y+tip[2]-2},stage=self.stage,
                imgid='molen_ijs',order=enemy_bullet_draw_z,
                velocity_x=-400,velocity_y=dir==6 and 400 or -400,
            })
        end
    end
end

-- Find the first solid pixels from the left, even when a long laser enters
-- several native colliders in one tick. Bounds and spans are half-open.
local first_sail_pixel<const> = function(shape, left, top, right, bottom)
    local first<const> = math.max(0,(top-shape.y)//2)
    local last<const> = math.min(shape.h//2-1,(bottom-1-shape.y)//2)
    local nearest
    for row=first,last do
        local low<const> = shape.spans[row*2+1]
        local high<const> = shape.spans[row*2+2]
        if low<high and shape.x+low<right and shape.x+high>left then
            local hit<const> = math.max(left,shape.x+low)
            if not nearest or hit<nearest then nearest=hit end
        end
    end
    return nearest
end

function molen:receive_player_projectile(projectile)
    if not self.vulnerable then return false end
    if projectile.continuous_damage and self.blast_hits[projectile]==world.gameplay_time_ms then return true end
    local x<const>,y<const> = self:get_global_position()
    local left<const> = projectile.x-x
    local top<const> = projectile.y-y
    local right<const> = left+projectile.collider.local_right
    local bottom<const> = top+projectile.collider.local_bottom
    local hit_x, target
    if left<axle_right and right>axle_left and top<axle_bottom and bottom>axle_top then
        hit_x=math.max(left,axle_left)
        target=0
    end
    for blade=1,4 do
        if self.blade_hp[blade]>0 then
            local hit<const> = first_sail_pixel(art.shapes[direction(self.step,blade)+1],left,top,right,bottom)
            if hit and (not hit_x or hit<hit_x or (hit==hit_x and target==0)) then
                hit_x=hit
                target=blade
            end
        end
    end
    if not hit_x then return false end
    if projectile.continuous_damage then self.blast_hits[projectile]=world.gameplay_time_ms end
    if target==0 then return ground_foe.receive_player_projectile(self,projectile) end
    self.blade_hp[target]=math.max(0,self.blade_hp[target]-projectile.damage)
    if self.blade_hp[target]==0 then
        self.live_mask=self.live_mask & ~(1<<(target-1))
        self.blades[target]:set_enabled(false)
        self:show_pose()
    end
    self.scene:spawn(ids_small_explosion_def,{
        position={x=x+hit_x-3,y=y+top-3},stage=self.stage,
    })
    return true
end

function molen:on_destroyed()
    self.vulnerable=false
    self.axle:set_enabled(false)
    self.live_mask=0
    for blade=1,4 do
        self.blade_hp[blade]=0
        self.blades[blade]:set_enabled(false)
    end
    self:show_pose()
    for _,cell in ipairs(art.wreck) do self.tile_ids[cell[1]]=cell[2] end
    local x<const>,y<const> = self:get_global_position()
    self.scene:spawn(ids_large_explosion_def,{
        position={x=x+art.hub_x-8,y=y+art.hub_y-8},stage=self.stage,
    })
    self.events:emit(wreck_event)
    self.stage.starfield.mill_arena=false
    self.stage:release_scroll_stop(self.stage.scroll_stop_columns[1])
end

function molen.register()
    players=world:active_definition_view(ids_player_def)
    tile_sheet=image.resolve('molen_tegels')
    fsm_library.register(mill_fsm_id,{
        initial='turning',on={[wreck_event]='/wreck'},
        states={turning={update=molen.turn},wreck={update=enemy.update_stage_follower}},
    })
    local components<const> = {
        mill_tiles,
        collider.factory({id_local=0,geometry_pool=collision_storage.area,local_area={left=35,top=13,right=78,bottom=144},layer=collision_enemy_layer,mask=collision_player_layer}),
        collider.factory({id_local=1,geometry_pool=collision_storage.area,local_area={left=axle_left,top=axle_top,right=axle_right,bottom=axle_bottom},layer=collision_enemy_layer,mask=collision_player_projectile_layer}),
    }
    for blade=1,4 do
        components[#components+1]=collider.factory({id_local=blade+1,geometry_pool=collision_storage.actor,
            shape_asset=collision_storage.mill_sails[1],layer=collision_enemy_layer,mask=collision_enemy_mask})
    end
    components[#components+1]=follower.new
    components[#components+1]=fsm_component.factory({mill_fsm_id})
    prefab.define({def_id=molen.definition_id,class=molen,
        components=components,defaults={order=schoorsteen_foe_draw_z,max_health=12,small_fry=false,stage_scroll_width=112}})
end

return molen
