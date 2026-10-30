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
