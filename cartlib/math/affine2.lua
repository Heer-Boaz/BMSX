-- Column-major local and cached-world affine arithmetic. The caller owns
-- identity, dirty propagation and revisions; these kernels allocate nothing.
local affine2<const> = {}

function affine2.evaluate(node, parent, basis_changed, origin_changed)
	if parent == nil then
		if basis_changed then
			node.wxx = node.xx
			node.wxy = node.xy
			node.wyx = node.yx
			node.wyy = node.yy
		end
		if origin_changed then
			node.wox = node.ox
			node.woy = node.oy
		end
		return
	end
	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	if basis_changed then
		local xx<const> = node.xx
		local xy<const> = node.xy
		local yx<const> = node.yx
		local yy<const> = node.yy
		node.wxx = pxx * xx + pyx * xy
		node.wxy = pxy * xx + pyy * xy
		node.wyx = pxx * yx + pyx * yy
		node.wyy = pxy * yx + pyy * yy
	end
	if origin_changed then
		local ox<const> = node.ox
		local oy<const> = node.oy
		node.wox = pxx * ox + pyx * oy + parent.wox
		node.woy = pxy * ox + pyy * oy + parent.woy
	end
end

-- Re-express the current world pose under a proposed parent. Only the new
-- parent's basis is inverted; a singular child remains representable.
function affine2.relative_world(node, parent)
	local xx<const> = node.wxx
	local xy<const> = node.wxy
	local yx<const> = node.wyx
	local yy<const> = node.wyy
	local ox<const> = node.wox
	local oy<const> = node.woy
	if parent == nil then
		node.xx = xx
		node.xy = xy
		node.yx = yx
		node.yy = yy
		node.ox = ox
		node.oy = oy
		return true
	end
	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	local determinant<const> = pxx * pyy - pyx * pxy
	if determinant == 0 then
		return false
	end
	local inverse<const> = 1 / determinant
	local ixx<const> = pyy * inverse
	local ixy<const> = -pxy * inverse
	local iyx<const> = -pyx * inverse
	local iyy<const> = pxx * inverse
	local dx<const> = ox - parent.wox
	local dy<const> = oy - parent.woy
	node.xx = ixx * xx + iyx * xy
	node.xy = ixy * xx + iyy * xy
	node.yx = ixx * yx + iyx * yy
	node.yy = ixy * yx + iyy * yy
	node.ox = ixx * dx + iyx * dy
	node.oy = ixy * dx + iyy * dy
	return true
end

function affine2.origin_from_world(node, parent, x, y)
	if parent == nil then
		node.ox = x
		node.oy = y
		return true
	end
	local pxx<const> = parent.wxx
	local pxy<const> = parent.wxy
	local pyx<const> = parent.wyx
	local pyy<const> = parent.wyy
	local determinant<const> = pxx * pyy - pyx * pxy
	if determinant == 0 then
		return false
	end
	local inverse<const> = 1 / determinant
	local dx<const> = x - parent.wox
	local dy<const> = y - parent.woy
	node.ox = (pyy * dx - pyx * dy) * inverse
	node.oy = (pxx * dy - pxy * dx) * inverse
	return true
end

return affine2
