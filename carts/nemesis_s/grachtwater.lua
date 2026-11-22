-- The tape owns water geometry, phase offsets and bank art. The stage retains
-- only playback time; admitting a column resolves its pose from the same tape.
local water<const> = { cell_bit = 0x8000 }
water.__index = water

struct water_header
    strips: word
    cells: word
    poses: word
    first_column: i32
    strip_count: u16
    ticks_per_pose: u16
end

struct water_cell
    x: u16
    y: u16
    phase_base: u16
end

local pose_art<const> = function(address, phase_base, phase)
    local poses<const>: *u16 = address
    return poses[(phase_base & ~7) | ((phase_base + phase) & 7)]
end

function water.new(tape)
    local header<const>: *water_header = tape.water
    local base<const> = tape.address
    return setmetatable({
        strips = base + header->strips, cells = base + header->cells,
        poses = base + header->poses, first_column = header->first_column,
        strip_count = header->strip_count, hold = header->ticks_per_pose, phase = 0, elapsed = 0,
    }, water)
end

function water:art_at(index)
    local cell<const>: *water_cell = self.cells + index * sizeof(water_cell)
    return pose_art(self.poses, cell->phase_base, self.phase)
end

function water:reset()
    local changed<const> = self.phase ~= 0
    self.phase, self.elapsed = 0, 0
    return changed
end

function water:tick(tiles)
    self.elapsed = self.elapsed + 1
    if self.elapsed ~= self.hold then return end
    self.elapsed = 0
    local phase<const> = (self.phase + 1) & 7
    self.phase = phase

    local first<const>, last<const> = tiles._first_visible_column, tiles._last_visible_column
    local origin<const> = self.first_column
    local first_strip<const> = math.max(0, (first - origin) // 4)
    local last_strip<const> = math.min(self.strip_count - 1, (last - origin) // 4)
    if first_strip > last_strip then return end
    local strips<const>: *u16 = self.strips
    local begin<const>, limit<const> = strips[first_strip], strips[last_strip + 1]
    local cell: *water_cell = self.cells + begin * sizeof(water_cell)
    local poses<const>: *u16 = self.poses
    for _ = begin, limit - 1 do
        local column<const> = cell->x
        if column >= first and column <= last then
            tiles:refresh_water_cell(column, cell->y, pose_art(poses, cell->phase_base, phase))
        end
        cell = cell + sizeof(water_cell)
    end
end

return water
