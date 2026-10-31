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
