-- Column-major local and cached-world affine arithmetic. The caller owns
-- identity, dirty propagation and revisions; these kernels allocate nothing.
local affine2<const> = { identity = { 1, 0, 0, 1, 0, 0 } }

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

function affine2.from_world(node, parent, xx, xy, yx, yy, ox, oy)
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
	local reciprocal<const> = 1 / determinant
	local ixx<const> = pyy * reciprocal
	local ixy<const> = -pxy * reciprocal
	local iyx<const> = -pyx * reciprocal
	local iyy<const> = pxx * reciprocal
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

-- Full local affine arithmetic uses retained named-field destinations. All
-- source operands are loaded before writes, so destination aliasing is valid.
function affine2.compose(destination, left, right)
	local axx<const>, axy<const>, ayx<const>, ayy<const> = left.xx, left.xy, left.yx, left.yy
	local aox<const>, aoy<const> = left.ox, left.oy
	local bxx<const>, bxy<const>, byx<const>, byy<const> = right.xx, right.xy, right.yx, right.yy
	local box<const>, boy<const> = right.ox, right.oy
	destination.xx = axx * bxx + ayx * bxy
	destination.xy = axy * bxx + ayy * bxy
	destination.yx = axx * byx + ayx * byy
	destination.yy = axy * byx + ayy * byy
	destination.ox = axx * box + ayx * boy + aox
	destination.oy = axy * box + ayy * boy + aoy
end

function affine2.inverse(destination, source)
	local xx<const>, xy<const>, yx<const>, yy<const> = source.xx, source.xy, source.yx, source.yy
	local ox<const>, oy<const> = source.ox, source.oy
	local determinant<const> = xx * yy - yx * xy
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local ixx<const>, ixy<const> = yy * reciprocal, -xy * reciprocal
	local iyx<const>, iyy<const> = -yx * reciprocal, xx * reciprocal
	destination.xx = ixx
	destination.xy = ixy
	destination.yx = iyx
	destination.yy = iyy
	destination.ox = -(ixx * ox + iyx * oy)
	destination.oy = -(ixy * ox + iyy * oy)
	return true
end

-- Returns coefficients in the canonical column order. Rotation is radians;
-- scale acts on the local axes before rotation, and translation acts last.
function affine2.trs(ox, oy, rotation, scale_x, scale_y)
	local cosine<const> = math.cos(rotation)
	local sine<const> = math.sin(rotation)
	return cosine * scale_x, sine * scale_x, -sine * scale_y, cosine * scale_y, ox, oy
end

function affine2.transform_point(node, x, y)
	return node.wxx * x + node.wyx * y + node.wox,
		node.wxy * x + node.wyy * y + node.woy
end

function affine2.transform_vector(node, x, y)
	return node.wxx * x + node.wyx * y, node.wxy * x + node.wyy * y
end

-- Origin-free bounds of an affine rectangle. Geometry consumers retain these
-- offsets while their basis/source is unchanged; translation adds only origin.
-- Project the two source intervals, not four point calls or a temporary array.
function affine2.basis_bounds(xx, xy, yx, yy, left, top, right, bottom)
	local xx0, xx1 = xx * left, xx * right
	local xy0, xy1 = xy * left, xy * right
	local yx0, yx1 = yx * top, yx * bottom
	local yy0, yy1 = yy * top, yy * bottom
	if xx0 > xx1 then xx0, xx1 = xx1, xx0 end
	if xy0 > xy1 then xy0, xy1 = xy1, xy0 end
	if yx0 > yx1 then yx0, yx1 = yx1, yx0 end
	if yy0 > yy1 then yy0, yy1 = yy1, yy0 end
	return xx0 + yx0, xy0 + yy0, xx1 + yx1, xy1 + yy1
end

function affine2.inverse_transform_point(node, x, y)
	local xx<const>, xy<const>, yx<const>, yy<const> = node.wxx, node.wxy, node.wyx, node.wyy
	local determinant<const> = xx * yy - yx * xy
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	local dx<const>, dy<const> = x - node.wox, y - node.woy
	return true, (yy * dx - yx * dy) * reciprocal, (xx * dy - xy * dx) * reciprocal
end

function affine2.inverse_transform_vector(node, x, y)
	local xx<const>, xy<const>, yx<const>, yy<const> = node.wxx, node.wxy, node.wyx, node.wyy
	local determinant<const> = xx * yy - yx * xy
	if determinant == 0 then
		return false
	end
	local reciprocal<const> = 1 / determinant
	return true, (yy * x - yx * y) * reciprocal, (xx * y - xy * x) * reciprocal
end

return affine2
