local gp0<const> = require('cartlib/gx/gp0')
local command_list<const> = require('cartlib/gx/command_list')
local tile_layer_row<const> = require('cartlib/component/tile_layer_row')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local water_cell_bit<const> = require('grachtwater').cell_bit

local stage_tiles<const> = {}
stage_tiles.__index = stage_tiles
setmetatable(stage_tiles, { __index = visual_2d_component })

-- Sparse ROM rows are sorted by world column. Only the visible interval is
-- materialized; duplicate ring slots keep the draw span contiguous at wrap.
local lower_bound<const> = function(address, count, column)
    local cells<const>: *u16 = address
    local first, last = 0, count
    while first < last do
        local middle<const> = (first + last) >> 1
        if cells[middle * 2] < column then first = middle + 1
        else last = middle end
    end
    return first
end

local tape_source<const> = function(self, selector)
    if (selector & water_cell_bit) ~= 0 then
        selector = self.water:art_at(selector & (water_cell_bit - 1))
    end
    return self.art:resolve(selector)
end

function stage_tiles:source_at(column, y)
    local row<const> = self._rows[y]
    local source<const> = row.overrides[column]
    if source ~= nil then return source end
    local cells<const>: *u16 = row.tape_address
    local index<const> = lower_bound(cells, row.tape_count, column)
    if index < row.tape_count and cells[index * 2] == column then
        return tape_source(self, cells[index * 2 + 1])
    end
end

