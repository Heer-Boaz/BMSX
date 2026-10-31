import { HostMeshBuffers, HostMeshPositionBuffers, HostMeshSceneTargets, hostMeshReflected, writeHostMeshClipMatrix,
	type HostMesh, type HostMeshScene } from '../mesh';
import type { RenderPassDesc } from '../../backend/backend';
import type { WebGLBackend } from '../../backend/webgl/backend';

import vertex from './shaders/host_mesh.vert.glsl';
import fragment from './shaders/host_mesh.frag.glsl';

type MeshBuffers = { vao: WebGLVertexArrayObject; indices: WebGLBuffer | undefined; positions: Float32Array; count: number; indexType: number };
export type WebGLHostMeshTarget = { color: WebGLTexture; depth: WebGLTexture; pass: RenderPassDesc };

/** Owned host geometry uploads and a private reversed-depth target for each viewport. */
export class WebGLHostMeshScenes {
	public readonly targets: HostMeshSceneTargets<WebGLHostMeshTarget>;
	private readonly positionBuffers: HostMeshPositionBuffers<WebGLBuffer>;
	private readonly meshes: HostMeshBuffers<MeshBuffers>;
	private readonly program: WebGLProgram;
	private readonly matrixLocation: WebGLUniformLocation;
	private readonly colorLocation: WebGLUniformLocation;
	private readonly matrix = new Float32Array(16);
	public constructor(private readonly backend: WebGLBackend) {
		const gl = backend.gl;
		this.program = backend.buildProgram(vertex, fragment, 'host_mesh');
		this.matrixLocation = gl.getUniformLocation(this.program, 'clip_from_model');
		this.colorLocation = gl.getUniformLocation(this.program, 'color');
		this.positionBuffers = new HostMeshPositionBuffers(
			positions => backend.createVertexBuffer(positions, 'static'), buffer => backend.destroyBuffer(buffer));
		this.meshes = new HostMeshBuffers(mesh => this.createMesh(mesh), mesh => {
			backend.deleteVertexArray(mesh.vao);
			if (mesh.indices !== undefined) backend.destroyBuffer(mesh.indices);
			this.positionBuffers.release(mesh.positions);
		});
		this.targets = new HostMeshSceneTargets(scene => {
			const color = backend.createColorTexture({ width: scene.width, height: scene.height, format: gl.RGBA8 }) as WebGLTexture;
			const depth = backend.createDepthTexture({ width: scene.width, height: scene.height, format: 'depth32float' });
			return { color, depth, pass: { label: 'host_mesh', color: { tex: color, clear: [0, 0, 0, 0] }, depth: { tex: depth, clearDepth: 0 } } };
		}, (target, scene) => this.render(target, scene), target => {
			backend.destroyTexture(target.color); backend.destroyTexture(target.depth);
		});
	}
	private createMesh(mesh: HostMesh): MeshBuffers {
		const backend = this.backend, gl = backend.gl;
		const positions = this.positionBuffers.retain(mesh.positions);
		const vao = backend.createVertexArray() as WebGLVertexArrayObject;
		backend.bindVertexArray(vao); backend.bindArrayBuffer(positions);
		gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
		let indices: WebGLBuffer | undefined;
		if (mesh.indices !== undefined) {
			indices = gl.createBuffer()!;
			backend.bindElementArrayBuffer(indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
			backend.accountUpload('index', mesh.indices.byteLength);
		}
		backend.bindVertexArray(null);
		return { vao, indices, positions: mesh.positions, count: mesh.drawCount,
			indexType: mesh.indexComponentType === 5121 ? gl.UNSIGNED_BYTE : mesh.indexComponentType === 5123 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT };
	}
	private render(target: WebGLHostMeshTarget, scene: HostMeshScene): void {
		const backend = this.backend, gl = backend.gl;
		gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
		backend.setDepthMask(true); backend.setDepthTestEnabled(true); backend.setDepthFunc(gl.GREATER);
		backend.setBlendEnabled(false);
		const pass = backend.beginRenderPass(target.pass);
		backend.setViewportRect(0, 0, scene.width, scene.height); backend.useProgram(this.program);
		for (const instance of scene.instances) {
			const mesh = instance.mesh, geometry = this.meshes.get(mesh);
			writeHostMeshClipMatrix(this.matrix, scene, instance);
			gl.uniformMatrix4fv(this.matrixLocation, false, this.matrix);
			gl.uniform3f(this.colorLocation, ((mesh.color >>> 16) & 255) / 255, ((mesh.color >>> 8) & 255) / 255, (mesh.color & 255) / 255);
			backend.setCullEnabled(!mesh.doubleSided); gl.frontFace(hostMeshReflected(instance) ? gl.CW : gl.CCW);
			backend.bindVertexArray(geometry.vao);
			if (geometry.indices === undefined) backend.draw(pass, 0, geometry.count);
			else backend.drawIndexed(pass, geometry.count, 0, geometry.indexType);
		}
		backend.bindVertexArray(null); gl.frontFace(gl.CCW);
		backend.endRenderPass(pass);
	}
	public dispose(): void {
		this.targets.dispose(); this.meshes.dispose(); this.backend.gl.deleteProgram(this.program);
	}
}
