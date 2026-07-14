local texture_residency<const> = {}
local gx_image<const> = require('cartlib/gx/image')
local gx_texture<const> = require('cartlib/gx/texture')
local texture_layout<const> = require('bmsx/gx_texture_layout')

local active_background_texture
local active_background_destination
local pending_background_texture
local pending_background_destination
local in_flight_background_texture
local in_flight_background_destination
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
	local texture<const> = gx_image.rect(imgid).texture
	if texture == active_background_texture or texture == in_flight_background_texture then
		pending_background_texture = nil
		pending_background_destination = nil
		return
	end
	pending_background_texture = texture
	if (in_flight_background_destination or active_background_destination) == texture_layout.background_left then
		pending_background_destination = texture_layout.background_right
	else
		pending_background_destination = texture_layout.background_left
	end
end

function texture_residency.replace_background(imgid)
	pending_background_texture = nil
	pending_background_destination = nil
	local texture<const> = gx_image.rect(imgid).texture
	gx_texture.upload(texture, texture_layout.background_left)
	in_flight_background_texture = texture
	in_flight_background_destination = texture_layout.background_left
end

function texture_residency.load_combat_workset(monster_imgid)
	invalidate_background_residency()
	if not combat_common_submitted then
		gx_texture.upload(gx_image.rect('maya_b').texture, texture_layout.maya_b)
		gx_texture.upload(gx_image.rect('maya_a').texture, texture_layout.maya_a)
		gx_texture.upload(gx_image.rect('maya_v_s').texture, texture_layout.maya_vs)
		combat_common_submitted = true
	end
	gx_texture.upload(gx_image.rect(monster_imgid).texture, texture_layout.monster)
end

function texture_residency.load_all_out()
	invalidate_background_residency()
	gx_texture.upload(gx_image.rect('all_out').texture, texture_layout.all_out)
end

function texture_residency.submit_pending_background()
	if not pending_background_texture or in_flight_background_texture then
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
	if in_flight_background_texture then
		active_background_texture = in_flight_background_texture
		active_background_destination = in_flight_background_destination
		in_flight_background_texture = nil
		in_flight_background_destination = nil
	end
end

return texture_residency
