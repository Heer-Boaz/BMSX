-- Stadsburg animates only the sites currently in view. A cargo character
-- takes its native terrain role with it when the winch lays more chain.
local image<const> = require('cartlib/gx/image')
local haven<const> = {}
haven.__index = haven

local paint<const> = function(self, clip, pose)
    local previous<const> = clip.pose
    if previous == pose then return end
    for i=1,#clip.cells do
        local cell<const> = clip.cells[i]
        local id<const> = cell[pose+3]
        if cell[previous+3] ~= id then
            cell.sources[cell.slot]=self.patterns[id]
            if cell.solid_row then
                local row<const>,word<const>,mask<const> = cell.solid_row,cell.solid_word,cell.solid_mask
                if self.solid[id]~=0 then row[word]=row[word]|mask
                else row[word]=row[word]&~mask end
            end
        end
    end
    clip.pose=pose
end

function haven.new(spec, tiles, solid_rows)
    local self<const> = setmetatable({patterns=spec.patterns,clips=spec.clips,
        solid={[0]=0},active={},next_clip=1},haven)
    -- Admit every empty pose cell before binding slots: insertion can move
    -- later cells in the same retained row, but poses never change topology.
    for _,clip in ipairs(self.clips) do
        for _,cell in ipairs(clip.cells) do
            if cell[4]==0 then tiles:admit_tile(cell[1],cell[2],spec.empty) end
        end
    end
    self.patterns[0]=image.resolve(spec.empty)
    for id=1,#self.patterns do self.patterns[id]=image.resolve(self.patterns[id]) end
    for _,clip in ipairs(self.clips) do
        clip.pose=1
        for _,cell in ipairs(clip.cells) do
            local x<const>,y<const> = cell[1],cell[2]
            cell.sources,cell.slot=tiles:bind_tile(x,y)
            if cell[3]==1 then
                cell.solid_row=solid_rows[y]
                cell.solid_word=((x-1)//32)+1
                cell.solid_mask=1<<((x-1)&31)
                self.solid[cell[4]]=0
                if (cell.solid_row[cell.solid_word]&cell.solid_mask)~=0 then
                    self.solid[cell[4]]=1
                end
            end
        end
    end
    return self
end

function haven:show(left)
    local active<const> = self.active
    for i=#active,1,-1 do
        local clip<const> = active[i]
        if left>clip.end_column then
            paint(self,clip,1)
            table.remove(active,i)
        end
    end
    local i=self.next_clip
    while i<=#self.clips and self.clips[i].start<=left do
        local clip<const> = self.clips[i]
        if left<=clip.end_column then
            active[#active+1]=clip
            clip.step=1
            clip.remaining=clip.steps[1][2]
        end
        i=i+1
    end
    self.next_clip=i
end

function haven:reset(left)
    for i=#self.active,1,-1 do
        paint(self,self.active[i],1)
        self.active[i]=nil
    end
    self.next_clip=1
    self:show(left)
end

function haven:tick()
    local active<const> = self.active
    for i=#active,1,-1 do
        local clip<const> = active[i]
        clip.remaining=clip.remaining-1
        if clip.remaining==0 then
            local step=clip.step+1
            if step>#clip.steps then
                if clip.once then
                    table.remove(active,i)
                    goto next_clip
                end
                step=1
            end
            local cue<const> = clip.steps[step]
            clip.step=step
            clip.remaining=cue[2]
            paint(self,clip,cue[1])
        end
        ::next_clip::
    end
end

return haven