local write_slot<const> = function(self, row, slot, column, source)
    local capacity<const> = self._window_capacity
    local copy<const> = slot + capacity
    local domain_columns<const> = self._coordinate_domain_columns
    local domain<const> = ((column - 1) // domain_columns) + 1
    local position<const> = gp0.pair16(((column - 1) % domain_columns) * self._tile_size,
        (row.row_index - 1) * self._tile_size)
    row.columns[slot], row.columns[copy] = column, column
    row.coordinate_domains[slot], row.coordinate_domains[copy] = domain, domain
    tile_layer_row.set_source(row, slot, source)
    row.position_words[slot], row.position_words[copy] = position, position
end

local clear_slot<const> = function(self, row, slot)
    local copy<const> = slot + self._window_capacity
    row.columns[slot], row.columns[copy] = nil, nil
    row.coordinate_domains[slot], row.coordinate_domains[copy] = nil, nil
    tile_layer_row.set_source(row, slot, nil)
    row.position_words[slot], row.position_words[copy] = nil, nil
end

local rebuild_row<const> = function(self, row, first, last)
    local capacity<const> = self._window_capacity
    local head<const> = row.first_visible_source
    local count<const> = row.source_count
    for i = 0, count - 1 do
        local slot = head + i
        if slot > capacity then slot = slot - capacity end
        clear_slot(self, row, slot)
    end
    local cells<const>: *u16 = row.tape_address
    local index = lower_bound(cells, row.tape_count, first)
    local added = 0
    for column = first, last do
        local source = row.overrides[column]
        if index < row.tape_count and cells[index * 2] == column then
            if source == nil then source = tape_source(self, cells[index * 2 + 1]) end
            index = index + 1
        end
        if source ~= nil then
            added = added + 1
            write_slot(self, row, added, column, source)
        end
    end
    row.first_visible_source = 1
    row.last_visible_source = added
    row.source_count = added
end

function stage_tiles.new(owner, configuration, id_local)
    local self<const> = visual_2d_component.new(owner, configuration or owner, id_local or 'tile_layer')
    setmetatable(self, stage_tiles)
    self._rows = { placement_revision = 0 }
    self.tile_count = 0
    return self
end

function stage_tiles:configure(columns, row_count, tile_size, art)
    self.art = art
    self.columns = columns
    self.tile_count = columns * row_count
    self._row_count = row_count
    self._tile_size = tile_size
    self._cell_size_word = gp0.pair16(tile_size, tile_size)
    self._coordinate_domain_columns = gp0.signed_coordinate_extent // tile_size
    self._first_visible_column = 0
    self._last_visible_column = 0
    self._window_capacity = 0
    for y = 1, row_count do
        local row<const> = tile_layer_row.new()
        tile_layer_row.configure(row, y, self._cell_size_word, 0)
        row.overrides = {}
        self._rows[y] = row
    end
    self:set_draw_function(stage_tiles.draw_visual)
end

local visible_slot<const> = function(row, x, capacity)
    local first, last = row.first_visible_source, row.last_visible_source
    while first <= last do
        local middle<const> = (first + last) >> 1
        local column<const> = row.columns[middle]
        if column < x then first = middle + 1
        elseif column > x then last = middle - 1
        else return middle > capacity and middle - capacity or middle end
    end
end

-- The cooker indexed an existing tape cell. A pose refresh changes neither
-- its membership nor any explicit scenery paint over that cell.
function stage_tiles:refresh_water_cell(x, y, art)
    local row<const> = self._rows[y]
    if row.overrides[x] ~= nil then return end
    local slot<const> = visible_slot(row, x, self._window_capacity)
    tile_layer_row.set_source(row, slot, self.art:resolve(art))
end

-- Scenery changes persist independently of whether their world column is in
-- the current render window; a visible source updates both ring copies.
function stage_tiles:set_tile_source(x, y, source)
    local row<const> = self._rows[y]
    row.overrides[x] = source
    if x < self._first_visible_column or x > self._last_visible_column then return end
    if source == nil then
        -- A removed override reveals the tape cell, or removes a sparse slot.
        source = self:source_at(x, y)
        if source == nil then
            rebuild_row(self, row, self._first_visible_column, self._last_visible_column)
            return
        end
    end
    local slot<const> = visible_slot(row, x, self._window_capacity)
    if slot then
        tile_layer_row.set_source(row, slot, source)
    else
        rebuild_row(self, row, self._first_visible_column, self._last_visible_column)
    end
end

function stage_tiles:set_visible_columns(first, count, sources_changed)
    local last<const> = math.min(first + count - 1, self.columns)
    local old_first<const>, old_last<const> = self._first_visible_column, self._last_visible_column
    if not sources_changed and first == old_first and last == old_last then return end
    local old_capacity<const> = self._window_capacity
    self._first_visible_column, self._last_visible_column = first, last
    if old_capacity ~= count then
        -- A changed viewport size gives every row a new ring representation.
        for y = 1, self._row_count do
            local row<const> = self._rows[y]
            tile_layer_row.configure(row, y, self._cell_size_word, count)
        end
        self._window_capacity = count
    end
    local capacity<const> = self._window_capacity
    local forward<const> = not sources_changed and old_capacity == count and first == old_first + 1
        and (last == old_last + 1 or last == old_last)
    local backward<const> = not sources_changed and old_capacity == count and first == old_first - 1
        and (last == old_last - 1 or last == old_last)
    for y = 1, self._row_count do
        local row<const> = self._rows[y]
        if forward then
            local head, n = row.first_visible_source, row.source_count
            if n > 0 and row.columns[head] < first then
                clear_slot(self, row, head)
                head = head + 1
                if head > capacity then head = 1 end
                n = n - 1
            end
            if last > old_last then
                local source<const> = self:source_at(last, y)
                if source ~= nil then
                    local slot = head + n
                    if slot > capacity then slot = slot - capacity end
                    write_slot(self, row, slot, last, source)
                    n = n + 1
                end
            end
            row.first_visible_source, row.last_visible_source, row.source_count = head, head + n - 1, n
        elseif backward then
            local head, n = row.first_visible_source, row.source_count
            if n > 0 and row.columns[head + n - 1] > last then
                local slot = head + n - 1
                if slot > capacity then slot = slot - capacity end
                clear_slot(self, row, slot)
                n = n - 1
            end
            local source<const> = self:source_at(first, y)
            if source ~= nil then
                head = head - 1
                if head == 0 then head = capacity end
                write_slot(self, row, head, first, source)
                n = n + 1
            end
            row.first_visible_source, row.last_visible_source, row.source_count = head, head + n - 1, n
        else
            rebuild_row(self, row, first, last)
        end
    end
end

function stage_tiles:draw_visual(draw)
    self:resolve_pose()
    local rows<const> = self._rows
    tile_layer_row.refresh_packets(rows, self._row_count)
    command_list.tile_layer(draw, rows, self._row_count,
        self._first_visible_column, self._last_visible_column,
        self._coordinate_domain_columns, self._tile_size, self.wox, self.woy)
end

return stage_tiles
