local texture_residency<const> = {}
local dma<const> = require('system/dma')
local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('cartlib/gx/image')

-- 2025 uses an explicit 1024x512 VRAM map. The upper half keeps the 320x240
-- framebuffer at x=0, Maya B at x=320, the system page at x=512, and Maya
-- A/V_S at x=768. The lower half is two 384x256 background banks followed by
-- the monster bank. These ranges must never overlap the framebuffer or system page.
local background_left_x<const> = 0
local background_right_x<const> = 384
local background_y<const> = 256
local combat_maya_b_x<const> = 320
local combat_maya_a_x<const> = 768
local combat_maya_v_s_x<const> = 847
local combat_maya_y<const> = 0
local combat_monster_x<const> = 768
local combat_monster_y<const> = 256
local all_out_x<const> = 0
local all_out_y<const> = 256

local active_background_atlas_id
local active_background_x
local pending_atlas_id
local pending_x
local in_flight_background_atlas_id
local in_flight_background_x
local combat_common_resident = false
local active_combat_monster_atlas_id

local start_upload<const> = function(atlas_id, texture_x, texture_y)
	local texture<const> = gx_image.packed_texture(atlas_id)
	local texture_meta<const> = texture.meta
	-- Binding at queue admission is safe: DMA owns GP0 until every queued upload
	-- completes, so no draw using these coordinates can enter the GPU early.
	gx_image.bind_direct16_residency(atlas_id, texture_x, texture_y)
	gx_gpu.begin_direct16_upload(texture_x, texture_y, texture_meta.width, texture_meta.height)
	dma.copy_to_gp0(texture.texture_addr, texture.texture_len)
end

function texture_residency.preload_background(imgid)
	local atlas_id<const> = gx_image.rect(imgid).atlas_id
	if atlas_id == active_background_atlas_id or atlas_id == in_flight_background_atlas_id then
		pending_atlas_id = nil
		pending_x = nil
		return
	end
	local occupied_x<const> = in_flight_background_x or active_background_x
	local target_x<const> = occupied_x == background_left_x and background_right_x or background_left_x
	pending_atlas_id = atlas_id
	pending_x = target_x
end

function texture_residency.replace_background(imgid)
	local atlas_id<const> = gx_image.rect(imgid).atlas_id
	in_flight_background_atlas_id = atlas_id
	in_flight_background_x = background_left_x
	start_upload(atlas_id, background_left_x, background_y)
end

function texture_residency.load_combat_workset(monster_imgid)
	in_flight_background_atlas_id = nil
	in_flight_background_x = nil
	if not combat_common_resident then
		start_upload(gx_image.rect('maya_b').atlas_id, combat_maya_b_x, combat_maya_y)
		start_upload(gx_image.rect('maya_a').atlas_id, combat_maya_a_x, combat_maya_y)
		start_upload(gx_image.rect('maya_v_s').atlas_id, combat_maya_v_s_x, combat_maya_y)
		combat_common_resident = true
	end
	local monster_atlas_id<const> = gx_image.rect(monster_imgid).atlas_id
	if monster_atlas_id ~= active_combat_monster_atlas_id then
		start_upload(monster_atlas_id, combat_monster_x, combat_monster_y)
		active_combat_monster_atlas_id = monster_atlas_id
	end
end

function texture_residency.load_all_out()
	in_flight_background_atlas_id = nil
	in_flight_background_x = nil
	local atlas_id<const> = gx_image.rect('all_out').atlas_id
	start_upload(atlas_id, all_out_x, all_out_y)
end

function texture_residency.submit_pending_background()
	if pending_atlas_id == nil then
		return
	end
	in_flight_background_atlas_id = pending_atlas_id
	in_flight_background_x = pending_x
	start_upload(pending_atlas_id, pending_x, background_y)
	pending_atlas_id = nil
	pending_x = nil
end

function texture_residency.complete_upload()
	if in_flight_background_atlas_id ~= nil then
		active_background_atlas_id = in_flight_background_atlas_id
		active_background_x = in_flight_background_x
		in_flight_background_atlas_id = nil
		in_flight_background_x = nil
	end
end

return texture_residency
