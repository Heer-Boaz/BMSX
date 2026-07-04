-- camera_object.lua
-- Lua port of the TypeScript Camera + CameraObject architecture.
--
-- A camera object is a mutable table containing:
--   x, y, z          — world-space position
--   qx, qy, qz, qw   — quaternion orientation (source of truth, like Camera._q)
--   fov_deg           — vertical FOV in degrees
--   aspect            — width / height
--   near, far         — clip planes
--   proj              — projection type string (see cam_set_proj)
--   alpha_rad/beta_rad — oblique shear angles
--   ortho_l/r/b/t     — orthographic / oblique slab extents
--   iso_scale         — isometric axonometric scale
--
-- Control methods mirror camera3d.ts:
--   cam_screen_look  → Camera.screenLook
--   cam_flight_look  → Camera.flightLook
--   cam_move         → Camera.moveForward / strafeRight / strafeUp (one q_basis call)
--   cam_look_at      → Camera.lookAt
--
-- Rendering helpers:
--   cam_view_terms   → position + quaternion → 9 basis scalars + 3 translation terms
--   cam_proj_terms   → projection params → 4 scalars for sparse perspective P matrix
--   cam_proj_matrix  → full 16-component column-major P matrix for any projection type
--
-- All local identifiers lowercase; non-reassigned locals use <const>.

local camera<const>     = require('cartlib/camera')
local q_basis<const>    = camera.q_basis
local q_look_at<const>  = camera.q_look_at
local screen_look<const> = camera.screen_look
local flight_look<const> = camera.flight_look
local projection<const> = require('cartlib/projection')
local pi<const> = require('bios/math').pi
local tan<const> = require('bios/math').tan
local abs<const> = require('bios/math').abs
local atan<const> = require('bios/math').atan

bss next_cam_id: word

-- ── cam_new ───────────────────────────────────────────────────────────────────
-- Create a new camera object.  Orientation initialises to identity (no rotation).
-- Projection defaults to 'perspective'.  All extra projection params are pre-filled
-- with neutral defaults so any proj type can be activated without extra setup.
-- The 'id' field is auto-generated (mirrors WorldObject constructor).
local cam_new<const> = function(x, y, z, fov_deg, aspect, near, far)
	*next_cam_id = *next_cam_id + 1
	local id<const> = 'cameraobject_' .. *next_cam_id
	return {
		id     = id,
		x = x, y = y, z = z,
		qx = 0.0, qy = 0.0, qz = 0.0, qw = 1.0,
		fov_deg  = fov_deg,
		aspect   = aspect,
		near     = near,
		far      = far,
		proj     = 'perspective',
		-- Oblique params (used when proj = 'oblique')
		alpha_rad = 0.7854, beta_rad = 0.7854,
		-- Orthographic / oblique slab extents (used when proj = 'orthographic' | 'oblique')
		ortho_l = -1.0, ortho_r = 1.0, ortho_b = -1.0, ortho_t = 1.0,
		-- Isometric axonometric scale (used when proj = 'isometric')
		iso_scale = 0.1,
	}
end

-- ── cam_set_proj ──────────────────────────────────────────────────────────────
-- Change the active projection type at runtime.
-- Recognised values (mirror CameraProjectionType in camera3d.ts):
--   'perspective' | 'orthographic' | 'fisheye' | 'panorama' |
--   'oblique' | 'asymmetric_frustum' | 'isometric' | 'infinite_perspective'
local cam_set_proj<const> = function(cam, proj)
	cam.proj = proj
end

-- ── cam_set_fov ───────────────────────────────────────────────────────────────
-- Change the vertical field-of-view in degrees.  Mirrors Camera.setFov().
local cam_set_fov<const> = function(cam, fov_deg)
	cam.fov_deg = fov_deg
end

-- ── cam_set_clip ──────────────────────────────────────────────────────────────
-- Change near and far clip planes.  Mirrors Camera.setClip().
local cam_set_clip<const> = function(cam, near, far)
	cam.near = near
	cam.far  = far
end

-- ── cam_set_aspect ────────────────────────────────────────────────────────────
-- Change the aspect ratio (width / height).  Mirrors Camera.setAspect().
local cam_set_aspect<const> = function(cam, aspect)
	cam.aspect = aspect
end

