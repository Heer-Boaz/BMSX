-- Column-major local basis/origin and retained world basis/origin share one
-- spatial record. These kernels write coefficients only; the hierarchy owns
-- dirty propagation, revisions and structural links.
local affine3<const> = { identity = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 } }

function affine3.evaluate(node, parent, basis_changed, origin_changed)
	if parent == nil then
		if basis_changed then
			node.wxx = node.xx
			node.wxy = node.xy
			node.wxz = node.xz
			node.wyx = node.yx
			node.wyy = node.yy
			node.wyz = node.yz
			node.wzx = node.zx
			node.wzy = node.zy
			node.wzz = node.zz
		end
		if origin_changed then
			node.wox = node.ox
			node.woy = node.oy
			node.woz = node.oz
		end
		return
	end

	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pxz<const> = parent.wxz
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	local pyz<const> = parent.wyz
	local pzx<const> = parent.wzx
	local pzy<const> = parent.wzy
	local pzz<const> = parent.wzz
	if basis_changed then
		local xx<const> = node.xx
		local xy<const> = node.xy
		local xz<const> = node.xz
		local yx<const> = node.yx
		local yy<const> = node.yy
		local yz<const> = node.yz
		local zx<const> = node.zx
		local zy<const> = node.zy
		local zz<const> = node.zz
		node.wxx = pxx * xx + pyx * xy + pzx * xz
		node.wxy = pxy * xx + pyy * xy + pzy * xz
		node.wxz = pxz * xx + pyz * xy + pzz * xz
		node.wyx = pxx * yx + pyx * yy + pzx * yz
		node.wyy = pxy * yx + pyy * yy + pzy * yz
		node.wyz = pxz * yx + pyz * yy + pzz * yz
		node.wzx = pxx * zx + pyx * zy + pzx * zz
		node.wzy = pxy * zx + pyy * zy + pzy * zz
		node.wzz = pxz * zx + pyz * zy + pzz * zz
	end
	if origin_changed then
		local ox<const> = node.ox
		local oy<const> = node.oy
		local oz<const> = node.oz
		node.wox = pxx * ox + pyx * oy + pzx * oz + parent.wox
		node.woy = pxy * ox + pyy * oy + pzy * oz + parent.woy
		node.woz = pxz * ox + pyz * oy + pzz * oz + parent.woz
	end
end

-- Compute the new local affine before the hierarchy changes the parent link.
-- A singular child remains representable; only the parent needs an inverse.
function affine3.relative_world(node, parent)
	if parent == nil then
		node.xx = node.wxx
		node.xy = node.wxy
		node.xz = node.wxz
		node.yx = node.wyx
		node.yy = node.wyy
		node.yz = node.wyz
		node.zx = node.wzx
		node.zy = node.wzy
		node.zz = node.wzz
		node.ox = node.wox
		node.oy = node.woy
		node.oz = node.woz
		return true
	end

	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pxz<const> = parent.wxz
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	local pyz<const> = parent.wyz
	local pzx<const> = parent.wzx
	local pzy<const> = parent.wzy
	local pzz<const> = parent.wzz
	local cxx<const> = pyy * pzz - pzy * pyz
	local cxy<const> = pzy * pxz - pxy * pzz
	local cxz<const> = pxy * pyz - pyy * pxz
	local determinant<const> = pxx * cxx + pyx * cxy + pzx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local ixx<const> = cxx * reciprocal
	local ixy<const> = cxy * reciprocal
	local ixz<const> = cxz * reciprocal
	local iyx<const> = (pzx * pyz - pyx * pzz) * reciprocal
	local iyy<const> = (pxx * pzz - pzx * pxz) * reciprocal
	local iyz<const> = (pyx * pxz - pxx * pyz) * reciprocal
	local izx<const> = (pyx * pzy - pzx * pyy) * reciprocal
	local izy<const> = (pzx * pxy - pxx * pzy) * reciprocal
	local izz<const> = (pxx * pyy - pyx * pxy) * reciprocal
	local xx<const> = node.wxx
	local xy<const> = node.wxy
	local xz<const> = node.wxz
	local yx<const> = node.wyx
	local yy<const> = node.wyy
	local yz<const> = node.wyz
	local zx<const> = node.wzx
	local zy<const> = node.wzy
	local zz<const> = node.wzz
	local ox<const> = node.wox - parent.wox
	local oy<const> = node.woy - parent.woy
	local oz<const> = node.woz - parent.woz
	node.xx = ixx * xx + iyx * xy + izx * xz
	node.xy = ixy * xx + iyy * xy + izy * xz
	node.xz = ixz * xx + iyz * xy + izz * xz
	node.yx = ixx * yx + iyx * yy + izx * yz
	node.yy = ixy * yx + iyy * yy + izy * yz
	node.yz = ixz * yx + iyz * yy + izz * yz
	node.zx = ixx * zx + iyx * zy + izx * zz
	node.zy = ixy * zx + iyy * zy + izy * zz
	node.zz = ixz * zx + iyz * zy + izz * zz
	node.ox = ixx * ox + iyx * oy + izx * oz
	node.oy = ixy * ox + iyy * oy + izy * oz
	node.oz = ixz * ox + iyz * oy + izz * oz
	return true
