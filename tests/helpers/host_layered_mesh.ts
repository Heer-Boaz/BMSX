import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { HostMesh, HostMeshScene, type HostMeshInstance } from '../../machine/ts/render/host_overlay/mesh';

/** Independently positioned canvas batches share a plane, not necessarily the
 * same rounded depth equation. Compare their ordered composition while orbiting. */
export function createHostLayeredMeshFixture() {
	const camera = new WorkbenchViewportCamera(); camera.setMode('3d'); camera.setViewport(96, 96);
	camera.frame3D(0, 0, 0, 320, 240, 0);
	const bitmap = new HostBitmap({ width: 4, height: 2, pixels: new Uint8Array([
		255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 255,
		0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0,
	]) });
	const indices = new Uint8Array([0, 1, 2, 0, 2, 3]);
	const background = new HostMesh({ positions: new Float32Array([0, 0, 0, 320, 0, 0, 320, 240, 0, 0, 240, 0]),
		indices, indexComponentType: 5121, color: 0xffffffff, doubleSided: true, layered: true });
	const artwork = new HostMesh({ positions: new Float32Array([0, 0, 0, 113, 0, 0, 113, 61, 0, 0, 61, 0]),
		indices, indexComponentType: 5121, color: 0xffffffff, doubleSided: true, layered: true,
		texture: { bitmap, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) } });
	const model = new HostMesh({ positions: new Float32Array([0, 0, 0, 45, 0, 0, 0, 45, 0]), color: 0xff0000ff, doubleSided: true });
	const instance = (mesh: HostMesh, ox = 0, oy = 0, oz = 0): HostMeshInstance =>
		({ mesh, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox, oy, oz });
	const front = instance(model, 65, 110, 20), back = instance(model, 165, 110, -20);
	const white = instance(background), sprite = instance(artwork, 63, 87);
	const opaque = new HostMeshScene(96, 96), base = new HostMeshScene(96, 96), foreground = new HostMeshScene(96, 96), combined = new HostMeshScene(96, 96);
	opaque.instances.push(front, back); base.instances.push(front, back, white);
	foreground.instances.push(front, sprite); combined.instances.push(front, back, white, sprite);
	const scenes = [opaque, base, foreground, combined];
	return { opaque, base, foreground, combined, orbit() {
		camera.orbit(3, -1);
		for (const scene of scenes) { scene.clipFromOrigin.set(camera.clipFromOrigin); scene.changed(); }
	}, dispose() {
		for (const scene of scenes) scene.dispose();
		background.dispose(); artwork.dispose(); model.dispose(); bitmap.dispose();
	} };
}

/** All fixture texels are opaque or holes. Independent rendering supplies exact
 * coverage, including the real 3D occluder, without freezing camera coordinates. */
export function compareHostLayeredMesh(base: ArrayLike<number>, foreground: ArrayLike<number>, combined: ArrayLike<number>) {
	let missing = 0, artwork = 0, occluder = 0;
	for (let offset = 0; offset < combined.length; offset += 4) {
		const expected = foreground[offset + 3] === 0 ? base : foreground;
		if (foreground[offset] === 255) artwork++;
		if (foreground[offset] === 0 && foreground[offset + 1] === 0 && foreground[offset + 2] === 255) occluder++;
		for (let channel = 0; channel < 4; channel++) if (combined[offset + channel] !== expected[offset + channel]) { missing++; break; }
	}
	return { missing, artwork, occluder };
}
