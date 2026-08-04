local texture_residency<const> = {}
local gx_texture<const> = require('cartlib/gx/texture')
local vram_layout<const> = require('bmsx/gx_vram_layout')

local active_background_texture
local active_background_destination
local pending_background_texture
local pending_background_destination
local in_flight_background_texture
local in_flight_background_destination
local font_upload_in_flight
local combat_common_submitted = false

local invalidate_background_residency<const> = function()
	active_background_texture = nil
	active_background_destination = nil
	pending_background_texture = nil
	pending_background_destination = nil
	in_flight_background_texture = nil
	in_flight_background_destination = nil
end

function texture_residency.preload_background(imgid)
	local texture<const> = gx_texture.load(imgid)
	if texture == active_background_texture or texture == in_flight_background_texture then
		pending_background_texture = nil
		pending_background_destination = nil
		return
	end
	pending_background_texture = texture
	if (in_flight_background_destination or active_background_destination) == vram_layout.background_left_texture then
		pending_background_destination = vram_layout.background_right_texture
	else
		pending_background_destination = vram_layout.background_left_texture
	end
end

function texture_residency.replace_background(imgid)
	pending_background_texture = nil
	pending_background_destination = nil
	local texture<const> = gx_texture.load(imgid)
	if font_upload_in_flight then
		pending_background_texture = texture
		pending_background_destination = vram_layout.background_left_texture
		return
	end
	gx_texture.upload(texture, vram_layout.background_left_texture)
	in_flight_background_texture = texture
	in_flight_background_destination = vram_layout.background_left_texture
end

function texture_residency.load_font(imgid)
	-- The DMA channel accepts one transfer at a time. The initial background is
	-- queued until this persistent texture has reached its dedicated VRAM slot.
	font_upload_in_flight = true
	gx_texture.upload(gx_texture.load(imgid), vram_layout.font_texture)
end

function texture_residency.load_combat_workset(monster_imgid)
	invalidate_background_residency()
	if not combat_common_submitted then
		gx_texture.upload(gx_texture.load('maya_b'), vram_layout.maya_b_texture)
		gx_texture.upload(gx_texture.load('maya_a'), vram_layout.maya_a_texture)
		gx_texture.upload(gx_texture.load('maya_v_s'), vram_layout.maya_vs_texture)
		combat_common_submitted = true
	end
	gx_texture.upload(gx_texture.load(monster_imgid), vram_layout.monster_texture)
end

function texture_residency.load_all_out()
	invalidate_background_residency()
	gx_texture.upload(gx_texture.load('all_out'), vram_layout.all_out_texture)
end

function texture_residency.submit_pending_background()
	if font_upload_in_flight or not pending_background_texture or in_flight_background_texture then
		return
	end
	local texture<const> = pending_background_texture
	local destination<const> = pending_background_destination
	gx_texture.upload(texture, destination)
	in_flight_background_texture = texture
	in_flight_background_destination = destination
	pending_background_texture = nil
	pending_background_destination = nil
end

function texture_residency.complete_upload()
	if font_upload_in_flight then
		font_upload_in_flight = false
		texture_residency.submit_pending_background()
		return
	end
	if in_flight_background_texture then
		active_background_texture = in_flight_background_texture
		active_background_destination = in_flight_background_destination
		in_flight_background_texture = nil
		in_flight_background_destination = nil
	end
end

return texture_residency
