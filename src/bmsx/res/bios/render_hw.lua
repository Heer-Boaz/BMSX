-- render_hw.lua
-- lightweight render helpers that forward to built-in API functions

local render_hw = {}

function render_hw.put_mesh(mesh, matrix, opts)
	put_mesh(mesh, matrix, opts)
end

function render_hw.put_particle(position, size, color, opts)
	put_particle(position, size, color, opts)
end

function render_hw.set_camera(view, proj, eye)
	set_camera(view, proj, eye)
end

function render_hw.skybox(posx, negx, posy, negy, posz, negz)
	skybox(posx, negx, posy, negy, posz, negz)
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
