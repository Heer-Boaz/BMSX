local round_to_nearest<const> = require('bios/util/round_to_nearest')
local imgdec<const> = require('system/imgdec')
local romdir<const> = require('system/romdir')
local vdp_rpu_quads<const> = require('system/vdp_rpu_quads')

local vdp_image<const> = {}
local cache<const> = {}

local system_atlas_name<const> = '_atlas_254'
local system_atlas_meta<const> = romdir.system_image(system_atlas_name).imgmeta
vdp_rpu_quads.set_slot_dim(0x00000002, system_atlas_meta.width, system_atlas_meta.height)

local slot_atlas_addr<const> = function(slot)
	if slot == 0x00000000 then
		return 0x0800000c
	end
	if slot == 0x00000001 then
		return 0x08000010
	end
	error('invalid VDP image slot ' .. tostring(slot))
end

local bind_slot_atlas<const> = function(slot, atlas_id)
	if mem[0x0800000c] == atlas_id then
		mem[0x0800000c] = 0xffffffff
	end
	if mem[0x08000010] == atlas_id then
		mem[0x08000010] = 0xffffffff
	end
	mem[slot_atlas_addr(slot)] = atlas_id
end

function vdp_image.load_slot(slot, atlas_id)
	local name<const> = string.format('_atlas_%02d', atlas_id)
	local atlas<const> = romdir.cart_atlas(name)
	local atlas_meta<const> = romdir.image(name).imgmeta
	local dst<const>, cap<const> = vdp_rpu_quads.set_slot_dim(slot, atlas_meta.width, atlas_meta.height)
	bind_slot_atlas(slot, atlas_id)
	imgdec.start(atlas.addr, atlas.len, dst, cap)
end

function vdp_image.load_system_slot()
	local atlas<const> = romdir.system_rom_atlas(system_atlas_name)
	local dst<const>, cap<const> = vdp_rpu_quads.set_slot_dim(0x00000002, system_atlas_meta.width, system_atlas_meta.height)
	imgdec.start(atlas.addr, atlas.len, dst, cap)
end

local require_meta<const> = function(imgid)
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
	local atlas<const> = romdir.image(string.format('_atlas_%02d', atlas_id))
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
	local rect<const> = {
		atlas_id = meta.atlasid,
		u = round_to_nearest(min_u * atlas_meta.width),
		v = round_to_nearest(min_v * atlas_meta.height),
		w = meta.width,
		h = meta.height,
	}
	cache[imgid] = rect
	return rect
end

function vdp_image.slot(rect)
	if rect.atlas_id == 254 then
		return 0x00000002
	end
	if mem[0x0800000c] == rect.atlas_id then
		return 0x00000000
	end
	if mem[0x08000010] == rect.atlas_id then
		return 0x00000001
	end
	error('atlas ' .. tostring(rect.atlas_id) .. ' is not loaded in a VDP slot.')
end

function vdp_image.source(rect)
	return {
		slot = vdp_image.slot(rect),
		u = rect.u,
		v = rect.v,
		w = rect.w,
		h = rect.h,
	}
end

function vdp_image.write_source(dst, rect)
	mem[dst] = vdp_image.slot(rect)
	mem[dst + 0x00000004] = rect.u
	mem[dst + (0x00000004 * 2)] = rect.v
	mem[dst + (0x00000004 * 3)] = rect.w
	mem[dst + (0x00000004 * 4)] = rect.h
end

function vdp_image.write_blit_color(imgid, x, y, z, layer, scale_x, scale_y, flip_flags, color)
	local rect<const> = vdp_image.rect(imgid)
	local slot<const> = vdp_image.slot(rect)
	vdp_rpu_quads.blit_source_color(slot, rect.u, rect.v, rect.w, rect.h, x, y, z, layer, scale_x, scale_y, flip_flags, color)
end

function vdp_image.write_blit_affine_color(imgid, origin_x, origin_y, z, layer, axis_xx, axis_xy, axis_yx, axis_yy, flip_flags, color)
	local rect<const> = vdp_image.rect(imgid)
	local slot<const> = vdp_image.slot(rect)
	vdp_rpu_quads.blit_source_affine_color(slot, rect.u, rect.v, rect.w, rect.h, origin_x, origin_y, z, layer, axis_xx, axis_xy, axis_yx, axis_yy, flip_flags, color)
end

function vdp_image.write_glyph_color(glyph, x, y, z, layer, color)
	local rect<const> = vdp_image.rect(glyph.imgid)
	local slot<const> = vdp_image.slot(rect)
	vdp_rpu_quads.blit_source_color(slot, rect.u, rect.v, rect.w, rect.h, x, y, z, layer, 1, 1, 0, color)
end

return vdp_image
