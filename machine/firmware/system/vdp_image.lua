local round_to_nearest<const> = require('bios/util/round_to_nearest')
local romdir<const> = require('system/romdir')
local vdp_rpu_quads<const> = require('system/vdp_rpu_quads')

local vdp_image<const> = {}
local cache<const> = {}

local system_atlas_id<const> = 254

local slot_atlas_addr<const> = function(slot)
	if slot == sys_vdp_slot_primary then
		return sys_vdp_slot_primary_atlas
	end
	if slot == sys_vdp_slot_secondary then
		return sys_vdp_slot_secondary_atlas
	end
	error('invalid VDP image slot ' .. tostring(slot))
end

local bind_slot_atlas<const> = function(slot, atlas_id)
	if mem[sys_vdp_slot_primary_atlas] == atlas_id then
		mem[sys_vdp_slot_primary_atlas] = sys_vdp_slot_none
	end
	if mem[sys_vdp_slot_secondary_atlas] == atlas_id then
		mem[sys_vdp_slot_secondary_atlas] = sys_vdp_slot_none
	end
	mem[slot_atlas_addr(slot)] = atlas_id
end

local start_decode<const> = function(src, len, dst, cap)
	mem[sys_img_src] = src
	mem[sys_img_len] = len
	mem[sys_img_dst] = dst
	mem[sys_img_cap] = cap
	mem[sys_img_ctrl] = img_ctrl_start
end

function vdp_image.wait_decode()
	while (mem[sys_img_status] & img_status_busy) ~= 0 do
	end
	if (mem[sys_img_status] & img_status_error) ~= 0 then
		error('VDP image decode failed.')
	end
end

function vdp_image.load_slot(slot, atlas_id)
	local name<const> = string.format('_atlas_%02d', atlas_id)
	local atlas<const> = romdir.cart_atlas(name)
	local atlas_meta<const> = romdir.image(name).imgmeta
	local dst<const>, cap<const> = vdp_rpu_quads.set_slot_dim(slot, atlas_meta.width, atlas_meta.height)
	bind_slot_atlas(slot, atlas_id)
	start_decode(atlas.addr, atlas.len, dst, cap)
end

function vdp_image.load_system_slot()
	local name<const> = string.format('_atlas_%02d', system_atlas_id)
	local atlas<const> = romdir.system_rom_atlas(name)
	local atlas_meta<const> = romdir.system_image(name).imgmeta
	local dst<const>, cap<const> = vdp_rpu_quads.set_slot_dim(sys_vdp_slot_system, atlas_meta.width, atlas_meta.height)
	start_decode(atlas.addr, atlas.len, dst, cap)
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
		return sys_vdp_slot_system
	end
	if mem[sys_vdp_slot_primary_atlas] == rect.atlas_id then
		return sys_vdp_slot_primary
	end
	if mem[sys_vdp_slot_secondary_atlas] == rect.atlas_id then
		return sys_vdp_slot_secondary
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
	mem[dst + sys_vdp_arg_stride] = rect.u
	mem[dst + (sys_vdp_arg_stride * 2)] = rect.v
	mem[dst + (sys_vdp_arg_stride * 3)] = rect.w
	mem[dst + (sys_vdp_arg_stride * 4)] = rect.h
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
