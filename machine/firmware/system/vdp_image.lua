local round_to_nearest<const> = require('bios/util/round_to_nearest')
local imgdec<const> = require('system/imgdec')
local romdir<const> = require('system/romdir')
local vdp_rpu_quads<const> = require('system/vdp_rpu_quads')

local vdp_image<const> = {}
local cache<const> = {}

local system_atlas_id<const> = 254
local system_atlas_meta<const> = romdir.system_rom_atlas(system_atlas_id).imgmeta
vdp_rpu_quads.define_atlas(system_atlas_id, system_atlas_meta.texture_addr, system_atlas_meta.width, system_atlas_meta.height)

function vdp_image.load_atlas(atlas_id)
	local atlas<const> = romdir.cart_atlas(atlas_id)
	local atlas_meta<const> = atlas.imgmeta
	vdp_rpu_quads.define_atlas(atlas_id, atlas_meta.texture_addr, atlas_meta.width, atlas_meta.height)
	imgdec.start(atlas.addr, atlas.len, atlas_meta.texture_addr, atlas_meta.texture_len)
end

local require_meta<const> = function(imgid) -- TODO: REMOVE INSANE ERROR CHECKING!! WTF?!
	local record<const> = romdir.image(imgid)
	local meta<const> = record.imgmeta
	if meta == nil then
		error('image ROM entry "' .. tostring(imgid) .. '" missing imgmeta.')
	end
	if meta.atlasid == nil then
		error('image ROM entry "' .. tostring(imgid) .. '" missing atlasid.')
	end
	if meta.texcoords == nil then
		error('image ROM entry "' .. tostring(imgid) .. '" missing texcoords.')
	end
	return meta
end

local require_atlas_meta<const> = function(atlas_id, imgid)
	local atlas<const> = romdir.atlas(atlas_id)
	if atlas == nil or atlas.imgmeta == nil then
		error('atlas ' .. tostring(atlas_id) .. ' for image "' .. tostring(imgid) .. '" was not found.')
	end
	return atlas.imgmeta
end

function vdp_image.rect(imgid)
	local cached<const> = cache[imgid]
	if cached ~= nil then
		return cached
	end
	local meta<const> = require_meta(imgid)
	local coords<const> = meta.texcoords
	local min_u = coords[1]
	local max_u = coords[1]
	local min_v = coords[2]
	local max_v = coords[2]
	for i = 3, 11, 2 do
		local u<const> = coords[i]
		local v<const> = coords[i + 1]
		if u < min_u then min_u = u end
		if u > max_u then max_u = u end
		if v < min_v then min_v = v end
		if v > max_v then max_v = v end
	end
	local atlas_meta<const> = require_atlas_meta(meta.atlasid, imgid)
	local rect<const> = { -- TODO: REMOVE INSANE GC-CHURN!!!
		atlas_id = meta.atlasid,
		u = round_to_nearest(min_u * atlas_meta.width),
		v = round_to_nearest(min_v * atlas_meta.height),
		w = meta.width,
		h = meta.height,
	}
	cache[imgid] = rect
	return rect
end

function vdp_image.write_source(dst, rect)
	mem[dst] = rect.atlas_id
	mem[dst + 0x00000004] = rect.u
	mem[dst + (0x00000004 * 2)] = rect.v
	mem[dst + (0x00000004 * 3)] = rect.w
	mem[dst + (0x00000004 * 4)] = rect.h
end

return vdp_image
