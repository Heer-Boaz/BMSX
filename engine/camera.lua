-- camera.lua
-- Complete Lua port of math3d.ts (Q namespace) + camera3d.ts.
-- All operations use flat scalar components — no tables, no allocations.
-- Quaternion component order throughout: qx, qy, qz, qw  (xyzw).

-- ── q_mul ─────────────────────────────────────────────────────────────────────
-- Quaternion multiply: a * b.  Matches Q.mul() in math3d.ts.
local q_mul<const> = function(ax, ay, az, aw, bx, by, bz, bw)
	return aw*bx + ax*bw + ay*bz - az*by,
	       aw*by - ax*bz + ay*bw + az*bx,
	       aw*bz + ax*by - ay*bx + az*bw,
	       aw*bw - ax*bx - ay*by - az*bz
end

-- ── q_norm ────────────────────────────────────────────────────────────────────
-- Normalise a quaternion to unit length.  Matches Q.norm() in math3d.ts.
local q_norm<const> = function(qx, qy, qz, qw)
	local inv<const> = 1.0 / math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw)
	return qx*inv, qy*inv, qz*inv, qw*inv
end

-- ── q_ident ───────────────────────────────────────────────────────────────────
-- Identity quaternion (no rotation).  Matches Q.ident() in math3d.ts.
local q_ident<const> = function()
	return 0.0, 0.0, 0.0, 1.0
end

-- ── q_axis_angle ──────────────────────────────────────────────────────────────
-- Rotation quaternion from a unit axis vector and an angle (radians).
-- Axis must already be normalised; angle*0.5 is computed once.
-- Matches Q.fromAxisAngle() in math3d.ts.
local q_axis_angle<const> = function(ax, ay, az, angle)
	local h<const> = angle * 0.5
	local s<const> = math.sin(h)
	return ax*s, ay*s, az*s, math.cos(h)
end

-- ── q_from_euler ──────────────────────────────────────────────────────────────
-- XYZ intrinsic Euler angles (radians) → unit quaternion.
-- Composition order: rotateX, then Y, then Z (= qz*qy*qx).
-- Matches Q.fromEuler() in math3d.ts.
local q_from_euler<const> = function(ex, ey, ez)
	local cx<const> = math.cos(ex * 0.5);  local sx<const> = math.sin(ex * 0.5)
	local cy<const> = math.cos(ey * 0.5);  local sy<const> = math.sin(ey * 0.5)
	local cz<const> = math.cos(ez * 0.5);  local sz<const> = math.sin(ez * 0.5)
	return cz*cy*sx - sz*sy*cx,
	       cz*sy*cx + sz*cy*sx,
	       sz*cy*cx - cz*sy*sx,
	       cz*cy*cx + sz*sy*sx
end

-- ── q_to_euler ────────────────────────────────────────────────────────────────
-- Unit quaternion → XYZ intrinsic Euler angles (radians).
-- Inverse of q_from_euler.  Returns ex, ey, ez.
-- sinp is clamped to [-1,1] to handle gimbal lock without a branch.
-- Matches Q.toEuler() in math3d.ts.
local q_to_euler<const> = function(qx, qy, qz, qw)
	local il<const>   = 1.0 / math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw)
	local nx<const>   = qx*il;  local ny<const> = qy*il
	local nz<const>   = qz*il;  local nw<const> = qw*il
	local sinr<const> = 2.0*(nw*nx + ny*nz)
	local cosr<const> = 1.0 - 2.0*(nx*nx + ny*ny)
	local ex<const>   = math.atan(sinr, cosr)
	local sinp<const> = 2.0*(nw*ny - nz*nx)
	local ey<const>   = math.asin(math.max(-1.0, math.min(1.0, sinp)))
	local siny<const> = 2.0*(nw*nz + nx*ny)
	local cosy<const> = 1.0 - 2.0*(ny*ny + nz*nz)
	local ez<const>   = math.atan(siny, cosy)
	return ex, ey, ez
end

-- ── q_slerp ───────────────────────────────────────────────────────────────────
-- Spherical linear interpolation between two quaternions.  t ∈ [0,1].
-- Falls back to normalised lerp when the quaternions are nearly parallel.
-- Matches Q.slerp() in math3d.ts.
local q_slerp<const> = function(ax, ay, az, aw, bx, by, bz, bw, t)
	local dot = ax*bx + ay*by + az*bz + aw*bw
	if dot < 0.0 then
		bx = -bx;  by = -by;  bz = -bz;  bw = -bw;  dot = -dot
	end
	if dot > 0.9995 then
		return q_norm(ax + (bx-ax)*t, ay + (by-ay)*t, az + (bz-az)*t, aw + (bw-aw)*t)
	end
	local theta<const> = math.acos(math.max(-1.0, math.min(1.0, dot)))
	local st<const>    = math.sin(theta)
	local w1<const>    = math.sin((1.0 - t) * theta) / st
	local w2<const>    = math.sin(t * theta) / st
	return ax*w1 + bx*w2, ay*w1 + by*w2, az*w1 + bz*w2, aw*w1 + bw*w2