end

function affine3.origin_from_world(node, parent, x, y, z)
	if parent == nil then
		node.ox = x
		node.oy = y
		node.oz = z
		return true
	end

	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pxz<const> = parent.wxz
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	local pyz<const> = parent.wyz
	local pzx<const> = parent.wzx
	local pzy<const> = parent.wzy
	local pzz<const> = parent.wzz
	local cxx<const> = pyy * pzz - pzy * pyz
	local cxy<const> = pzy * pxz - pxy * pzz
	local cxz<const> = pxy * pyz - pyy * pxz
	local determinant<const> = pxx * cxx + pyx * cxy + pzx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local ixx<const> = cxx * reciprocal
	local ixy<const> = cxy * reciprocal
	local ixz<const> = cxz * reciprocal
	local iyx<const> = (pzx * pyz - pyx * pzz) * reciprocal
	local iyy<const> = (pxx * pzz - pzx * pxz) * reciprocal
	local iyz<const> = (pyx * pxz - pxx * pyz) * reciprocal
	local izx<const> = (pyx * pzy - pzx * pyy) * reciprocal
	local izy<const> = (pzx * pxy - pxx * pzy) * reciprocal
	local izz<const> = (pxx * pyy - pyx * pxy) * reciprocal
	local dx<const> = x - parent.wox
	local dy<const> = y - parent.woy
	local dz<const> = z - parent.woz
	node.ox = ixx * dx + iyx * dy + izx * dz
	node.oy = ixy * dx + iyy * dy + izy * dz
	node.oz = ixz * dx + iyz * dy + izz * dz
	return true
end

