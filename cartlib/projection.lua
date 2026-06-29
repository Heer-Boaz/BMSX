-- projection.lua
-- Complete Lua port of the M4 projection constructors from math3d.ts.
-- All functions return 16 flat scalar values in column-major order,
-- matching the Float32Array layout used by M4.*Into() in TypeScript:
--   index  0- 3 = column 0  (row 0..3)
--   index  4- 7 = column 1
--   index  8-11 = column 2
--   index 12-15 = column 3
-- Angles in radians throughout.

local tan<const> = require('bios/math').tan
local abs<const> = require('bios/math').abs
local atan<const> = require('bios/math').atan
local sqrt<const> = require('bios/math').sqrt

-- ── proj_perspective ──────────────────────────────────────────────────────────
-- Standard symmetric perspective frustum.
-- fov_rad: vertical field-of-view; aspect = width/height.
-- Matches M4.perspectiveInto() in math3d.ts.
local proj_perspective<const> = function(fov_rad, aspect, near, far)
	local f<const>  = 1.0 / tan(fov_rad * 0.5)
	local nf<const> = 1.0 / (near - far)
	return
		f / aspect, 0.0, 0.0,  0.0,   -- col 0
		0.0, f, 0.0,           0.0,   -- col 1
		0.0, 0.0, (far + near) * nf, -1.0,  -- col 2
		0.0, 0.0, 2.0 * far * near * nf, 0.0  -- col 3
end

-- ── proj_orthographic ─────────────────────────────────────────────────────────
-- Orthographic (parallel) projection.
-- l/r = left/right clip, b/t = bottom/top clip, n/f = near/far.
-- Matches M4.orthographicInto() in math3d.ts.
local proj_orthographic<const> = function(l, r, b, t, n, f)
	local lr<const> = 1.0 / (l - r)
	local bt<const> = 1.0 / (b - t)
	local nf<const> = 1.0 / (n - f)
	return
		-2.0 * lr, 0.0, 0.0,    0.0,   -- col 0
		0.0, -2.0 * bt, 0.0,    0.0,   -- col 1
		0.0, 0.0, 2.0 * nf,     0.0,   -- col 2
		(l + r) * lr, (t + b) * bt, (f + n) * nf, 1.0  -- col 3
end

-- ── proj_fisheye ──────────────────────────────────────────────────────────────
-- Fisheye (equal-angle) approximation: same depth terms as perspective,
-- but x and y use the same focal length (aspect ratio ignored).
-- Matches M4.fisheyeInto() in math3d.ts (parameter _aspect is unused there).
local proj_fisheye<const> = function(fov_rad, near, far)
	local f<const>  = 1.0 / tan(fov_rad * 0.5)
	local nf<const> = 1.0 / (near - far)
	return
		f, 0.0, 0.0,   0.0,   -- col 0
		0.0, f, 0.0,   0.0,   -- col 1
		0.0, 0.0, (far + near) * nf, -1.0,  -- col 2
		0.0, 0.0, 2.0 * far * near * nf, 0.0  -- col 3
end

-- ── proj_panorama ─────────────────────────────────────────────────────────────
-- Cylindrical-panorama approximation: horizontal FOV drives x scale,
-- vertical FOV is derived from hfov/aspect.
-- Matches M4.panoramaInto() in math3d.ts.
local proj_panorama<const> = function(hfov, aspect, near, far)
	local ht<const>   = tan(hfov * 0.5)
	local vfov<const> = (abs(aspect) > 1e-6) and (2.0 * atan(ht / aspect)) or hfov
	local sx<const>   = 1.0 / ht
	local sy<const>   = 1.0 / tan(vfov * 0.5)
	local nf<const>   = 1.0 / (near - far)
	return
		sx, 0.0, 0.0,   0.0,   -- col 0
		0.0, sy, 0.0,   0.0,   -- col 1
		0.0, 0.0, (far + near) * nf, -1.0,  -- col 2
		0.0, 0.0, 2.0 * far * near * nf, 0.0  -- col 3
end

