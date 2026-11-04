-- Native tile names use the shared image cache. Authored composites are
-- rectangle packet views consumed by tile_layer, not drawable image objects.
-- Every direct16 bank occupies one texture page: its cells share the size
-- and live draw mode while retaining only their own page-local UV word.
local image<const> = require('cartlib/gx/image')
local atlas<const> = require('cartlib/gx/atlas')
local gp0<const> = require('cartlib/gx/gp0')

local tile_art<const> = {}
tile_art.__index = tile_art
local banks_by_id<const> = {}

function tile_art.new(spec)
    local self<const> = setmetatable({banks={}},tile_art)
    if spec then
        for index,id in ipairs(spec.assets) do
            local bank = banks_by_id[id]
            if not bank then
                local sheet<const> = image.resolve(id)
                assert(sheet._texture.mode==gp0.texture_mode_direct16
                    and sheet.width==256 and sheet.height==256
                    and sheet.source_x%256==0 and sheet.source_y%256==0,
                    'native tile banks require one page-aligned direct16 image')
                local header<const> = {
                    _texture=sheet._texture,
                    source_x=sheet.source_x,source_y=sheet.source_y,
                    width=8,height=8,_size_word=0x00080008,
                }
                -- Atlas relocation updates this shared header. Page-local
                -- UV words remain unchanged, so views need no refresh loop.
                atlas.bind_source(header._texture,header)
                bank={tiles={},view_type={__index=header}}
                banks_by_id[id]=bank
            end
            self.banks[index]=bank
        end
    end
    return self
end

function tile_art:resolve(id)
    if type(id)=='string' then return image.resolve(id) end
    local offset<const> = id-1
    local bank<const> = self.banks[offset//1024+1]
    local index<const> = (offset%1024)+1
    local source = bank.tiles[index]
    if source then return source end
    local cell<const> = index-1
    source=setmetatable({_blit_uv_word=((cell&31)<<3)|((cell>>5)<<11)},bank.view_type)
    bank.tiles[index]=source
    return source
end

return tile_art
