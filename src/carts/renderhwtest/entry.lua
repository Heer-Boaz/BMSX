local mesh = nil
local t = 0
local render_hw = require("render_hw")
local put_mesh = render_hw.put_mesh
local put_particle = render_hw.put_particle
local set_camera = render_hw.set_camera
local put_ambient_light = render_hw.put_ambient_light
local put_directional_light = render_hw.put_directional_light
local put_point_light = render_hw.put_point_light

local function normalize(x, y, z)
	local len = math.sqrt(x * x + y * y + z * z)
	return x / len, y / len, z / len
end

local function look_at(eye, target, up)
	local fx = target[1] - eye[1]
	local fy = target[2] - eye[2]
	local fz = target[3] - eye[3]
	fx, fy, fz = normalize(fx, fy, fz)

	local rx = fy * up[3] - fz * up[2]
	local ry = fz * up[1] - fx * up[3]
	local rz = fx * up[2] - fy * up[1]
	rx, ry, rz = normalize(rx, ry, rz)

	local ux = ry * fz - rz * fy
	local uy = rz * fx - rx * fz
	local uz = rx * fy - ry * fx

	local bx = -fx
	local by = -fy
	local bz = -fz

	return {
		rx, ux, bx, 0,
		ry, uy, by, 0,
		rz, uz, bz, 0,
		-(rx * eye[1] + ry * eye[2] + rz * eye[3]),
		-(ux * eye[1] + uy * eye[2] + uz * eye[3]),
		-(bx * eye[1] + by * eye[2] + bz * eye[3]),
		1,
	}
end

local function perspective(fov_deg, aspect, near, far)
	local fov_rad = (fov_deg * math.pi) / 180
	local f = 1 / math.tan(fov_rad / 2)
	local nf = 1 / (near - far)
	return {
		f / aspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (far + near) * nf, -1,
		0, 0, 2 * far * near * nf, 0,
	}
end

local function rotate_y(angle)
	local c = math.cos(angle)
	local s = math.sin(angle)
	return {
		c, 0, -s, 0,
		0, 1, 0, 0,
		s, 0, c, 0,
		0, 0, 0, 1,
	}
end

function init()
	mesh = mesh_from_model('cube', 0)
end

function new_game()
end

function update()
	t = t + 0.02
end

function draw()
	local aspect = display_width() / display_height()
	local eye = { math.cos(t) * 4, 2.5, math.sin(t) * 4 }
	local target = { 0, 0, 0 }
	local up = { 0, 1, 0 }
	local view = look_at(eye, target, up)
	local proj = perspective(60, aspect, 0.1, 50)
	set_camera(view, proj, eye)
	put_ambient_light('amb', { r = 0.35, g = 0.4, b = 0.55 }, 0.18)
	put_directional_light('sun', { x = -0.6, y = -1.0, z = -0.35 }, { r = 1.0, g = 0.95, b = 0.82 }, 1.1)
	put_point_light('lamp', { x = math.cos(t * 1.2) * 1.4, y = 1.6, z = math.sin(t * 1.2) * 1.4 }, { r = 0.35, g = 0.7, b = 1.0 }, 4.5, 1.35)

	local model = rotate_y(t * 0.7)
	put_mesh(mesh, model, { receive_shadow = false })

	for i = 1, 24 do
		local a = (i / 24) * math.pi * 2 + t * 1.4
		local x = math.cos(a) * 2.2
		local z = math.sin(a) * 2.2
		local y = math.sin(t * 2 + i * 0.3) * 0.4 + 0.6
		put_particle({ x, y, z }, 0.18, { r = 1, g = 0.7, b = 0.2, a = 0.9 }, {
			texture = 'whitepixel',
			ambient_mode = 0,
			ambient_factor = 1,
		})
	end
end