-- ── cam_look_at ───────────────────────────────────────────────────────────────
-- Orient the camera so it faces world-space target (tx,ty,tz).
-- upx/upy/upz: world-up hint vector for roll-free orientation (typically 0,1,0).
-- Mirrors Camera.lookAt() in camera3d.ts.
local cam_look_at<const> = function(cam, tx, ty, tz, upx, upy, upz)
	local qx<const>, qy<const>, qz<const>, qw<const> =
		q_look_at(cam.x, cam.y, cam.z, tx, ty, tz, upx, upy, upz)
	cam.qx = qx;  cam.qy = qy;  cam.qz = qz;  cam.qw = qw
end

-- ── cam_screen_look ───────────────────────────────────────────────────────────
-- Screen-space look: yaw around the camera's current up axis, pitch around its
-- right axis, optional roll around its forward axis.
-- Mirrors Camera.screenLook() in camera3d.ts.
local cam_screen_look<const> = function(cam, dyaw, dpitch, droll)
	local rx<const>, ry<const>, rz<const>,
			ux<const>, uy<const>, uz<const> = q_basis(cam.qx, cam.qy, cam.qz, cam.qw)
	local nqx<const>, nqy<const>, nqz<const>, nqw<const> =
		screen_look(cam.qx, cam.qy, cam.qz, cam.qw,
					rx, ry, rz, ux, uy, uz, dyaw, dpitch, droll)
	cam.qx = nqx;  cam.qy = nqy;  cam.qz = nqz;  cam.qw = nqw
end

-- ── cam_flight_look ───────────────────────────────────────────────────────────
-- Flight-sim look: sequential rotations over body axes in roll → pitch → yaw order.
-- Mirrors Camera.flightLook() in camera3d.ts.
local cam_flight_look<const> = function(cam, dyaw, dpitch, droll)
	local nqx<const>, nqy<const>, nqz<const>, nqw<const> =
		flight_look(cam.qx, cam.qy, cam.qz, cam.qw, dyaw, dpitch, droll)
	cam.qx = nqx;  cam.qy = nqy;  cam.qz = nqz;  cam.qw = nqw
end

-- ── cam_move ──────────────────────────────────────────────────────────────────
-- Move in camera-relative directions.  Performs one q_basis call to cover all axes.
--   fwd   : amount along forward axis (positive = into scene)
--   right : amount along right axis   (positive = rightward)
--   up    : amount along up axis      (positive = upward)
-- Combines Camera.moveForward / strafeRight / strafeUp from camera3d.ts.
local cam_move<const> = function(cam, fwd, right, up)
	local rx<const>, ry<const>, rz<const>,
			ux<const>, uy<const>, uz<const>,
			fx<const>, fy<const>, fz<const> = q_basis(cam.qx, cam.qy, cam.qz, cam.qw)
	cam.x = cam.x + fx * fwd + rx * right + ux * up
	cam.y = cam.y + fy * fwd + ry * right + uy * up
	cam.z = cam.z + fz * fwd + rz * right + uz * up
end

-- ── cam_view_terms ────────────────────────────────────────────────────────────
-- Compute the 9 view-space basis scalars and 3 view-space translation terms
-- derived from the camera's position and quaternion.
-- Returns: crx,cry,crz (right),  cux,cuy,cuz (up),  cfx,cfy,cfz (forward into scene),
--          v_tx, v_ty, v_tz
-- where:   v_tx = -(cr · pos),  v_ty = -(cu · pos),  v_tz = cf · pos
-- (standard right-handed OpenGL view convention, same as M4.viewFromBasisInto in TS).
local cam_view_terms<const> = function(cam)
	local crx<const>, cry<const>, crz<const>,
			cux<const>, cuy<const>, cuz<const>,
			cfx<const>, cfy<const>, cfz<const> = q_basis(cam.qx, cam.qy, cam.qz, cam.qw)
	local v_tx<const> = -(crx * cam.x + cry * cam.y + crz * cam.z)
	local v_ty<const> = -(cux * cam.x + cuy * cam.y + cuz * cam.z)
	local v_tz<const> =   cfx * cam.x + cfy * cam.y + cfz * cam.z
	return crx, cry, crz, cux, cuy, cuz, cfx, cfy, cfz, v_tx, v_ty, v_tz
end

