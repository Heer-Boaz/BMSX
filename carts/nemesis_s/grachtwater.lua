-- Each four-column water module has its own offset in an eight-pose ripple.
-- Cells are admitted from the stage's normal tile IDs once, including its
-- existing occlusion by the terrain. Only visible modules change their art.
local water<const> = {}
water.__index = water

function water.new(spec, tape, tiles)
    local self<const> = setmetatable({groups={}, tiles=tiles, origin=spec.origin_column, hold=spec.ticks_per_pose},water)
    for _,frames in ipairs(spec.frames) do
        for pose=1,#frames do frames[pose]=tiles.art:resolve(frames[pose]) end
    end
    local cells<const>: *u16 = tape.water
    for index=0,tape.water_count-1 do
        local x<const>,y<const> = cells[index*3],cells[index*3+1]
        local frames<const> = spec.frames[cells[index*3+2]]
        local strip<const> = (x-1-self.origin)//4
        local group = self.groups[strip]
        if not group then
            group={offset=spec.phase_offsets[(strip&7)+1]}
            self.groups[strip]=group
        end
        local n<const> = #group
        group[n+1]=x
        group[n+2]=y
        group[n+3]=frames
    end
    return self
end

function water:show(first,count)
    for strip=(first-1-self.origin)//4,(first+count-2-self.origin)//4 do
        local group<const> = self.groups[strip]
        if group and group.drawn~=self.phase then
            local pose<const> = ((self.phase+group.offset)&7)+1
            for i=1,#group,3 do
                self.tiles:set_tile_source(group[i],group[i+1],group[i+2][pose])
            end
            group.drawn=self.phase
        end
    end
end

function water:reset(first,count)
    self.phase=0
    self.elapsed=0
    self:show(first,count)
end

function water:tick(first,count)
    self.elapsed=self.elapsed+1
    if self.elapsed==self.hold then
        self.elapsed=0
        self.phase=(self.phase+1)&7
        self:show(first,count)
    end
end

return water
