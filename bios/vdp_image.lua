local round_to_nearest<const> = require('bios/util/round_to_nearest')
local romdir<const> = require('bios/romdir')
local vdp_rpu_quads<const> = require('bios/vdp_rpu_quads')

local vdp_image<const> = {}
local cache<const> = {}
local load_queue<const> = {}

local atlas_name<const> = function(atlas_id)
	return string.format('_atlas_%02d', atlas_id)
end

local system_atlas_id<const> = 254
local load_job_seq = 0
local load_queue_head
local load_queue_tail
local active_job
local load_handler

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

local dequeue_job<const> = function()
	if load_queue_head == nil or load_queue_tail == nil then
		return nil
	end
	if load_queue_head > load_queue_tail then
		return nil
	end
	local job<const> = load_queue[load_queue_head]
	load_queue[load_queue_head] = nil
	load_queue_head = load_queue_head + 1
	if load_queue_head > load_queue_tail then
		load_queue_head = nil
		load_queue_tail = nil
	end
	return job
end

local start_job<const> = function(job)
	active_job = job
	if job.slot ~= nil then
		bind_slot_atlas(job.slot, job.atlas_id)
	end
	mem[sys_img_src] = job.src
	mem[sys_img_len] = job.len
	mem[sys_img_dst] = job.dst
	mem[sys_img_cap] = job.cap
	mem[sys_img_ctrl] = img_ctrl_start
end

local try_start_next_job<const> = function()
	if active_job ~= nil then
		return
	end
	local status<const> = mem[sys_img_status]
	if (status & img_status_busy) ~= 0 then
		return
	end
	local job<const> = dequeue_job()
	if job == nil then
		return
	end
	start_job(job)
end

local enqueue_job<const> = function(job)
	if load_queue_head == nil then
		load_queue_head = 1
		load_queue_tail = 0
	end
	load_queue_tail = load_queue_tail + 1
	load_queue[load_queue_tail] = job
	try_start_next_job()
end

function vdp_image.load_slot(slot, atlas_id)
	local name<const> = atlas_name(atlas_id)
	local atlas<const> = romdir.cart_atlas(name)
	local atlas_meta<const> = romdir.image(name).imgmeta
	local dst
	local cap
	if slot == sys_vdp_slot_primary then
		dst = sys_vram_primary_slot_base
		cap = sys_vram_primary_slot_size
	elseif slot == sys_vdp_slot_secondary then
		dst = sys_vram_secondary_slot_base
		cap = sys_vram_secondary_slot_size
	else
		error('vdp_load_slot: invalid slot ' .. tostring(slot))
	end
	vdp_rpu_quads.set_slot_dim(slot, atlas_meta.width, atlas_meta.height)
	vdp_rpu_quads.submit_slot_resources(slot)
	load_job_seq = load_job_seq + 1
	enqueue_job({
		job_id = load_job_seq,
		slot = slot,
		atlas_id = atlas_id,
		allow_handler = true,
		src = atlas.addr,
		len = atlas.len,
		dst = dst,
		cap = cap,
	})
	return load_job_seq
end

function vdp_image.load_system_slot()
	local name<const> = atlas_name(system_atlas_id)
	local atlas<const> = romdir.system_rom_atlas(name)
	local atlas_meta<const> = romdir.system_image(name).imgmeta
	vdp_rpu_quads.set_slot_dim(sys_vdp_slot_system, atlas_meta.width, atlas_meta.height)
	vdp_rpu_quads.submit_slot_resources(sys_vdp_slot_system)
	load_job_seq = load_job_seq + 1
	enqueue_job({
		job_id = load_job_seq,
		slot = nil,
		atlas_id = system_atlas_id,
		allow_handler = false,
		src = atlas.addr,
		len = atlas.len,
		dst = sys_vram_system_slot_base,
		cap = sys_vram_system_slot_size,
	})
	return load_job_seq
end

function vdp_image.irq(flags)
	local ack = 0
	if (flags & irq_img_done) ~= 0 then
		ack = ack | irq_img_done
		if active_job.allow_handler and load_handler ~= nil then
			load_handler(active_job.job_id, active_job.slot, active_job.atlas_id, 'done')
		end
		active_job = nil
		try_start_next_job()
	end
	if (flags & irq_img_error) ~= 0 then
		ack = ack | irq_img_error
		if active_job.allow_handler and load_handler ~= nil then
			load_handler(active_job.job_id, active_job.slot, active_job.atlas_id, 'error')
		end
		active_job = nil
	end
	return ack
end

function vdp_image.on_load(handler)
	if handler == nil then
		load_handler = nil
		return
	end
	if type(handler) ~= 'function' then
		error('on_vdp_load: handler must be a function')
	end
	load_handler = handler
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
	local atlas<const> = romdir.image(atlas_name(atlas_id))
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
	vdp_rpu_quads.blit_source_color(vdp_image.slot(rect), rect.u, rect.v, rect.w, rect.h, x, y, z, layer, scale_x, scale_y, flip_flags, color)
end

function vdp_image.write_glyph_color(glyph, x, y, z, layer, color)
	vdp_image.write_blit_color(glyph.imgid, x, y, z, layer, 1, 1, 0, color)
end

function vdp_image.write_item_color(item, x, y, z, layer, color)
	vdp_rpu_quads.blit_source_color(vdp_image.slot(item), item.u, item.v, item.w, item.h, x, y, z, layer, 1, 1, 0, color)
end

return vdp_image
