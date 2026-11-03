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
	return { affine, clipped, layers, cutout, bitmap, layerBitmap, dispose() {
		for (const value of [affine, clipped, layers, cutout, triangle, crossing, behind, overlay, later, surface, bitmap, layerBitmap]) value.dispose();
	} };
}