-- ── proj_oblique ──────────────────────────────────────────────────────────────
-- Oblique parallel projection: orthographic + shear in Z direction.
-- alpha_rad/beta_rad are the horizontal/vertical shear angles (non-zero).
-- Equivalent to shear_matrix * ortho_matrix; derived inline here.
-- Matches M4.obliqueInto() in math3d.ts.
local proj_oblique<const> = function(l, r, b, t, n, f, alpha_rad, beta_rad)
	local lr<const>    = 1.0 / (l - r)
	local bt<const>    = 1.0 / (b - t)
	local nf<const>    = 1.0 / (n - f)
	local ca<const>    = 1.0 / tan(alpha_rad)   -- cot(alpha)
	local cb<const>    = 1.0 / tan(beta_rad)    -- cot(beta)
	local fn_nf<const> = (f + n) * nf
	return
		-2.0 * lr, 0.0, 0.0,  0.0,   -- col 0
		0.0, -2.0 * bt, 0.0,  0.0,   -- col 1
		2.0 * nf * ca, 2.0 * nf * cb, 2.0 * nf, 0.0,  -- col 2
		(l + r) * lr + ca * fn_nf, (t + b) * bt + cb * fn_nf, fn_nf, 1.0  -- col 3
end

-- ── proj_asymmetric_frustum ───────────────────────────────────────────────────
-- Off-centre perspective frustum (VR / multi-display).
-- l/r/b/t define the frustum edges (need not be symmetric around origin).
-- Matches M4.asymmetricFrustumInto() in math3d.ts.
local proj_asymmetric_frustum<const> = function(l, r, b, t, n, f)
	local rl<const> = r - l
	local tb<const> = t - b
	local fn<const> = f - n
	return
		2.0 * n / rl, 0.0, 0.0,     0.0,   -- col 0
		0.0, 2.0 * n / tb, 0.0,     0.0,   -- col 1
		(r + l) / rl, (t + b) / tb, -(f + n) / fn, -1.0,  -- col 2
		0.0, 0.0, -2.0 * f * n / fn, 0.0   -- col 3
end

-- ── proj_isometric ────────────────────────────────────────────────────────────
-- Standard isometric (axonometric) projection matrix.
-- Combines 45° yaw and ~35.26° pitch into a combined rotation+scale.
-- scale: uniform scale factor (default 1).
-- Matches M4.isometricInto() in math3d.ts.
local proj_isometric<const> = function(scale)
	local sqrt2<const> = sqrt(2.0)
	local sqrt6<const> = sqrt(6.0)
	local a<const>     = scale * sqrt2 / 2.0
	local b<const>     = scale * sqrt2 / sqrt6
	local c<const>     = scale * 2.0  / sqrt6
	return
			a, -a, 0.0, 0.0,   -- col 0
			b,  b, -c,  0.0,   -- col 1
			0.0, 0.0, 0.0, 0.0,  -- col 2
			0.0, 0.0, 0.0, 1.0   -- col 3
end

-- ── proj_infinite_perspective ─────────────────────────────────────────────────
-- Perspective with far plane at infinity (no far-clip artefacts).
-- Only near plane is needed; depth precision accumulates near near plane.
-- Matches M4.infinitePerspectiveInto() in math3d.ts.
local proj_infinite_perspective<const> = function(fov_rad, aspect, near)
	local f<const> = 1.0 / tan(fov_rad * 0.5)
	return
		f / aspect, 0.0, 0.0,  0.0,   -- col 0
		0.0, f, 0.0,           0.0,   -- col 1
		0.0, 0.0, -1.0,       -1.0,   -- col 2
		0.0, 0.0, -2.0 * near, 0.0   -- col 3
end

return {
	proj_perspective          = proj_perspective,
	proj_orthographic         = proj_orthographic,
	proj_fisheye              = proj_fisheye,
	proj_panorama             = proj_panorama,
	proj_oblique              = proj_oblique,
	proj_asymmetric_frustum   = proj_asymmetric_frustum,
	proj_isometric            = proj_isometric,
	proj_infinite_perspective = proj_infinite_perspective,
}
