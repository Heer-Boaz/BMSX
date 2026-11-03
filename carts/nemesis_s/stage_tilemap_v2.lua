-- Resolve numeric artwork IDs to the existing native stage symbols.
-- This module does not create or override terrain collision state.
-- stage.lua retains its normal decode_stage_tile/build_tape path.
local stage_tilemap_v2<const> = {}
local string_sub<const> = string.sub
local string_find<const> = string.find
local table_concat<const> = table.concat
local supported_symbols<const> = " !#%'()+-/1234567=@BCDKMNPRSWZ\\^_bcdmopstw|"

local fail<const> = function(message)
    error('nemesis_s tilemap v2: ' .. message)
end

function stage_tilemap_v2.resolve(data)
    if data.tilemap_version == nil then return data.map_rows, nil, nil end
    if data.tilemap_version ~= 2 then
        fail('unsupported tilemap_version')
    end
    if data.tile_size ~= 8 or data.tile_columns ~= 32 or data.tile_rows ~= 22 then
        fail('expected 8px tiles, 32 visible columns and 22 playfield rows')
    end
    local rows<const> = data.tile_ids
    local catalog<const> = data.tile_assets
    local symbols<const> = data.tile_symbols
    if type(rows) ~= 'table' or #rows ~= data.tile_rows then
        fail('tile_ids must contain tile_rows numeric arrays')
    end
    if type(catalog) ~= 'table' or #catalog == 0 then
        fail('tile_assets must be an ordered array of asset names')
    end
    if type(symbols) ~= 'string' or #symbols ~= #catalog then
        fail('tile_symbols must contain one native symbol per tile asset')
    end
    if type(rows[1]) ~= 'table' then
        fail('tile_ids rows must be arrays, not ASCII strings')
    end
    local width<const> = #rows[1]
    local height<const> = #rows
    if width < data.tile_columns or data.tape_length_tiles ~= width then
        fail('tape_length_tiles must equal the row width, at least 32')
    end
    for id = 1, #catalog do
        if type(catalog[id]) ~= 'string' or #catalog[id] == 0 then
            fail('tile_assets[' .. tostring(id) .. '] must be a nonempty asset name')
        end
        local symbol<const> = string_sub(symbols, id, id)
        if string_find(supported_symbols, symbol, 1, true) == nil then
            fail('unsupported native symbol for tile ID ' .. tostring(id))
        end
    end

    local map_rows<const> = {}
    for y = 1, height do
        local row<const> = rows[y]
        if type(row) ~= 'table' or #row ~= width then
            fail('tile_ids row ' .. tostring(y) .. ' has the wrong width')
        end
        local native_row<const> = {}
        for x = 1, width do
            local id<const> = row[x]
            if type(id) ~= 'number' or id % 1 ~= 0 or id < 0 or id > #catalog then
                fail('invalid tile ID at x=' .. tostring(x) .. ', y=' .. tostring(y))
            end
            if id == 0 then
                native_row[x] = ' '
            else
                native_row[x] = string_sub(symbols, id, id)
            end
        end
        map_rows[y] = table_concat(native_row)
    end
    return map_rows, rows, catalog
end

return stage_tilemap_v2
