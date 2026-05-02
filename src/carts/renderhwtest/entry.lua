local mesh = nil
local t = 0
local render_hw = require("bios/render_hw")
local put_mesh = render_hw.put_mesh
local set_camera = render_hw.set_camera
local put_ambient_light = render_hw.put_ambient_light
local put_directional_light = render_hw.put_directional_light
local put_point_light = render_hw.put_point_light

local normalize<const> = function(x, y, z)
	local len = math.sqrt(x * x + y * y + z * z)
	return x / len, y / len, z / len
end

local look_at<const> = function(eye, target, up)
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

local perspective<const> = function(fov_deg, aspect, near, far)
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

local rotate_y<const> = function(angle)
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

local update_cart<const> = function()
	t = t + 0.02
end

local draw_cart<const> = function()
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
end

local dispatch_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

mem[sys_inp_ctrl] = inp_ctrl_arm
local flags
repeat
	halt_until_irq
	flags = dispatch_irqs()
until (flags & irq_vblank) ~= 0

while true do
	update_cart()
	mem[sys_inp_ctrl] = inp_ctrl_arm
	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
	vdp_stream_cursor = sys_vdp_stream_base
	draw_cart()
	do
		local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
		if used_bytes ~= 0 then
			mem[sys_dma_src] = sys_vdp_stream_base
			mem[sys_dma_dst] = sys_vdp_fifo
			mem[sys_dma_len] = used_bytes
			mem[sys_dma_ctrl] = dma_ctrl_start
		end
	end
end
