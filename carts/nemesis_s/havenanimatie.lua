-- Immutable Stadsburg poses live in stage ROM. Playback timers exist only
-- for admitted clips, while damage lives with the cargo across clip retirement.
local world<const> = require('cartlib/world/world')
local haven<const> = {}
haven.__index = haven

struct harbor_header
    cargo_rows: word
    clip_count: u16
    empty_art: u16
end

struct harbor_clip
    cells: word
    steps: word
    poses: word
    first_column: word
    last_column: word
    cell_count: u16
    step_count: u16
    max_health: u16
    once: u16
end

struct harbor_cell
    x: u16
    y: u16
end

struct harbor_step
    pose: u16
    ticks: u16
end

struct harbor_pose_cell
    art: u16
    flags: u16
end

struct harbor_cargo_row
    entries: word
    count: word
end

struct harbor_cargo_cell
    x: u16
    clip: u16
    cell: u16
end

local solid<const> = 1
local cargo<const> = 2
local owns_collision<const> = 4

local paint<const> = function(self, live, pose, force)
    if live.pose == pose and not force then return end
    local clip<const>: *harbor_clip = live.clip
    local cells<const> = clip->cell_count
    local coordinate: *harbor_cell = self.base + clip->cells
    local frame: *harbor_pose_cell = self.base + clip->poses + pose * cells * sizeof(harbor_pose_cell)
    local tiles<const>, art<const> = self.tiles, self.tiles.art
    local destroyed<const> = live.health == 0
    for _ = 1, cells do
        local x<const>, y<const> = coordinate->x, coordinate->y
        local flags = frame->flags
        local tile = frame->art
        if destroyed and (flags & cargo) ~= 0 then
            tile = self.empty_art
            flags = flags & ~solid
        end
        tiles:set_tile_source(x, y, art:resolve(tile))
        if (flags & owns_collision) ~= 0 then
            local row<const> = self.solid_rows[y]
            local lane<const> = ((x - 1) >> 5) + 1
            local mask<const> = 1 << ((x - 1) & 31)
            local bits<const> = row[lane]
            local updated<const> = (flags & solid) ~= 0 and (bits | mask) or (bits & ~mask)
            if bits ~= updated then row[lane] = updated end
        end
        coordinate = coordinate + sizeof(harbor_cell)
        frame = frame + sizeof(harbor_pose_cell)
    end
    live.pose = pose
end

-- A load can take damage before admission or after a one-shot clip finishes.
-- Its mutable identity belongs to the stage, not the active playback array.
local cargo_state<const> = function(self, clip_address)
    local live = self.loads[clip_address]
    if live == nil then
        local clip<const>: *harbor_clip = clip_address
        live = { clip = clip_address, pose = 0, health = clip->max_health }
        self.loads[clip_address] = live
    end
    return live
end

function haven.new(tape, tiles, solid_rows)
    local header<const>: *harbor_header = tape.harbor
    return setmetatable({
        tiles = tiles, solid_rows = solid_rows, base = tape.address,
        clips = tape.harbor + sizeof(harbor_header), clip_count = header->clip_count,
        cargo_rows = tape.address + header->cargo_rows, height = tape.height,
        empty_art = header->empty_art, active = {}, loads = {}, next_clip = 0,
    }, haven)
end

function haven:show(left)
    local active<const> = self.active
    for i = #active, 1, -1 do
        local live<const> = active[i]
        local clip<const>: *harbor_clip = live.clip
        if left > clip->last_column then
            paint(self, live, 0)
            table.remove(active, i)
        end
    end
    local index = self.next_clip
    local clip: *harbor_clip = self.clips + index * sizeof(harbor_clip)
    while index < self.clip_count and clip->first_column <= left do
        if left <= clip->last_column then
            local live
            if clip->max_health ~= 0 then live = cargo_state(self, clip)
            else live = { clip = clip, pose = 0 } end
            local first<const>: *harbor_step = self.base + clip->steps
            live.step, live.remaining = 0, first->ticks
            active[#active + 1] = live
        end
        index = index + 1
        clip = clip + sizeof(harbor_clip)
    end
    self.next_clip = index
end

function haven:reset(left)
    -- Reset loads even if their one-shot playback has retired. Each cooked
    -- coordinate has one clip owner, so restoring an off-screen load is local.
    for address, live in pairs(self.loads) do
        local clip<const>: *harbor_clip = address
        local destroyed<const> = live.health == 0
        live.health = clip->max_health
        live.blast_hits = nil
        paint(self, live, 0, destroyed)
        self.loads[address] = nil
    end
    for i = #self.active, 1, -1 do
        paint(self, self.active[i], 0)
        self.active[i] = nil
    end
    self.next_clip = 0
    self:show(left)
end

function haven:hit_tile(x, y, projectile)
    if y < 1 or y > self.height then return end
    local row<const>: *harbor_cargo_row = self.cargo_rows + (y - 1) * sizeof(harbor_cargo_row)
    local entries<const> = self.base + row->entries
    local count<const> = row->count
    local first, last = 0, count
    while first < last do
        local middle<const> = (first + last) >> 1
        local cell<const>: *harbor_cargo_cell = entries + middle * sizeof(harbor_cargo_cell)
        if cell->x < x then first = middle + 1
        else last = middle end
    end
    if first == count then return end
    local cell<const>: *harbor_cargo_cell = entries + first * sizeof(harbor_cargo_cell)
    if cell->x ~= x then return end
    local address<const> = self.clips + cell->clip * sizeof(harbor_clip)
    local clip<const>: *harbor_clip = address
    local live = self.loads[address]
    if live and live.health == 0 then return end
    local pose_index<const> = (live and live.pose or 0) * clip->cell_count + cell->cell
    local frame<const>: *harbor_pose_cell = self.base + clip->poses + pose_index * sizeof(harbor_pose_cell)
    if (frame->flags & cargo) == 0 then return end

    if live == nil then live = cargo_state(self, address) end
    local tick<const> = world.gameplay_time_ms
    local hits = live.blast_hits
    if hits == nil then hits = {}; live.blast_hits = hits end
    if projectile.continuous_damage and hits[projectile] == tick then return end
    -- Initial impact and newly admitted blast are one hit this update, even
    -- when the blast overlaps several of the same load's cells.
    hits[projectile] = tick
    live.health = math.max(0, live.health - projectile.damage)
    if live.health == 0 then paint(self, live, live.pose, true) end
    return live.health
end

function haven:tick()
    local active<const> = self.active
    for i = #active, 1, -1 do
        local live<const> = active[i]
        live.remaining = live.remaining - 1
        if live.remaining == 0 then
            local clip<const>: *harbor_clip = live.clip
            local step = live.step + 1
            if step == clip->step_count then
                if clip->once ~= 0 then
                    table.remove(active, i)
                    goto next_clip
                end
                step = 0
            end
            local cue<const>: *harbor_step = self.base + clip->steps + step * sizeof(harbor_step)
            live.step, live.remaining = step, cue->ticks
            paint(self, live, cue->pose)
        end
        ::next_clip::
    end
end

return haven