end

-- ── q_from_basis ──────────────────────────────────────────────────────────────
-- Build a unit quaternion from a forward direction and an up hint vector.
-- The up vector need not be orthogonal to forward; it is Gram-Schmidt
-- orthogonalised internally.  Uses the Shepperd (trace) method.
-- Matches Q.fromBasis() in math3d.ts.
local q_from_basis<const> = function(fwx, fwy, fwz, upx, upy, upz)
	-- right = up × forward; normalise
	local rx = upy*fwz - upz*fwy
	local ry = upz*fwx - upx*fwz
	local rz = upx*fwy - upy*fwx
	local rlen<const> = math.sqrt(rx*rx + ry*ry + rz*rz)
	if rlen > 1e-8 then
		local ri<const> = 1.0 / rlen
		rx = rx*ri;  ry = ry*ri;  rz = rz*ri
	end
	-- orthogonalised up = forward × right
	local ux<const> = fwy*rz - fwz*ry
	local uy<const> = fwz*rx - fwx*rz
	local uz<const> = fwx*ry - fwy*rx
	-- rotation matrix rows: (right, ort-up, forward); diagonal = rx, uy, fwz
	local tr<const> = rx + uy + fwz
	local qx, qy, qz, qw = 0.0, 0.0, 0.0, 1.0
	if tr > 0.0 then
		local s<const> = math.sqrt(tr + 1.0) * 2.0
		qw = 0.25 * s
		qx = (fwy - uz) / s
		qy = (rz  - fwx) / s
		qz = (ux  - ry ) / s
	elseif rx > uy and rx > fwz then
		local s<const> = math.sqrt(1.0 + rx - uy - fwz) * 2.0
		qw = (fwy - uz) / s
		qx = 0.25 * s
		qy = (ry  + ux) / s
		qz = (rz  + fwx) / s
	elseif uy > fwz then
		local s<const> = math.sqrt(1.0 + uy - rx - fwz) * 2.0
		qw = (rz  - fwx) / s
		qx = (ry  + ux ) / s
		qy = 0.25 * s
		qz = (uz  + fwy) / s
	else
		local s<const> = math.sqrt(1.0 + fwz - rx - uy) * 2.0
		qw = (ux  - ry ) / s
		qx = (rz  + fwx) / s
		qy = (uz  + fwy) / s
		qz = 0.25 * s
	end
	return q_norm(qx, qy, qz, qw)
end

-- ── q_basis ───────────────────────────────────────────────────────────────────
-- Orthonormal basis from a unit quaternion.
-- Returns: rx,ry,rz (right),  ux,uy,uz (up),  fx,fy,fz (forward = −Z axis).
-- Direct quaternion-to-matrix expansion with 9 shared products; no function
-- calls inside.  Matches Q.basis() in math3d.ts.
local q_basis<const> = function(qx, qy, qz, qw)
	local qxx<const> = qx * qx
	local qyy<const> = qy * qy
	local qzz<const> = qz * qz
	local qxy<const> = qx * qy
	local qxz<const> = qx * qz
	local qyz<const> = qy * qz
	local qwx<const> = qw * qx
	local qwy<const> = qw * qy
	local qwz<const> = qw * qz
	return
		1.0 - 2.0*(qyy + qzz),   2.0*(qxy + qwz),          2.0*(qxz - qwy),
		2.0*(qxy - qwz),          1.0 - 2.0*(qxx + qzz),    2.0*(qyz + qwx),
		-(2.0*(qxz + qwy)),       -(2.0*(qyz - qwx)),        -(1.0 - 2.0*(qxx + qyy))
end

-- ── screen_look ───────────────────────────────────────────────────────────────
-- Screen-space look: yaw around camera up, pitch around camera right.
-- Pass the right/up basis vectors already computed via q_basis.
-- Optional droll rotates around the new forward after yaw+pitch; pass 0.0 to
-- skip the roll step entirely.
-- Matches Camera.screenLook() in camera3d.ts (including optional dRoll).
local screen_look<const> = function(qx, qy, qz, qw, rx, ry, rz, ux, uy, uz, dyaw, dpitch, droll)
	local yh<const>  = dyaw   * 0.5
	local ph<const>  = dpitch * 0.5
	local ys<const>  = math.sin(yh);  local yc<const> = math.cos(yh)
	local ps<const>  = math.sin(ph);  local pc<const> = math.cos(ph)
	-- q_new = norm( q_yaw * (q_pitch * q_old) )
	local tx<const>, ty<const>, tz<const>, tw<const> =
		q_mul(rx*ps, ry*ps, rz*ps, pc,  qx, qy, qz, qw)
	local nx<const>, ny<const>, nz<const>, nw<const> =
		q_mul(ux*ys, uy*ys, uz*ys, yc,  tx, ty, tz, tw)
	local rnx<const>, rny<const>, rnz<const>, rnw<const> = q_norm(nx, ny, nz, nw)
	if droll == 0.0 then
		return rnx, rny, rnz, rnw
	end
	-- roll around new forward axis (forward = −Z rotated by updated q)
	local rh<const>  = droll * 0.5
	local rs<const>  = math.sin(rh);  local rc<const> = math.cos(rh)
	local ffx<const> = -(2.0*(rnx*rnz + rnw*rny))
	local ffy<const> = -(2.0*(rny*rnz - rnw*rnx))
	local ffz<const> = -(1.0 - 2.0*(rnx*rnx + rny*rny))
	local ox<const>, oy<const>, oz<const>, ow<const> =
		q_mul(ffx*rs, ffy*rs, ffz*rs, rc,  rnx, rny, rnz, rnw)
	return q_norm(ox, oy, oz, ow)