function affine3.from_world(node, parent, xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	if parent == nil then
		node.xx = xx
		node.xy = xy
		node.xz = xz
		node.yx = yx
		node.yy = yy
		node.yz = yz
		node.zx = zx
		node.zy = zy
		node.zz = zz
		node.ox = ox
		node.oy = oy
		node.oz = oz
		return true
	end
	local pxx<const>, pxy<const>, pxz<const> = parent.wxx, parent.wxy, parent.wxz
	local pyx<const>, pyy<const>, pyz<const> = parent.wyx, parent.wyy, parent.wyz
	local pzx<const>, pzy<const>, pzz<const> = parent.wzx, parent.wzy, parent.wzz
	local cxx<const> = pyy * pzz - pzy * pyz
	local cxy<const> = pzy * pxz - pxy * pzz
	local cxz<const> = pxy * pyz - pyy * pxz
	local determinant<const> = pxx * cxx + pyx * cxy + pzx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local ixx<const>, ixy<const>, ixz<const> = cxx * reciprocal, cxy * reciprocal, cxz * reciprocal
	local iyx<const> = (pzx * pyz - pyx * pzz) * reciprocal
	local iyy<const> = (pxx * pzz - pzx * pxz) * reciprocal
	local iyz<const> = (pyx * pxz - pxx * pyz) * reciprocal
	local izx<const> = (pyx * pzy - pzx * pyy) * reciprocal
	local izy<const> = (pzx * pxy - pxx * pzy) * reciprocal
	local izz<const> = (pxx * pyy - pyx * pxy) * reciprocal
	local dx<const>, dy<const>, dz<const> = ox - parent.wox, oy - parent.woy, oz - parent.woz
	node.xx = ixx * xx + iyx * xy + izx * xz
	node.xy = ixy * xx + iyy * xy + izy * xz
	node.xz = ixz * xx + iyz * xy + izz * xz
	node.yx = ixx * yx + iyx * yy + izx * yz
	node.yy = ixy * yx + iyy * yy + izy * yz
	node.yz = ixz * yx + iyz * yy + izz * yz
	node.zx = ixx * zx + iyx * zy + izx * zz
	node.zy = ixy * zx + iyy * zy + izy * zz
	node.zz = ixz * zx + iyz * zy + izz * zz
	node.ox = ixx * dx + iyx * dy + izx * dz
	node.oy = ixy * dx + iyy * dy + izy * dz
	node.oz = ixz * dx + iyz * dy + izz * dz
	return true
end

function affine3.compose(destination, left, right)
	local axx<const>, axy<const>, axz<const> = left.xx, left.xy, left.xz
	local ayx<const>, ayy<const>, ayz<const> = left.yx, left.yy, left.yz
	local azx<const>, azy<const>, azz<const> = left.zx, left.zy, left.zz
	local aox<const>, aoy<const>, aoz<const> = left.ox, left.oy, left.oz
	local bxx<const>, bxy<const>, bxz<const> = right.xx, right.xy, right.xz
	local byx<const>, byy<const>, byz<const> = right.yx, right.yy, right.yz
	local bzx<const>, bzy<const>, bzz<const> = right.zx, right.zy, right.zz
	local box<const>, boy<const>, boz<const> = right.ox, right.oy, right.oz
	destination.xx = axx * bxx + ayx * bxy + azx * bxz
	destination.xy = axy * bxx + ayy * bxy + azy * bxz
	destination.xz = axz * bxx + ayz * bxy + azz * bxz
	destination.yx = axx * byx + ayx * byy + azx * byz
	destination.yy = axy * byx + ayy * byy + azy * byz
	destination.yz = axz * byx + ayz * byy + azz * byz
	destination.zx = axx * bzx + ayx * bzy + azx * bzz
	destination.zy = axy * bzx + ayy * bzy + azy * bzz
	destination.zz = axz * bzx + ayz * bzy + azz * bzz
	destination.ox = axx * box + ayx * boy + azx * boz + aox
	destination.oy = axy * box + ayy * boy + azy * boz + aoy
	destination.oz = axz * box + ayz * boy + azz * boz + aoz
end

function affine3.inverse(destination, source)
	local xx<const>, xy<const>, xz<const> = source.xx, source.xy, source.xz
	local yx<const>, yy<const>, yz<const> = source.yx, source.yy, source.yz
	local zx<const>, zy<const>, zz<const> = source.zx, source.zy, source.zz
	local ox<const>, oy<const>, oz<const> = source.ox, source.oy, source.oz
	local cxx<const> = yy * zz - zy * yz
	local cxy<const> = zy * xz - xy * zz
	local cxz<const> = xy * yz - yy * xz
	local determinant<const> = xx * cxx + yx * cxy + zx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local ixx<const>, ixy<const>, ixz<const> = cxx * reciprocal, cxy * reciprocal, cxz * reciprocal
	local iyx<const> = (zx * yz - yx * zz) * reciprocal
	local iyy<const> = (xx * zz - zx * xz) * reciprocal
	local iyz<const> = (yx * xz - xx * yz) * reciprocal
	local izx<const> = (yx * zy - zx * yy) * reciprocal
	local izy<const> = (zx * xy - xx * zy) * reciprocal
	local izz<const> = (xx * yy - yx * xy) * reciprocal
	destination.xx = ixx
	destination.xy = ixy
	destination.xz = ixz
	destination.yx = iyx
	destination.yy = iyy
	destination.yz = iyz
	destination.zx = izx
	destination.zy = izy
	destination.zz = izz
	destination.ox = -(ixx * ox + iyx * oy + izx * oz)
	destination.oy = -(ixy * ox + iyy * oy + izy * oz)
	destination.oz = -(ixz * ox + iyz * oy + izz * oz)
	return true
end

-- Column-major T * R * S; quaternion operands are x, y, z, w. The authored
-- rotation is a unit quaternion, as in Bevy's scale/rotation/translation
-- affine constructor. No decomposition or quaternion repair is performed.
-- https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/transform.rs
function affine3.trs(ox, oy, oz, qx, qy, qz, qw, scale_x, scale_y, scale_z)
	local x2<const>, y2<const>, z2<const> = qx + qx, qy + qy, qz + qz
	local xx<const>, xy<const>, xz<const> = qx * x2, qx * y2, qx * z2
	local yy<const>, yz<const>, zz<const> = qy * y2, qy * z2, qz * z2
	local wx<const>, wy<const>, wz<const> = qw * x2, qw * y2, qw * z2
	return (1 - (yy + zz)) * scale_x, (xy + wz) * scale_x, (xz - wy) * scale_x,
		(xy - wz) * scale_y, (1 - (xx + zz)) * scale_y, (yz + wx) * scale_y,
		(xz + wy) * scale_z, (yz - wx) * scale_z, (1 - (xx + yy)) * scale_z,
		ox, oy, oz
end

function affine3.transform_point(node, x, y, z)
	return node.wxx * x + node.wyx * y + node.wzx * z + node.wox,
		node.wxy * x + node.wyy * y + node.wzy * z + node.woy,
		node.wxz * x + node.wyz * y + node.wzz * z + node.woz
end

function affine3.transform_vector(node, x, y, z)
	return node.wxx * x + node.wyx * y + node.wzx * z,
		node.wxy * x + node.wyy * y + node.wzy * z,
		node.wxz * x + node.wyz * y + node.wzz * z
end

function affine3.inverse_transform_point(node, x, y, z)
	local xx<const>, xy<const>, xz<const> = node.wxx, node.wxy, node.wxz
	local yx<const>, yy<const>, yz<const> = node.wyx, node.wyy, node.wyz
	local zx<const>, zy<const>, zz<const> = node.wzx, node.wzy, node.wzz
	local cxx<const> = yy * zz - zy * yz
	local cxy<const> = zy * xz - xy * zz
	local cxz<const> = xy * yz - yy * xz
	local determinant<const> = xx * cxx + yx * cxy + zx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local dx<const>, dy<const>, dz<const> = x - node.wox, y - node.woy, z - node.woz
	return true,
		(cxx * dx + (zx * yz - yx * zz) * dy + (yx * zy - zx * yy) * dz) * reciprocal,
		(cxy * dx + (xx * zz - zx * xz) * dy + (zx * xy - xx * zy) * dz) * reciprocal,
		(cxz * dx + (yx * xz - xx * yz) * dy + (xx * yy - yx * xy) * dz) * reciprocal
end

function affine3.inverse_transform_vector(node, x, y, z)
	local xx<const>, xy<const>, xz<const> = node.wxx, node.wxy, node.wxz
	local yx<const>, yy<const>, yz<const> = node.wyx, node.wyy, node.wyz
	local zx<const>, zy<const>, zz<const> = node.wzx, node.wzy, node.wzz
	local cxx<const> = yy * zz - zy * yz
	local cxy<const> = zy * xz - xy * zz
	local cxz<const> = xy * yz - yy * xz
	local determinant<const> = xx * cxx + yx * cxy + zx * cxz
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	return true,
		(cxx * x + (zx * yz - yx * zz) * y + (yx * zy - zx * yy) * z) * reciprocal,
		(cxy * x + (xx * zz - zx * xz) * y + (zx * xy - xx * zy) * z) * reciprocal,
		(cxz * x + (yx * xz - xx * yz) * y + (xx * yy - yx * xy) * z) * reciprocal
end

return affine3
