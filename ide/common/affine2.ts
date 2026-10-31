/** Column-major Number affine; no renderer/register narrowing in host geometry. */
export type Affine2 = { xx: number; xy: number; yx: number; yy: number; ox: number; oy: number };

/** Local axis scale and angular skew precede translation. */
export function affine2FromPose(ox: number, oy: number, rotation: number, sx: number, sy: number, skew: number): Affine2 {
	const cosine = Math.cos(rotation), sine = Math.sin(rotation);
	if (skew === 0) return { xx: cosine * sx, xy: sine * sx, yx: -sine * sy, yy: cosine * sy, ox, oy };
	return { xx: cosine * sx, xy: sine * sx, yx: -Math.sin(rotation + skew) * sy, yy: Math.cos(rotation + skew) * sy, ox, oy };
}

export function affine2Scale(source: Readonly<Affine2>): readonly [number, number] {
	return [Math.sqrt(source.xx * source.xx + source.xy * source.xy), Math.sqrt(source.yx * source.yx + source.yy * source.yy) * (source.xx * source.yy - source.yx * source.xy < 0 ? -1 : 1)];
}

export function affine2Rotation(source: Readonly<Affine2>): number | undefined {
	return source.xx * source.xx + source.xy * source.xy === 0 ? undefined : Math.atan2(source.xy, source.xx);
}

export function affine2Skew(source: Readonly<Affine2>): number | undefined {
	if (source.xx * source.xx + source.xy * source.xy === 0 || source.yx * source.yx + source.yy * source.yy === 0) return;
	let determinant = source.xx * source.yy - source.yx * source.xy;
	let dot = source.xx * source.yx + source.xy * source.yy;
	if (determinant < 0) { determinant = -determinant; dot = -dot; }
	return Math.atan2(determinant, dot) - Math.PI / 2;
}

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
