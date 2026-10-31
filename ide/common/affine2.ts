/** Column-major Number affine; no renderer/register narrowing in host geometry. */
export type Affine2 = { xx: number; xy: number; yx: number; yy: number; ox: number; oy: number };

/** Append a local frame in place, including when the destination is its input. */
export function appendAffine2(destination: Affine2, xx: number, xy: number, yx: number, yy: number, ox: number, oy: number): void {
	const axx = destination.xx, axy = destination.xy, ayx = destination.yx, ayy = destination.yy;
	const aox = destination.ox, aoy = destination.oy;
	destination.xx = axx * xx + ayx * xy;
	destination.xy = axy * xx + ayy * xy;
	destination.yx = axx * yx + ayx * yy;
	destination.yy = axy * yx + ayy * yy;
	destination.ox = axx * ox + ayx * oy + aox;
	destination.oy = axy * ox + ayy * oy + aoy;
}

/** Re-express a complete world affine under a parent, matching guest from_world.
 * A singular parent rejects before writes; the child may itself be singular. */
export function relativeAffine2(destination: Affine2, world: Readonly<Affine2>, parent: Readonly<Affine2>): boolean {
	const pxx = parent.xx, pxy = parent.xy, pyx = parent.yx, pyy = parent.yy;
	const determinant = pxx * pyy - pyx * pxy;
	if (determinant === 0) return false;
	const reciprocal = 1 / determinant;
	const ixx = pyy * reciprocal, ixy = -pxy * reciprocal, iyx = -pyx * reciprocal, iyy = pxx * reciprocal;
	const xx = world.xx, xy = world.xy, yx = world.yx, yy = world.yy;
	const ox = world.ox - parent.ox, oy = world.oy - parent.oy;
	destination.xx = ixx * xx + iyx * xy;
	destination.xy = ixy * xx + iyy * xy;
	destination.yx = ixx * yx + iyx * yy;
	destination.yy = ixy * yx + iyy * yy;
	destination.ox = ixx * ox + iyx * oy;
	destination.oy = ixy * ox + iyy * oy;
	return true;
}
