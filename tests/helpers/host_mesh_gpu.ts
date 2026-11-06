import { createWebGLBackend, createWebGPUBackend } from '../../hosts/browser/backend';
import { WebGLHostMeshScenes } from '../../machine/ts/render/host_overlay/webgl/mesh';
import { WebGPUHostMeshScenes } from '../../machine/ts/render/host_overlay/webgpu/mesh';
import { HostMesh, HostMeshScene } from '../../machine/ts/render/host_overlay/mesh';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { BrowserVideoOutput } from '../../hosts/browser/video_output';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { HostBitmapTextures } from '../../machine/ts/render/host_overlay/bitmap';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../machine/ts/render/backend/texture_params';
import { createHostGxMeshFixture, createHostTexturedMeshFixture } from './host_textured_mesh';
import { compareHostLayeredMesh, createHostLayeredMeshFixture } from './host_layered_mesh';

/** Independent synthetic geometry exercises actual host backend resources and overlay composition. */
export async function renderHostMeshCase(kind: 'webgl2' | 'webgpu') {
	const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
	const adapter = kind === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
	const gpu = kind === 'webgpu' ? await createWebGPUBackend(canvas, adapter!, 2 * 1024 * 1024) : undefined;
	const webgl = kind === 'webgl2' ? createWebGLBackend(canvas, 2 * 1024 * 1024) : undefined;
	const backend: GPUBackend = gpu === undefined ? webgl! : gpu;
	const readPresentation = async (): Promise<number[]> => {
		if (gpu !== undefined) return Array.from(await backend.readColorTexture(gpu.context.getCurrentTexture(), 32, 32));
		const gl = webgl!.gl, bytes = new Uint8Array(32 * 32 * 4), result: number[] = [];
		gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
		for (let row = 31; row >= 0; row--) result.push(...bytes.subarray(row * 128, (row + 1) * 128));
		return result;
	};
	let vertexUploads = 0;
	const accountUpload = backend.accountUpload.bind(backend);
	backend.accountUpload = (uploadKind, bytes) => {
		if (uploadKind === 'vertex') vertexUploads += bytes;
		accountUpload(uploadKind, bytes);
	};
	const device = gpu?.device, gpuErrors: string[] = [];
	if (device !== undefined) {
		device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
		device.pushErrorScope('validation');
		gpu!.context.configure({ device, format: gpu!.canvasFormat, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	}
	const glBitmaps = webgl === undefined ? undefined : new HostBitmapTextures(
		image => webgl.createTexture(image.pixels, image.width, image.height, RGBA8_LINEAR_TEXTURE_PARAMS) as WebGLTexture,
		(texture, image) => webgl.updateTexture(texture, image.pixels, image.width, image.height, RGBA8_LINEAR_TEXTURE_PARAMS), texture => webgl.destroyTexture(texture));
	const gpuBitmaps = gpu === undefined ? undefined : new HostBitmapTextures(image => ({
		texture: gpu.createTexture(image.pixels, image.width, image.height, RGBA8_LINEAR_TEXTURE_PARAMS) as GPUTexture }),
		(entry, image) => gpu.updateTexture(entry.texture, image.pixels, image.width, image.height, RGBA8_LINEAR_TEXTURE_PARAMS), entry => entry.texture.destroy());
	const scenes = gpu === undefined ? new WebGLHostMeshScenes(webgl!, glBitmaps!) : new WebGPUHostMeshScenes(gpu, gpuBitmaps!);
	const scene = new HostMeshScene(32, 32);
	scene.clipFromOrigin.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]);
	const red = new HostMesh({ positions: new Float32Array([-.9375, -.9375, 1.25, 3, -3, 4, 0, 1.5, 2]), color: 0xffff0000, doubleSided: false });
	const blue = new HostMesh({ positions: new Float32Array([-1.5, -1.5, 2, 1.5, -1.5, 2, 0, 1.5, 2]), color: 0xff0000ff, doubleSided: false });
	const instance = (mesh: HostMesh) => ({ mesh, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 });
	scene.instances.push(instance(red), instance(blue)); scene.changed();
	let passes = 0;
	const begin = backend.beginRenderPass.bind(backend);
	backend.beginRenderPass = (desc: { label?: string }) => { if (desc.label === 'host_mesh') passes++; return begin(desc); };
	const target = scenes.targets.get(scene);
	const pixels = Array.from(await backend.readColorTexture(target.color, 32, 32)) as number[];
	const pixel = (data: number[], x: number, y: number, width = 32) => data.slice((y * width + x) * 4, (y * width + x + 1) * 4);
	const fractional = new HostMeshScene(32.2, 31.8);
	fractional.clipFromOrigin.set(scene.clipFromOrigin); fractional.instances.push(...scene.instances);
	const fractionalTarget = scenes.targets.get(fractional);
	const fractionalPixels = await backend.readColorTexture(fractionalTarget.color, 32, 32);
	backend.beginFrame(); const fractionalPasses = passes, fractionalRevision = fractional.revision;
	fractional.resize(31.75, 32.375);
	const fractionalSizing = {
		pixelsMatch: fractionalPixels.every((value, index) => value === pixels[index]),
		sameTarget: scenes.targets.get(fractional) === fractionalTarget,
		sameRevision: fractional.revision === fractionalRevision,
		idle: { passes: passes - fractionalPasses, uploads: backend.getFrameStats().bytesUploaded },
	};
	fractional.dispose();
	scene.instances.reverse(); scene.changed();
	const reordered = Array.from(await backend.readColorTexture(scenes.targets.get(scene).color, 32, 32)) as number[];
	backend.beginFrame();
	const beforeIdle = passes;
	const sameTarget = scenes.targets.get(scene) === target;
	const idle = { passes: passes - beforeIdle, uploads: backend.getFrameStats().bytesUploaded };
	scene.originX = 2 ** 60; scene.originZ = 2 ** 60;
	for (const item of scene.instances) { item.ox = scene.originX; item.oz = scene.originZ; }
	scene.changed();
	const origin = Array.from(await backend.readColorTexture(scenes.targets.get(scene).color, 32, 32)) as number[];
	for (const item of scene.instances) { item.xx = -1; item.yx = .125; }
	scene.changed();
	const reflected = Array.from(await backend.readColorTexture(scenes.targets.get(scene).color, 32, 32)) as number[];
	const reflectedVisible = reflected.some((value, index) => index % 4 === 3 && value === 255);
	const sharedPositions = blue.positions;
	const shared = new HostMeshScene(32, 32); shared.clipFromOrigin.set(scene.clipFromOrigin);
	const sharedMeshes = ([5121, 5123, 5125] as const).map((type, index) => new HostMesh({ positions: sharedPositions,
		indices: type === 5121 ? new Uint8Array([0, 1, 2]) : type === 5123 ? new Uint16Array([0, 1, 2]) : new Uint32Array([0, 1, 2]),
		indexComponentType: type, color: index === 0 ? 0xff00ff00 : 0xffff0000, doubleSided: false }));
	for (const mesh of sharedMeshes) shared.instances.push(instance(mesh)); shared.changed();
	backend.beginFrame();
	const vertexBefore = vertexUploads;
	const sharedPixels = Array.from(await backend.readColorTexture(scenes.targets.get(shared).color, 32, 32)) as number[];
	const sharedVertexBytes = vertexUploads - vertexBefore;
	sharedMeshes[0].dispose(); shared.instances.shift(); shared.changed();
	const remaining = Array.from(await backend.readColorTexture(scenes.targets.get(shared).color, 32, 32)) as number[];
	const clipMesh = new HostMesh({ positions: new Float32Array([-1, -1, 2, 0, 2, -.5, 1, -1, 2]), color: 0xffffff00, doubleSided: true });
	const clipped = new HostMeshScene(32, 32); clipped.clipFromOrigin.set(scene.clipFromOrigin); clipped.instances.push(instance(clipMesh)); clipped.changed();
	const clippedPixels = Array.from(await backend.readColorTexture(scenes.targets.get(clipped).color, 32, 32)) as number[];
	const clippedVisible = clippedPixels.some((value, index) => index % 4 === 3 && value === 255);
	const oldTarget = scenes.targets.get(clipped); clipped.resize(24.75, 16.2);
	const resizedTarget = scenes.targets.get(clipped), resized = await backend.readColorTexture(resizedTarget.color, 25, 16);
	const textured = createHostTexturedMeshFixture();
	const affinePixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.affine).color, 32, 32));
	const nearPixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.clipped).color, 32, 32));
	const gxAffinePixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.gxAffine).color, 32, 32));
	const gxNearPixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.gxClipped).color, 32, 32));
	const layerPixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.layers).color, 32, 32));
	const cutoutPixels = Array.from(await backend.readColorTexture(scenes.targets.get(textured.cutout).color, 32, 32));
	backend.beginFrame(); const texturedPasses = passes;
	scenes.targets.get(textured.affine); scenes.targets.get(textured.clipped); scenes.targets.get(textured.layers); scenes.targets.get(textured.cutout);
	const texturedIdle = { passes: passes - texturedPasses, uploads: backend.getFrameStats().bytesUploaded };
	const gx = createHostGxMeshFixture();
	const gxPixels = Array.from(await backend.readColorTexture(scenes.targets.get(gx.scene).color, gx.scene.width, gx.scene.height));
	const layered = createHostLayeredMeshFixture(), orbitLayers = [];
	for (let frame = 0; frame < 12; frame++) {
		layered.orbit();
		const base = await backend.readColorTexture(scenes.targets.get(layered.base).color, 96, 96);
		const foreground = await backend.readColorTexture(scenes.targets.get(layered.foreground).color, 96, 96);
		const combined = await backend.readColorTexture(scenes.targets.get(layered.combined).color, 96, 96);
		orbitLayers.push(compareHostLayeredMesh(base, foreground, combined));
	}
	layered.dispose();
	const presenter = new VideoPresenter(new BrowserVideoOutput(canvas, null, 'fit'), backend, 32, 32);
	const library = new RenderPassLibrary(backend, presenter), renderer = new OverlayRenderer(presenter.hostOverlayQueue, { width: 32, height: 32 });
	const frameTexture = backend.createColorTexture({ width: 32, height: 32, initialClearColor: [0, 0, 0, 1] });
	renderer.beginFrame(); renderer.fillRect(0, 0, 32, 32, 0, 0xff202040, 0);
	renderer.drawMeshScene(textured.layers, 0, 0, 8, 8);
	renderer.drawMeshScene(textured.cutout, 24, 0, 32, 8);
	renderer.pushTransform({ scale: .5, offsetX: 4, offsetY: 4 }); renderer.pushClipRect(8, 8, 24, 24);
	renderer.drawMeshScene(shared, 0, 0, 32, 32); renderer.popClipRect(); renderer.popTransform();
	renderer.fillRect(10, 10, 12, 12, 0, 0xff00ff00, 0); renderer.endFrame();
	const frame = presenter.hostOverlayQueue.consumeOverlayFrame();
	library.setState('host_overlay', { width: 32, height: 32, overlayWidth: 32, overlayHeight: 32,
		time: 0, delta: 0, frameTexture, frameWidth: 32, frameHeight: 32, ...frame });
	library.execute('host_overlay', null, null);
	const composite = await readPresentation();
	// The output remains 32 physical pixels. Both device density and nested UI
	// transforms must reach the mesh target, not just enlarge its finished image.
	const densityScene = new HostMeshScene(16, 16), densityMatches: boolean[] = [];
	densityScene.clipFromOrigin.set(scene.clipFromOrigin); densityScene.instances.push(instance(red), instance(blue));
	for (const [logicalSize, scale] of [[16, 1], [64 / 3, 1], [16, 2]] as const) {
		densityScene.resize(logicalSize / scale, logicalSize / scale);
		renderer.setViewportSize({ width: logicalSize, height: logicalSize });
		renderer.beginFrame(); renderer.fillRect(0, 0, logicalSize, logicalSize, 0, 0xff000000, 0);
		renderer.pushTransform({ scale, offsetX: 0, offsetY: 0 });
		renderer.drawMeshScene(densityScene, 0, 0, logicalSize / scale, logicalSize / scale); renderer.popTransform(); renderer.endFrame();
		const densityFrame = presenter.hostOverlayQueue.consumeOverlayFrame();
		library.setState('host_overlay', { width: 32, height: 32, overlayWidth: logicalSize, overlayHeight: logicalSize,
			time: 0, delta: 0, frameTexture, frameWidth: 32, frameHeight: 32, ...densityFrame });
		library.execute('host_overlay', null, null);
		const presented = await readPresentation();
		densityMatches.push(presented.every((value, index) => index % 4 === 3 || value === pixels[index]));
	}
	densityScene.dispose();
	textured.layerBitmap.update(new Uint8Array(16).fill(255), 2, 2); textured.layers.changed();
	const changedTexture = Array.from(await backend.readColorTexture(scenes.targets.get(textured.layers).color, 32, 32));
	library.dispose(); scenes.dispose(); glBitmaps?.dispose(); gpuBitmaps?.dispose(); textured.dispose(); gx.dispose();
	for (const value of [scene, shared, clipped, red, blue, clipMesh, ...sharedMeshes]) value.dispose();
	backend.destroyTexture(frameTexture);
	let validationError: string | undefined;
	if (device !== undefined) { await device.queue.onSubmittedWorkDone(); validationError = (await device.popErrorScope())?.message; device.destroy(); }
	return { kind: backend.type, left: pixel(pixels, 10, 21), right: pixel(pixels, 21, 21), orderIndependent: JSON.stringify(pixels) === JSON.stringify(reordered),
		originPreserved: JSON.stringify(origin) === JSON.stringify(reordered), sameTarget, idle, reflectedVisible, fractionalSizing, densityMatches,
		sharedVertexBytes, coplanar: pixel(sharedPixels, 16, 16), remaining: pixel(remaining, 16, 16), clippedVisible,
		resized: oldTarget !== resizedTarget && resized.length === 25 * 16 * 4, resizedExtent: [resizedTarget.width, resizedTarget.height],
		background: pixel(composite, 5, 10), cropped: pixel(composite, 15, 14), laterUi: pixel(composite, 10, 10),
		textured: { affine: pixel(affinePixels, 20, 24), upright: pixel(affinePixels, 4, 8), near: pixel(nearPixels, 17, 19),
			clipped: pixel(nearPixels, 10, 10), hole: pixel(layerPixels, 3, 10), opaque: pixel(layerPixels, 24, 8),
			alpha: pixel(layerPixels, 4, 24), coplanar: pixel(layerPixels, 27, 26), composite: pixel(composite, 1, 6),
			cutout: pixel(cutoutPixels, 4, 24), cutoutComposite: pixel(composite, 25, 6),
			changed: pixel(changedTexture, 4, 24), idle: texturedIdle },
		orbitLayers, gxPixels, gxAffineMatches: JSON.stringify(gxAffinePixels) === JSON.stringify(affinePixels),
		gxNearMatches: JSON.stringify(gxNearPixels) === JSON.stringify(nearPixels), gpuErrors, validationError };
}
