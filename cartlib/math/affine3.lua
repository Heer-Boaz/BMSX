-- Column-major local basis/origin and retained world basis/origin share one
-- spatial record. These kernels write coefficients only; the hierarchy owns
-- dirty propagation, revisions and structural links.
local affine3<const> = {}

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

return affine3
