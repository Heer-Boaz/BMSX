-- Each four-column water module has its own offset in an eight-pose ripple.
-- Cells are admitted from the stage's normal tile IDs once, including its
-- existing occlusion by the terrain. Only visible modules change their art.
local image<const> = require('cartlib/gx/image')
local water<const> = {}
water.__index = water

function water.new(spec, rows, assets, tiles)
    local self<const> = setmetatable({groups={}, origin=spec.origin_column or 0, hold=spec.ticks_per_pose},water)
    for _,frames in pairs(spec.frames) do
        for pose=1,#frames do frames[pose]=image.resolve(frames[pose]) end
    end
    local sequences<const> = {}
    for id,name in ipairs(assets) do sequences[id]=spec.frames[name] end
    local width<const> = #rows[1]
    for y=spec.first_row,#rows do
        local row<const> = rows[y]
        for x=1,width do
            local frames<const> = sequences[row[x]]
            if frames then
                local strip<const> = (x-1-self.origin)//4
                local group = self.groups[strip]
                if not group then
                    group={offset=spec.phase_offsets[(strip&7)+1]}
                    self.groups[strip]=group
                end
                local n<const> = #group
                local sources<const>,slot<const> = tiles:bind_tile(x,y)
                group[n+1]=sources
                group[n+2]=slot
                group[n+3]=frames
            end
        end
    end
    return self
end

function water:show(first,count)
    for strip=(first-1-self.origin)//4,(first+count-2-self.origin)//4 do
        local group<const> = self.groups[strip]
        if group and group.drawn~=self.phase then
            local pose<const> = ((self.phase+group.offset)&7)+1
            for i=1,#group,3 do
                group[i][group[i+1]]=group[i+2][pose]
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
