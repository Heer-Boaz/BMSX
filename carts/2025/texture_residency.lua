local texture_residency<const> = {}
local gx_texture<const> = require('cartlib/gx/texture')

local active_background_imgid
local pending_background_imgid
local in_flight_background_imgid
local font_upload_in_flight
local combat_common_submitted = false

local invalidate_background_residency<const> = function()
	active_background_imgid = nil
	pending_background_imgid = nil
	in_flight_background_imgid = nil
end

function texture_residency.preload_background(imgid)
	if imgid == active_background_imgid or imgid == in_flight_background_imgid then
		pending_background_imgid = nil
		return
	end
	pending_background_imgid = imgid
end

function texture_residency.replace_background(imgid)
	pending_background_imgid = nil
	if font_upload_in_flight then
		pending_background_imgid = imgid
		return
	end
	gx_texture.upload(imgid)
	in_flight_background_imgid = imgid
end

function texture_residency.load_font(imgid)
	-- The DMA channel accepts one transfer at a time. The initial background is
	-- queued until this persistent texture has reached its dedicated VRAM slot.
	font_upload_in_flight = true
	gx_texture.upload(imgid)
end

function texture_residency.load_combat_workset(monster_imgid)
	invalidate_background_residency()
	if not combat_common_submitted then
		gx_texture.upload('maya_b')
		gx_texture.upload('maya_a')
		gx_texture.upload('maya_v_s')
		combat_common_submitted = true
	end
	gx_texture.upload(monster_imgid)
end

function texture_residency.load_all_out()
	invalidate_background_residency()
	gx_texture.upload('all_out')
end

function texture_residency.submit_pending_background()
	if font_upload_in_flight or not pending_background_imgid or in_flight_background_imgid then
		return
	end
	local imgid<const> = pending_background_imgid
	gx_texture.upload(imgid)
	in_flight_background_imgid = imgid
	pending_background_imgid = nil
end

function texture_residency.complete_upload()
	if font_upload_in_flight then
		font_upload_in_flight = false
		texture_residency.submit_pending_background()
		return
	end
	if in_flight_background_imgid then
		active_background_imgid = in_flight_background_imgid
		in_flight_background_imgid = nil
	end
end

return texture_residency
