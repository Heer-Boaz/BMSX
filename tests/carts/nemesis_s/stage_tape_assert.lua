local fixture<const> = require('tests/carts/nemesis_s/fixture')
local assets<const> = require('bmsx/assets')
local bin<const> = require('cartlib/bin')
local collision<const> = require('stage_collision')
local vram<const> = require('cartlib/gx/vram')
local world<const> = require('cartlib/world/world')

return {kind='integration',tests={
    every_harbor_pose_keeps_bound_cells_and_cargo_reset=function(t)
        local _,stage<const>,pilot<const> = fixture.start_game(t)
        pilot.body_collider:set_enabled(false)
        local harbor<const> = stage.harbor
        local original<const> = bin.decode(assets.data_nemesis_s_stage_runtime_addr,'animation regression source').harbor_animation
        for clip_index,clip in ipairs(harbor.clips) do
            stage.start_column=clip.start
            stage:reset_runtime()
            stage.scrolling=false
            local duration=0
            for _,step in ipairs(clip.steps) do duration=duration+step[2] end
            local poses<const> = {}
            for tick=0,duration do
                poses[clip.pose]=true
                for cell_index,cell in ipairs(clip.cells) do
                    local definition<const> = original.clips[clip_index]
                    local pattern<const> = cell[clip.pose+3]
                    local id
                    if definition.visuals then id=definition.visuals[cell_index][clip.pose]
                    else id=original.patterns[pattern] end
                    if id==0 or pattern==0 then id=original.empty end
                    assert(stage.stage_tiles:source_at(cell[1],cell[2])==stage.tile_art:resolve(id),
                        'animated bank cell changed its world position or pose')
                end
                harbor:tick()
            end
            for _,step in ipairs(clip.steps) do assert(poses[step[1]],'animation omitted an authored pose') end
            if clip.max_health then
                for _,cell in ipairs(clip.cells) do
                    if harbor.cargo_patterns[cell.pattern] then
                        harbor:hit_tile(cell[1],cell[2],{damage=clip.max_health})
                        assert(clip.health==0)
                        stage:reset_runtime()
                        assert(clip.health==clip.max_health and clip.pose==1)
                        break
                    end
                end
            end
        end
    end,
    authored_collision_and_live_bank_residency=function(t)
        local director<const>,stage<const> = fixture.start_game(t)
        local source<const> = bin.decode(assets.data_nemesis_s_stage_addr,'stage regression source')
        for y,row in ipairs(source.tile_ids) do
            for x,id in ipairs(row) do
                local expected<const> = id~=0 and collision.is_solid(source.tile_roles[id],row,source.tile_roles,x,#row)
                local actual<const> = (stage.solid_tape[y][((x-1)//32)+1]&(1<<((x-1)&31)))~=0
                assert(actual==expected,'ROM collision tape changed authored terrain semantics')
            end
        end
        local tick<const> = world.gameplay_time_ms
        t:wait_until('first admitted stage frame',function() return world.gameplay_time_ms~=tick end,120)
        local textures<const> = {}
        local total=0
        local fx<const>,fy<const> = vram.page_1&0xffff,vram.page_1>>16
        local fw<const>,fh<const> = vram.page_size&0xffff,vram.page_size>>16
        for _,bank in ipairs(stage.tile_art.banks) do
            local texture<const> = bank.view_type.__index._texture
            if not textures[texture] then
                textures[texture]=true
                local allocation<const> = texture._allocation
                assert(allocation,'bank atlas must be resident, not only metadata-resolved')
                local x<const>,y<const> = allocation.x,allocation.y
                local width<const>,height<const> = allocation.width,allocation.height
                assert(x>=0 and y>=0 and x+width<=1024 and y+height<=1024)
                assert(x>=fx+fw or fx>=x+width or y>=fy+fh or fy>=y+height,
                    'bank atlas overlaps the live framebuffer')
                total=total+width*height*2
            end
        end
        print('stage bank resident atlas bytes',total)
        assert(total>=#stage.tile_art.banks*256*256*2)
    end,
}}
