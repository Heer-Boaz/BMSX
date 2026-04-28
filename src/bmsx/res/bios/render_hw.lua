-- render_hw.lua
-- lightweight render helpers that forward to built-in API functions

local render_hw<const> = {}
local particle_options<const> = {}
local skybox_posx<const> = {}
local skybox_negx<const> = {}
local skybox_posy<const> = {}
local skybox_negy<const> = {}
local skybox_posz<const> = {}
local skybox_negz<const> = {}

local write_skybox_source<const> = function(dst, imgid)
	local rect<const> = vdp_img_rect(imgid)
	dst.slot = vdp_img_slot(rect)
	dst.u = rect.u
	dst.v = rect.v
	dst.w = rect.w
	dst.h = rect.h
end

function render_hw.put_mesh(mesh, matrix, opts)
	put_mesh(mesh, matrix, opts)
end

function render_hw.put_particle(position, size, color, opts)
	if opts == nil then
		error('render_hw.put_particle requires opts.texture.')
	end
	local rect<const> = vdp_img_rect(opts.texture)
	particle_options.slot = vdp_img_slot(rect)
	particle_options.u = rect.u
	particle_options.v = rect.v
	particle_options.w = rect.w
	particle_options.h = rect.h
	particle_options.ambient_mode = opts.ambient_mode
	particle_options.ambient_factor = opts.ambient_factor
	put_particle(position, size, color, particle_options)
end

function render_hw.set_camera(view, proj, eye)
	set_camera(view, proj, eye)
end

function render_hw.skybox(posx, negx, posy, negy, posz, negz)
	write_skybox_source(skybox_posx, posx)
	write_skybox_source(skybox_negx, negx)
	write_skybox_source(skybox_posy, posy)
	write_skybox_source(skybox_negy, negy)
	write_skybox_source(skybox_posz, posz)
	write_skybox_source(skybox_negz, negz)
	skybox(skybox_posx, skybox_negx, skybox_posy, skybox_negy, skybox_posz, skybox_negz)
end

function render_hw.put_ambient_light(id, color, intensity)
	put_ambient_light(id, color, intensity)
end

function render_hw.put_directional_light(id, orientation, color, intensity)
	put_directional_light(id, orientation, color, intensity)
end

function render_hw.put_point_light(id, position, color, range, intensity)
	put_point_light(id, position, color, range, intensity)
end

return render_hw
