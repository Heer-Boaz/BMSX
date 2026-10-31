import { HostMeshBuffers, HostMeshPositionBuffers, HostMeshSceneTargets, hostMeshReflected, writeHostMeshClipMatrix,
	type HostMesh, type HostMeshScene } from '../mesh';
import type { RenderPassDesc } from '../../backend/backend';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../backend/webgpu/backend';

import shader from './shaders/host_mesh.wgsl';

type MeshBuffers = { positions: GPUBuffer; source: Float32Array; indices: GPUBuffer | undefined; count: number; indexFormat: GPUIndexFormat };
export type WebGPUHostMeshTarget = { color: GPUTexture; depth: GPUTexture; pass: RenderPassDesc };

export class WebGPUHostMeshScenes {
	public readonly targets: HostMeshSceneTargets<WebGPUHostMeshTarget>;
	private readonly positionBuffers: HostMeshPositionBuffers<GPUBuffer>;
	private readonly meshes: HostMeshBuffers<MeshBuffers>;
	private readonly pipelines: GPURenderPipeline[];
	private readonly uniformLayout: GPUBindGroupLayout;
	private uniformBuffer: GPUBuffer;
	private uniformBindGroup: GPUBindGroup;
	private uniformCapacity = 0;
	private uniformScratch = new Float32Array(0);
	private readonly uniformStride: number;
	private readonly offsets = new Uint32Array(1);
	public constructor(private readonly backend: WebGPUBackend) {
		const device = backend.device, alignment = device.limits.minUniformBufferOffsetAlignment;
		this.uniformStride = Math.trunc((80 + alignment - 1) / alignment) * alignment;
		this.uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
			buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 } }] });
		const layout = device.createPipelineLayout({ bindGroupLayouts: [this.uniformLayout] });
		const module = device.createShaderModule({ label: 'host_mesh', code: shader });
		this.pipelines = ['ccw', 'cw', 'none'].map(mode => device.createRenderPipeline({
			label: `host_mesh_${mode}`, layout,
			vertex: { module, entryPoint: 'vertex_main', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
			fragment: { module, entryPoint: 'fragment_main', targets: [{ format: 'rgba8unorm' }] },
			primitive: { topology: 'triangle-list', frontFace: mode === 'cw' ? 'cw' : 'ccw', cullMode: mode === 'none' ? 'none' : 'back' },
			depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
		}));
		this.positionBuffers = new HostMeshPositionBuffers(positions => {
			const buffer = device.createBuffer({ label: 'host_mesh_positions', size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, positions.buffer, positions.byteOffset, positions.byteLength);
			backend.accountUpload('vertex', positions.byteLength);
			return buffer;
		}, buffer => buffer.destroy());
		this.meshes = new HostMeshBuffers(mesh => this.createMesh(mesh), mesh => {
			mesh.indices?.destroy(); this.positionBuffers.release(mesh.source);
		});
		this.targets = new HostMeshSceneTargets(scene => {
			const color = backend.createColorTexture({ width: scene.width, height: scene.height, format: 'rgba8unorm' }) as GPUTexture;
			const depth = backend.createDepthTexture({ width: scene.width, height: scene.height, format: 'depth32float' }) as GPUTexture;
			return { color, depth, pass: { label: 'host_mesh', color: { tex: color, clear: [0, 0, 0, 0] }, depth: { tex: depth, clearDepth: 0 } } };
		}, (target, scene) => this.render(target, scene), target => { target.color.destroy(); target.depth.destroy(); });
	}
	private createMesh(mesh: HostMesh): MeshBuffers {
		const device = this.backend.device, positions = this.positionBuffers.retain(mesh.positions);
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
		return { positions, source: mesh.positions, indices, indexFormat,
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
			const color = instance.mesh.color;
			this.uniformScratch[base + 16] = ((color >>> 16) & 255) / 255;
			this.uniformScratch[base + 17] = ((color >>> 8) & 255) / 255;
			this.uniformScratch[base + 18] = (color & 255) / 255;
			this.uniformScratch[base + 19] = 1;
		}
		if (count !== 0) {
			device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformScratch.buffer, 0, count * this.uniformStride);
			this.backend.accountUpload('uniform', count * this.uniformStride);
		}
		const pass = this.backend.beginRenderPass(target.pass) as WebGPUPassEncoder;
		pass.encoder.setViewport(0, 0, scene.width, scene.height, 0, 1);
		for (let index = 0; index < count; index++) {
			const instance = scene.instances[index], mesh = instance.mesh, geometry = this.meshes.get(mesh);
			pass.encoder.setPipeline(this.pipelines[mesh.doubleSided ? 2 : hostMeshReflected(instance) ? 1 : 0]);
			this.offsets[0] = index * this.uniformStride;
			pass.encoder.setBindGroup(0, this.uniformBindGroup, this.offsets);
			pass.encoder.setVertexBuffer(0, geometry.positions);
			if (geometry.indices === undefined) pass.encoder.draw(geometry.count);
			else { pass.encoder.setIndexBuffer(geometry.indices, geometry.indexFormat); pass.encoder.drawIndexed(geometry.count); }
		}
		this.backend.endRenderPass(pass);
	}
	public dispose(): void {
		this.targets.dispose(); this.meshes.dispose(); this.uniformBuffer?.destroy();
	}
}
