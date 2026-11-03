local image<const> = require('cartlib/gx/image')
local gp0<const> = require('cartlib/gx/gp0')
local command_list<const> = require('cartlib/gx/command_list')
local tile_layer_row<const> = require('cartlib/component/tile_layer_row')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')

local stage_tiles<const> = {}
stage_tiles.__index = stage_tiles
setmetatable(stage_tiles, { __index = visual_2d_component })

local find_slot<const> = function(row, column)
    local first, last = 1, row.source_count
    local columns<const> = row.columns
    while first <= last do
        local middle<const> = (first + last) // 2
        if columns[middle] < column then first = middle + 1
        else last = middle - 1 end
    end
    return first
end

function stage_tiles.new(owner)
    local self<const> = visual_2d_component.new(owner, owner, 'tile_layer')
    setmetatable(self, stage_tiles)
    self._rows = {}
    self.tile_count = 0
    return self
end

function stage_tiles:configure(columns, row_count, tile_size)
    self.columns = columns
    self.tile_count = columns * row_count
    self._row_count = row_count
    self._tile_size = tile_size
    self._coordinate_domain_columns = gp0.signed_coordinate_extent // tile_size
    self._first_visible_column = 0
    self._last_visible_column = 0
    for y = 1, row_count do
        local row<const> = tile_layer_row.new()
        row.row_index = y
        row.dirty = false
        self._rows[y] = row
    end
    self:set_draw_function(stage_tiles.draw_visual)
end

-- Admission builds the ordered native row once. The map arrives in row order;
-- the few initially empty animation cells are inserted before any slot binds.
function stage_tiles:admit_tile(x, y, imgid)
    local row<const> = self._rows[y]
    local count<const> = row.source_count
    local slot = count + 1
    if count ~= 0 and x <= row.columns[count] then
        slot = find_slot(row, x)
        if row.columns[slot] == x then
            row.sources[slot] = image.resolve(imgid)
            return
        end
        for index = count, slot, -1 do
            row.columns[index + 1] = row.columns[index]
            row.coordinate_domains[index + 1] = row.coordinate_domains[index]
            row.sources[index + 1] = row.sources[index]
            row.position_words[index + 1] = row.position_words[index]
        end
    end
    local domain_columns<const> = self._coordinate_domain_columns
    local tile_size<const> = self._tile_size
    row.columns[slot] = x
    row.coordinate_domains[slot] = ((x - 1) // domain_columns) + 1
    row.sources[slot] = image.resolve(imgid)
    row.position_words[slot] = gp0.pair16(((x - 1) % domain_columns) * tile_size, (y - 1) * tile_size)
    row.source_count = count + 1
end

-- Animation retains this source array and slot. No world-index lookup or
-- topology change is needed when a water pose or moving cargo tile changes.
function stage_tiles:bind_tile(x, y)
    local row<const> = self._rows[y]
    local slot<const> = find_slot(row, x)
    return row.sources, slot
end

function stage_tiles:set_visible_columns(first, count)
    local last<const> = math.min(first + count - 1, self.columns)
    if first == self._first_visible_column and last == self._last_visible_column then return end
    self._first_visible_column = first
    self._last_visible_column = last
    for y = 1, self._row_count do
        tile_layer_row.select_visible(self._rows[y], first, last)
    end
end

function stage_tiles:draw_visual(draw)
    self:resolve_pose()
    command_list.tile_layer(draw, self._rows, self._row_count,
        self._first_visible_column, self._last_visible_column,
        self._coordinate_domain_columns, self._tile_size, self.wox, self.woy)
end

return stage_tiles
