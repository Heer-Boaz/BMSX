import { HostMeshBuffers, HostMeshPositionBuffers, HostMeshSceneTargets, hostMeshReflected, writeHostMeshClipMatrix,
	type HostMesh, type HostMeshScene } from '../mesh';
import type { RenderPassDesc } from '../../backend/backend';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../backend/webgpu/backend';
import type { HostBitmapTextures } from '../bitmap';

import shader from './shaders/host_mesh.wgsl';

type MeshBuffers = { positions: GPUBuffer; source: Float32Array; uvs: GPUBuffer | undefined; indices: GPUBuffer | undefined; count: number; indexFormat: GPUIndexFormat };
export type WebGPUHostMeshTarget = { color: GPUTexture; depth: GPUTexture; pass: RenderPassDesc };

export class WebGPUHostMeshScenes {
	public readonly targets: HostMeshSceneTargets<WebGPUHostMeshTarget>;
	private readonly positionBuffers: HostMeshPositionBuffers<GPUBuffer>;
	private readonly meshes: HostMeshBuffers<MeshBuffers>;
	private readonly pipelines: GPURenderPipeline[];
	private readonly uniformLayout: GPUBindGroupLayout;
	private readonly textureLayout: GPUBindGroupLayout;
	private readonly textureBindings = new WeakMap<GPUTexture, GPUBindGroup>();
	private uniformBuffer: GPUBuffer;
	private uniformBindGroup: GPUBindGroup;
	private uniformCapacity = 0;
	private uniformScratch = new Float32Array(0);
	private readonly uniformStride: number;
	private readonly offsets = new Uint32Array(1);
	public constructor(private readonly backend: WebGPUBackend, private readonly bitmaps: Pick<HostBitmapTextures<{ texture: GPUTexture }>, 'get'>) {
		const device = backend.device, alignment = device.limits.minUniformBufferOffsetAlignment;
		this.uniformStride = Math.trunc((80 + alignment - 1) / alignment) * alignment;
		this.uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 } }] });
		this.textureLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
		const layouts = [device.createPipelineLayout({ bindGroupLayouts: [this.uniformLayout] }),
			device.createPipelineLayout({ bindGroupLayouts: [this.uniformLayout, this.textureLayout] })];
		const module = device.createShaderModule({ label: 'host_mesh', code: shader });
		this.pipelines = [];
		for (const [fragment, layered, textured] of [
			['fragment_main', false, false], ['fragment_textured', false, true], ['fragment_gx_textured', false, true],
			['fragment_main', true, false], ['fragment_textured', true, true],
		] as const) for (const mode of ['ccw', 'cw', 'none']) {
			const buffers: GPUVertexBufferLayout[] = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }];
			if (textured) buffers.push({ arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] });
			this.pipelines.push(device.createRenderPipeline({
				label: `host_mesh_${mode}_${layered}_${fragment}`, layout: layouts[textured ? 1 : 0],
				vertex: { module, entryPoint: textured ? 'vertex_textured' : 'vertex_main', buffers },
				fragment: { module, entryPoint: fragment, targets: [{ format: 'rgba8unorm',
					blend: layered ? { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
						alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } : undefined }] },
				primitive: { topology: 'triangle-list', frontFace: mode === 'cw' ? 'cw' : 'ccw', cullMode: mode === 'none' ? 'none' : 'back' },
				depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: layered ? 'greater-equal' : 'greater' },
			}));
		}
		this.positionBuffers = new HostMeshPositionBuffers(positions => {
			const buffer = device.createBuffer({ label: 'host_mesh_positions', size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, positions.buffer, positions.byteOffset, positions.byteLength);
			backend.accountUpload('vertex', positions.byteLength);
			return buffer;
		}, buffer => buffer.destroy());
		this.meshes = new HostMeshBuffers(mesh => this.createMesh(mesh), mesh => {
			mesh.indices?.destroy(); mesh.uvs?.destroy(); this.positionBuffers.release(mesh.source);
		});
		this.targets = new HostMeshSceneTargets(scene => {
			const color = backend.createColorTexture({ width: scene.width, height: scene.height, format: 'rgba8unorm' }) as GPUTexture;
			const depth = backend.createDepthTexture({ width: scene.width, height: scene.height, format: 'depth32float' }) as GPUTexture;
			return { color, depth, pass: { label: 'host_mesh', color: { tex: color, clear: [0, 0, 0, 0] }, depth: { tex: depth, clearDepth: 0 } } };
		}, (target, scene) => this.render(target, scene), target => { target.color.destroy(); target.depth.destroy(); });
	}
	private createMesh(mesh: HostMesh): MeshBuffers {
		const device = this.backend.device, positions = this.positionBuffers.retain(mesh.positions);
		let uvs: GPUBuffer | undefined;
		if (mesh.texture !== undefined) {
			const source = mesh.texture.uvs;
			uvs = device.createBuffer({ label: 'host_mesh_uvs', size: source.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(uvs, 0, source.buffer, source.byteOffset, source.byteLength); this.backend.accountUpload('vertex', source.byteLength);
		}
		let indices: GPUBuffer | undefined;
		const indexFormat = mesh.indexComponentType === 5125 ? 'uint32' : 'uint16';
		if (mesh.indices !== undefined) {
			// WebGPU has no byte index format. Widen that declared stream once,
			// at the backend upload owner, while the resource retains its raw width.
			const source = mesh.indexComponentType === 5121 ? Uint16Array.from(mesh.indices) : mesh.indices;
			const bytes = new Uint8Array((source.byteLength + 3) & ~3);
			bytes.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
			indices = device.createBuffer({ label: 'host_mesh_indices', size: bytes.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(indices, 0, bytes);
			this.backend.accountUpload('index', bytes.byteLength);
		}
		return { positions, source: mesh.positions, uvs, indices, indexFormat,
			count: mesh.drawCount };
	}
	private render(target: WebGPUHostMeshTarget, scene: HostMeshScene): void {
		const device = this.backend.device, count = scene.instances.length;
		if (count > this.uniformCapacity) {
			let capacity = Math.max(1, this.uniformCapacity);
			while (capacity < count) capacity *= 2;
			this.uniformBuffer?.destroy();
			this.uniformCapacity = capacity;
			this.uniformScratch = new Float32Array(capacity * this.uniformStride / 4);
			this.uniformBuffer = device.createBuffer({ label: 'host_mesh_instances', size: this.uniformScratch.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			this.uniformBindGroup = device.createBindGroup({ layout: this.uniformLayout,
				entries: [{ binding: 0, resource: { buffer: this.uniformBuffer, size: 80 } }] });
		}
		for (let index = 0; index < count; index++) {
			const instance = scene.instances[index], base = index * this.uniformStride / 4;
			writeHostMeshClipMatrix(this.uniformScratch, scene, instance, base);
			const mesh = instance.mesh;
			this.uniformScratch[base + 16] = mesh.red;
			this.uniformScratch[base + 17] = mesh.green;
			this.uniformScratch[base + 18] = mesh.blue;
			this.uniformScratch[base + 19] = mesh.alpha;
		}
		if (count !== 0) {
			device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformScratch.buffer, 0, count * this.uniformStride);
			this.backend.accountUpload('uniform', count * this.uniformStride);
		}
		const pass = this.backend.beginRenderPass(target.pass) as WebGPUPassEncoder;
		pass.encoder.setViewport(0, 0, scene.width, scene.height, 0, 1);
		for (let index = 0; index < count; index++) {
			const instance = scene.instances[index], mesh = instance.mesh, geometry = this.meshes.get(mesh);
			pass.encoder.setPipeline(this.pipelines[(mesh.layered ? 9 : 0) + mesh.shader * 3
				+ (mesh.doubleSided ? 2 : hostMeshReflected(instance) ? 1 : 0)]);
			this.offsets[0] = index * this.uniformStride;
			pass.encoder.setBindGroup(0, this.uniformBindGroup, this.offsets);
			pass.encoder.setVertexBuffer(0, geometry.positions);
			if (mesh.texture !== undefined) {
				const texture = this.bitmaps.get(mesh.texture.bitmap).texture;
				let binding = this.textureBindings.get(texture);
				if (binding === undefined) {
					binding = device.createBindGroup({ layout: this.textureLayout, entries: [{ binding: 0, resource: texture.createView() }] });
					this.textureBindings.set(texture, binding);
				}
				pass.encoder.setBindGroup(1, binding); pass.encoder.setVertexBuffer(1, geometry.uvs!);
			}
			if (geometry.indices === undefined) pass.encoder.draw(geometry.count);
			else { pass.encoder.setIndexBuffer(geometry.indices, geometry.indexFormat); pass.encoder.drawIndexed(geometry.count); }
		}
		this.backend.endRenderPass(pass);
	}
	public dispose(): void {
		this.targets.dispose(); this.meshes.dispose(); this.uniformBuffer?.destroy();
	}
}
