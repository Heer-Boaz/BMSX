/** Column-major Number affine; asset/device encodings belong to their producers. */
export type Affine3 = {
	xx: number; xy: number; xz: number; yx: number; yy: number; yz: number;
	zx: number; zy: number; zz: number; ox: number; oy: number; oz: number;
};

/** Append a complete local frame in place, with the guest affine3 operation order. */
export function appendAffine3(destination: Affine3, local: Readonly<Affine3>): void {
	const axx = destination.xx, axy = destination.xy, axz = destination.xz;
	const ayx = destination.yx, ayy = destination.yy, ayz = destination.yz;
	const azx = destination.zx, azy = destination.zy, azz = destination.zz;
	const aox = destination.ox, aoy = destination.oy, aoz = destination.oz;
	const xx = local.xx, xy = local.xy, xz = local.xz, yx = local.yx, yy = local.yy, yz = local.yz;
	const zx = local.zx, zy = local.zy, zz = local.zz, ox = local.ox, oy = local.oy, oz = local.oz;
	destination.xx = axx * xx + ayx * xy + azx * xz;
	destination.xy = axy * xx + ayy * xy + azy * xz;
	destination.xz = axz * xx + ayz * xy + azz * xz;
	destination.yx = axx * yx + ayx * yy + azx * yz;
	destination.yy = axy * yx + ayy * yy + azy * yz;
	destination.yz = axz * yx + ayz * yy + azz * yz;
	destination.zx = axx * zx + ayx * zy + azx * zz;
	destination.zy = axy * zx + ayy * zy + azy * zz;
	destination.zz = axz * zx + ayz * zy + azz * zz;
	destination.ox = axx * ox + ayx * oy + azx * oz + aox;
	destination.oy = axy * ox + ayy * oy + azy * oz + aoy;
	destination.oz = axz * ox + ayz * oy + azz * oz + aoz;
}

/** Parent-space solve with the same inverse and subtraction order as guest affine3. */
export function relativeAffine3(destination: Affine3, world: Readonly<Affine3>, parent: Readonly<Affine3>): boolean {
	const pxx = parent.xx, pxy = parent.xy, pxz = parent.xz;
	const pyx = parent.yx, pyy = parent.yy, pyz = parent.yz;
	const pzx = parent.zx, pzy = parent.zy, pzz = parent.zz;
	const cxx = pyy * pzz - pzy * pyz, cxy = pzy * pxz - pxy * pzz, cxz = pxy * pyz - pyy * pxz;
	const determinant = pxx * cxx + pyx * cxy + pzx * cxz;
	if (determinant === 0) return false;
	const reciprocal = 1 / determinant;
	const ixx = cxx * reciprocal, ixy = cxy * reciprocal, ixz = cxz * reciprocal;
	const iyx = (pzx * pyz - pyx * pzz) * reciprocal, iyy = (pxx * pzz - pzx * pxz) * reciprocal, iyz = (pyx * pxz - pxx * pyz) * reciprocal;
	const izx = (pyx * pzy - pzx * pyy) * reciprocal, izy = (pzx * pxy - pxx * pzy) * reciprocal, izz = (pxx * pyy - pyx * pxy) * reciprocal;
	const xx = world.xx, xy = world.xy, xz = world.xz, yx = world.yx, yy = world.yy, yz = world.yz;
	const zx = world.zx, zy = world.zy, zz = world.zz;
	const ox = world.ox - parent.ox, oy = world.oy - parent.oy, oz = world.oz - parent.oz;
	destination.xx = ixx * xx + iyx * xy + izx * xz;
	destination.xy = ixy * xx + iyy * xy + izy * xz;
	destination.xz = ixz * xx + iyz * xy + izz * xz;
	destination.yx = ixx * yx + iyx * yy + izx * yz;
	destination.yy = ixy * yx + iyy * yy + izy * yz;
	destination.yz = ixz * yx + iyz * yy + izz * yz;
	destination.zx = ixx * zx + iyx * zy + izx * zz;
	destination.zy = ixy * zx + iyy * zy + izy * zz;
	destination.zz = ixz * zx + iyz * zy + izz * zz;
	destination.ox = ixx * ox + iyx * oy + izx * oz;
	destination.oy = ixy * ox + iyy * oy + izy * oz;
	destination.oz = ixz * ox + iyz * oy + izz * oz;
	return true;
}