end

-- ── flight_look ───────────────────────────────────────────────────────────────
-- Flight-sim look: sequential rotations on the CURRENT (updated) body axes.
-- Order: roll (forward), then pitch (new right), then yaw (new up).
-- Each step derives only the single axis it needs, inline, to avoid computing
-- the full 9-component basis three times.
-- Matches Camera.flightLook() in camera3d.ts.
local flight_look<const> = function(qx, qy, qz, qw, dyaw, dpitch, droll)
	-- 1) roll around current forward  (−Z rotated by q)
	if droll ~= 0.0 then
		local ffx<const> = -(2.0*(qx*qz + qw*qy))
		local ffy<const> = -(2.0*(qy*qz - qw*qx))
		local ffz<const> = -(1.0 - 2.0*(qx*qx + qy*qy))
		local rh<const>  = droll * 0.5
		local rs<const>  = math.sin(rh);  local rc<const> = math.cos(rh)
		local tx<const>, ty<const>, tz<const>, tw<const> =
			q_mul(ffx*rs, ffy*rs, ffz*rs, rc,  qx, qy, qz, qw)
		qx, qy, qz, qw = q_norm(tx, ty, tz, tw)
	end
	-- 2) pitch around NEW right axis  (+X rotated by updated q)
	if dpitch ~= 0.0 then
		local prx<const> = 1.0 - 2.0*(qy*qy + qz*qz)
		local pry<const> = 2.0*(qx*qy + qw*qz)
		local prz<const> = 2.0*(qx*qz - qw*qy)
		local ph<const>  = dpitch * 0.5
		local ps<const>  = math.sin(ph);  local pc<const> = math.cos(ph)
		local tx<const>, ty<const>, tz<const>, tw<const> =
			q_mul(prx*ps, pry*ps, prz*ps, pc,  qx, qy, qz, qw)
		qx, qy, qz, qw = q_norm(tx, ty, tz, tw)
	end
	-- 3) yaw around NEW up axis  (+Y rotated by updated q)
	if dyaw ~= 0.0 then
		local yux<const> = 2.0*(qx*qy - qw*qz)
		local yuy<const> = 1.0 - 2.0*(qx*qx + qz*qz)
		local yuz<const> = 2.0*(qy*qz + qw*qx)
		local yh<const>  = dyaw * 0.5
		local ys<const>  = math.sin(yh);  local yc<const> = math.cos(yh)
		local tx<const>, ty<const>, tz<const>, tw<const> =
			q_mul(yux*ys, yuy*ys, yuz*ys, yc,  qx, qy, qz, qw)
		qx, qy, qz, qw = q_norm(tx, ty, tz, tw)
	end
	return qx, qy, qz, qw
end

-- ── q_look_at ─────────────────────────────────────────────────────────────────
-- Orient to face a world-space target from a given eye position.
-- upx,upy,upz is the preferred world-up vector (e.g. 0,1,0).
-- Returns identity quaternion when eye == target.
-- Combines Camera.lookAt() + Q.fromBasis() from camera3d.ts.
local q_look_at<const> = function(px, py, pz, tx, ty, tz, upx, upy, upz)
	local dx<const>   = tx - px
	local dy<const>   = ty - py
	local dz<const>   = tz - pz
	local dlen<const> = math.sqrt(dx*dx + dy*dy + dz*dz)
	if dlen < 1e-8 then
		return 0.0, 0.0, 0.0, 1.0
	end
	local di<const> = 1.0 / dlen
	return q_from_basis(dx*di, dy*di, dz*di, upx, upy, upz)
end

return {
	q_ident      = q_ident,
	q_mul        = q_mul,
	q_norm       = q_norm,
	q_axis_angle = q_axis_angle,
	q_from_euler = q_from_euler,
	q_to_euler   = q_to_euler,
	q_slerp      = q_slerp,
	q_from_basis = q_from_basis,
	q_basis      = q_basis,
	screen_look  = screen_look,
	flight_look  = flight_look,
	q_look_at    = q_look_at,
}