-- ── cam_proj_terms ────────────────────────────────────────────────────────────
-- Returns the 4 scalars (proj_fx, proj_fy, proj_a, proj_b) for the sparse
-- perspective-family P matrix used by the cart's MVP assembly:
--
--   P = [ [pfx, 0,  0,  0 ],
--         [ 0, pfy, 0,  0 ],
--         [ 0,  0, pa,  pb],
--         [ 0,  0, -1,  0 ] ]
--
-- Covers: 'perspective' (default), 'fisheye', 'panorama', 'infinite_perspective'.
-- For other types (orthographic, oblique, isometric, asymmetric_frustum) use
-- cam_proj_matrix which returns the full 16-component column-major P matrix.
local cam_proj_terms<const> = function(cam)
	local fov_rad<const> = cam.fov_deg * (pi / 180.0)
	local near<const>    = cam.near
	local far<const>     = cam.far
	local proj<const>    = cam.proj
	if proj == 'fisheye' then
		-- Fisheye: same as perspective but ignores aspect (both axes use full f).
		local f<const>  = 1.0 / tan(fov_rad * 0.5)
		local nf<const> = 1.0 / (near - far)
		return f, f, (far + near) * nf, 2.0 * far * near * nf
	elseif proj == 'panorama' then
		-- Panorama: horizontal FOV given, vertical derived from aspect.
		local ht<const>    = tan(fov_rad * 0.5)
		local aspect<const> = cam.aspect
		local vhalf<const> = (abs(aspect) > 1e-6)
			and atan(ht / aspect) or (fov_rad * 0.5)
		local sx<const>  = 1.0 / ht
		local sy<const>  = 1.0 / tan(vhalf)
		local nf<const>  = 1.0 / (near - far)
		return sx, sy, (far + near) * nf, 2.0 * far * near * nf
	elseif proj == 'infinite_perspective' then
		-- Infinite perspective: far plane at infinity; depth terms collapse.
		local f<const> = 1.0 / tan(fov_rad * 0.5)
		return f / cam.aspect, f, -1.0, -2.0 * near
	else
		-- Standard perspective (default for any unrecognised type).
		local f<const>  = 1.0 / tan(fov_rad * 0.5)
		local nf<const> = 1.0 / (near - far)
		return f / cam.aspect, f, (far + near) * nf, 2.0 * far * near * nf
	end
end

-- ── cam_proj_matrix ───────────────────────────────────────────────────────────
-- Returns all 16 P matrix scalars in column-major order for any projection type.
-- Delegates to cartlib/projection.lua — mirrors Camera.rebuild()'s switch block in TS.
-- Required for orthographic, oblique, isometric, asymmetric_frustum.
-- Also works for perspective-family types.
local cam_proj_matrix<const> = function(cam)
	local fov_rad<const> = cam.fov_deg * (pi / 180.0)
	local proj<const>    = cam.proj
	if proj == 'orthographic' then
		return projection.proj_orthographic(
			cam.ortho_l, cam.ortho_r, cam.ortho_b, cam.ortho_t, cam.near, cam.far)
	elseif proj == 'oblique' then
		return projection.proj_oblique(
			cam.ortho_l, cam.ortho_r, cam.ortho_b, cam.ortho_t,
			cam.near, cam.far, cam.alpha_rad, cam.beta_rad)
	elseif proj == 'isometric' then
		return projection.proj_isometric(cam.iso_scale)
	elseif proj == 'asymmetric_frustum' then
		local hw<const> = cam.aspect
		return projection.proj_asymmetric_frustum(-hw, hw, -1.0, 1.0, cam.near, cam.far)
	elseif proj == 'fisheye' then
		return projection.proj_fisheye(fov_rad, cam.near, cam.far)
	elseif proj == 'panorama' then
		return projection.proj_panorama(fov_rad, cam.aspect, cam.near, cam.far)
	elseif proj == 'infinite_perspective' then
		return projection.proj_infinite_perspective(fov_rad, cam.aspect, cam.near)
	else
		return projection.proj_perspective(fov_rad, cam.aspect, cam.near, cam.far)
	end
end

return {
	cam_new         = cam_new,
	cam_set_proj    = cam_set_proj,
	cam_set_fov     = cam_set_fov,
	cam_set_clip    = cam_set_clip,
	cam_set_aspect  = cam_set_aspect,
	cam_look_at     = cam_look_at,
	cam_screen_look = cam_screen_look,
	cam_flight_look = cam_flight_look,
	cam_move        = cam_move,
	cam_view_terms  = cam_view_terms,
	cam_proj_terms  = cam_proj_terms,
	cam_proj_matrix = cam_proj_matrix,
}
