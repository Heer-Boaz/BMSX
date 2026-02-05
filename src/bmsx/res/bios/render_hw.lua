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

return render_hw
