import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { HostMesh, HostMeshScene } from '../../machine/ts/render/host_overlay/mesh';

/** Unequal vertex depths distinguish affine sampling from perspective correction. */
export function createHostTexturedMeshFixture() {
	const bitmap = new HostBitmap({ width: 4, height: 2, pixels: new Uint8Array([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
		0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
	]) });
	const layerBitmap = new HostBitmap({ width: 2, height: 2, pixels: new Uint8Array([
		0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255,
	]) });
	const instance = (mesh: HostMesh) => ({ mesh, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 });
	const affine = new HostMeshScene(32, 32);
	affine.clipFromOrigin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]);
	const triangle = new HostMesh({ positions: new Float32Array([-1, -1, 1, 4, -4, 4, -1, 1, 1]),
		color: 0xffffffff, doubleSided: true, texture: { bitmap, uvs: new Float32Array([0, 0, 1, 0, 0, 1]) } });
	affine.instances.push(instance(triangle));
	const clipped = new HostMeshScene(32, 32); clipped.clipFromOrigin.set(affine.clipFromOrigin);
	const crossing = new HostMesh({ positions: new Float32Array([-0.5, -0.5, 1, 2, -2, 4, -0.25, 0.25, 0.5]),
		color: 0xffffffff, doubleSided: true, texture: { bitmap, uvs: triangle.texture!.uvs } });
	clipped.instances.push(instance(crossing));
	const gxAffine = new HostMeshScene(32, 32), gxClipped = new HostMeshScene(32, 32);
	gxAffine.clipFromOrigin.set(affine.clipFromOrigin); gxClipped.clipFromOrigin.set(clipped.clipFromOrigin);
	const gxTriangle = new HostMesh({ positions: triangle.positions, gxCommand: 0x24808080, doubleSided: true, texture: triangle.texture });
	const gxCrossing = new HostMesh({ positions: crossing.positions, gxCommand: 0x24808080, doubleSided: true, texture: crossing.texture });
	gxAffine.instances.push(instance(gxTriangle)); gxClipped.instances.push(instance(gxCrossing));
	const layers = new HostMeshScene(32, 32);
	layers.clipFromOrigin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const behind = new HostMesh({ positions: new Float32Array([-1, 0, 0.25, 0, 0, 0.25, -1, 1, 0.25]), color: 0xffffff00, doubleSided: true });
	const overlay = new HostMesh({ positions: new Float32Array([-1, 1, 0.5, 1, 1, 0.5, 1, -1, 0.5, -1, -1, 0.5]),
		indices: new Uint8Array([0, 1, 2, 0, 2, 3]), indexComponentType: 5121, color: 0xffffffff, doubleSided: true, layered: true,
		texture: { bitmap: layerBitmap, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) } });
	const later = new HostMesh({ positions: new Float32Array([0.5, -0.5, 0.5, 1, -0.5, 0.5, 0.5, -1, 0.5]), color: 0xffff00ff, doubleSided: true, layered: true });
	layers.instances.push(instance(behind), instance(overlay), instance(later));
	const cutout = new HostMeshScene(32, 32); cutout.clipFromOrigin.set(layers.clipFromOrigin);
	const surface = new HostMesh({ positions: overlay.positions, indices: overlay.indices, indexComponentType: 5121,
		color: 0xffffffff, doubleSided: true, texture: overlay.texture });
	cutout.instances.push(instance(surface));
	return { affine, clipped, gxAffine, gxClipped, layers, cutout, bitmap, layerBitmap, dispose() {
		for (const value of [affine, clipped, gxAffine, gxClipped, layers, cutout, triangle, crossing, gxTriangle, gxCrossing, behind, overlay, later, surface, bitmap, layerBitmap]) value.dispose();
	} };
}

/** RGB555 ramp and gain boundaries distinguish GX from normalized RGBA tinting.
 * Every material shares one bitmap; neither consumer bakes a tinted image. */
export function createHostGxMeshFixture() {
	const pixels = new Uint8Array(32 * 4);
	for (let i = 0; i < 32; i++) {
		const r = i < 2 ? 0 : i, g = i < 2 ? 0 : 31 - i, b = i < 2 ? 0 : (i * 3) & 31;
		pixels[i * 4] = (r << 3) | (r >> 2); pixels[i * 4 + 1] = (g << 3) | (g >> 2);
		pixels[i * 4 + 2] = (b << 3) | (b >> 2); pixels[i * 4 + 3] = i === 1 ? 0 : 255;
	}
	const bitmap = new HostBitmap({ width: 32, height: 1, pixels });
	const gains = [0, 1, 64, 127, 128, 129, 192, 255], scene = new HostMeshScene(32, gains.length + 1);
	scene.clipFromOrigin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const indices = new Uint8Array([0, 1, 2, 0, 2, 3]);
	const texture = { bitmap, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) };
	for (let row = 0; row <= gains.length; row++) {
		const top = 1 - 2 * row / scene.height, bottom = 1 - 2 * (row + 1) / scene.height;
		const mesh = new HostMesh({ positions: new Float32Array([-1, top, .5, 1, top, .5, 1, bottom, .5, -1, bottom, .5]),
			indices, indexComponentType: 5121, doubleSided: true,
			gxCommand: row === gains.length ? 0x204d7933 : 0x24800000 | ((255 - gains[row]) << 8) | gains[row],
			texture: row === gains.length ? undefined : texture });
		scene.instances.push({ mesh, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 });
	}
	return { scene, bitmap, gains, dispose() {
		for (const { mesh } of scene.instances) mesh.dispose(); scene.dispose(); bitmap.dispose();
	} };
}
