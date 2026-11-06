import { HostMeshBuffers, HostMeshPositionBuffers, HostMeshSceneTargets, hostMeshReflected, writeHostMeshClipMatrix,
	type HostMesh, type HostMeshScene, type HostMeshTarget } from '../mesh';
import type { RenderPassDesc } from '../../backend/backend';
import type { WebGLBackend } from '../../backend/webgl/backend';
import type { HostBitmapTextures } from '../bitmap';

import vertex from './shaders/host_mesh.vert.glsl';
import fragment from './shaders/host_mesh.frag.glsl';
import texturedFragment from './shaders/host_mesh_textured.frag.glsl';
import gxTexturedFragment from './shaders/host_mesh_gx_textured.frag.glsl';

type MeshBuffers = { vao: WebGLVertexArrayObject; indices: WebGLBuffer | undefined; uvs: WebGLBuffer | undefined; positions: Float32Array; count: number; indexType: number };
export type WebGLHostMeshTarget = HostMeshTarget & { color: WebGLTexture; depth: WebGLTexture; pass: RenderPassDesc };

/** Owned host geometry uploads and a private reversed-depth target for each viewport. */
export class WebGLHostMeshScenes {
	public readonly targets: HostMeshSceneTargets<WebGLHostMeshTarget>;
	private readonly positionBuffers: HostMeshPositionBuffers<WebGLBuffer>;
	private readonly meshes: HostMeshBuffers<MeshBuffers>;
	private readonly programs: { program: WebGLProgram; matrix: WebGLUniformLocation; color: WebGLUniformLocation }[];
	private readonly matrix = new Float32Array(16);
	public constructor(private readonly backend: WebGLBackend, private readonly bitmaps: HostBitmapTextures<WebGLTexture>) {
		const gl = backend.gl;
		this.programs = [fragment, texturedFragment, gxTexturedFragment].map((source, index) => {
			const program = backend.buildProgram(vertex, source, 'host_mesh');
			backend.useProgram(program);
			if (index !== 0) gl.uniform1i(gl.getUniformLocation(program, 'bitmap'), 0);
			return { program, matrix: gl.getUniformLocation(program, 'clip_from_model'), color: gl.getUniformLocation(program, 'color') };
		});
		this.positionBuffers = new HostMeshPositionBuffers(
			positions => backend.createVertexBuffer(positions, 'static'), buffer => backend.destroyBuffer(buffer));
		this.meshes = new HostMeshBuffers(mesh => this.createMesh(mesh), mesh => {
			backend.deleteVertexArray(mesh.vao);
			if (mesh.indices !== undefined) backend.destroyBuffer(mesh.indices);
			if (mesh.uvs !== undefined) backend.destroyBuffer(mesh.uvs);
			this.positionBuffers.release(mesh.positions);
		});
		this.targets = new HostMeshSceneTargets((width, height) => {
			const color = backend.createColorTexture({ width, height, format: gl.RGBA8 }) as WebGLTexture;
			const depth = backend.createDepthTexture({ width, height, format: 'depth32float' });
			return { width, height, color, depth, pass: { label: 'host_mesh', color: { tex: color, clear: [0, 0, 0, 0] }, depth: { tex: depth, clearDepth: 0 } } };
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
		let uvs: WebGLBuffer | undefined;
		if (mesh.texture !== undefined) {
			uvs = backend.createVertexBuffer(mesh.texture.uvs, 'static'); backend.bindArrayBuffer(uvs);
			gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
		}
		let indices: WebGLBuffer | undefined;
		if (mesh.indices !== undefined) {
			indices = gl.createBuffer()!;
			backend.bindElementArrayBuffer(indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
			backend.accountUpload('index', mesh.indices.byteLength);
		}
		backend.bindVertexArray(null);
		return { vao, indices, uvs, positions: mesh.positions, count: mesh.drawCount,
			indexType: mesh.indexComponentType === 5121 ? gl.UNSIGNED_BYTE : mesh.indexComponentType === 5123 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT };
	}
	private render(target: WebGLHostMeshTarget, scene: HostMeshScene): void {
		const backend = this.backend, gl = backend.gl;
		gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
		backend.setDepthMask(true); backend.setDepthTestEnabled(true);
		backend.setBlendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		const pass = backend.beginRenderPass(target.pass);
		backend.setViewportRect(0, 0, target.width, target.height);
		for (const instance of scene.instances) {
			const mesh = instance.mesh, geometry = this.meshes.get(mesh);
			const program = this.programs[mesh.shader]; backend.useProgram(program.program);
			backend.setDepthFunc(mesh.layered ? gl.GEQUAL : gl.GREATER); backend.setBlendEnabled(mesh.layered);
			backend.setDepthMask(!mesh.layered);
			writeHostMeshClipMatrix(this.matrix, scene, instance);
			gl.uniformMatrix4fv(program.matrix, false, this.matrix);
			gl.uniform4f(program.color, mesh.red, mesh.green, mesh.blue, mesh.alpha);
			if (mesh.texture !== undefined) {
				const bitmap = this.bitmaps.get(mesh.texture.bitmap);
				backend.setActiveTexture(0); backend.bindTexture2D(bitmap);
			}
			backend.setCullEnabled(!mesh.doubleSided); gl.frontFace(hostMeshReflected(instance) ? gl.CW : gl.CCW);
			backend.bindVertexArray(geometry.vao);
			if (geometry.indices === undefined) backend.draw(pass, 0, geometry.count);
			else backend.drawIndexed(pass, geometry.count, 0, geometry.indexType);
		}
		backend.bindVertexArray(null); gl.frontFace(gl.CCW);
		backend.endRenderPass(pass);
	}
	public dispose(): void {
		this.targets.dispose(); this.meshes.dispose(); for (const { program } of this.programs) this.backend.gl.deleteProgram(program);
	}
}
