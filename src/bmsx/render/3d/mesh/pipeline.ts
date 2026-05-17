import { consoleCore } from '../../../core/console';
import {
	VDP_MDU_CONTROL_TEXTURE_ENABLE,
	VDP_MDU_CONTROL_TEXTURE_SLOT_MASK,
	VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from '../../../machine/devices/vdp/contracts';
import type { Runtime } from '../../../machine/runtime/runtime';
import { SYSTEM_SLOT_TEXTURE_KEY, VDP_PRIMARY_SLOT_TEXTURE_KEY, VDP_SECONDARY_SLOT_TEXTURE_KEY } from '../../../rompack/format';
import type { GameView } from '../../gameview';
import type { MeshPipelineState, PassEncoder, TextureHandle } from '../../backend/backend';
import { RenderPassLibrary } from '../../backend/pass/library';
import type { WebGLBackend } from '../../backend/webgl/backend';
import { TEXTURE_UNIT_TEXTPAGE_PRIMARY } from '../../backend/webgl/constants';
import { buildLightingDescriptorPooled, resetLightingDescriptorPools } from '../../lighting/system';
import meshFS from '../shaders/mesh.frag.glsl';
import meshVS from '../shaders/mesh.vert.glsl';
import { resolveMeshRomDrawSource } from './rom_source';
import {
	MESH_COLOR_OFFSET,
	MESH_GLES2_SURFACE_BLEND,
	MESH_NORMAL_OFFSET,
	MESH_POSITION_OFFSET,
	MESH_UV_OFFSET,
	MESH_VERTEX_BYTES,
	MESH_VERTEX_FLOATS,
	MeshVertexStreamBuilder,
	type ResolvedMeshMaterial,
} from './vertex_stream';

const MESH_TEXTURE_UNIT = TEXTURE_UNIT_TEXTPAGE_PRIMARY;
const meshVertexStream = new MeshVertexStreamBuilder();
const meshCameraPosition = new Float32Array(3);
const meshAmbient = new Float32Array(4);
const meshEmissive = new Float32Array(3);
const meshPassEncoder: PassEncoder = { fbo: null, desc: { label: 'mesh' } };

let meshProgram: WebGLProgram;
let meshVao: WebGLVertexArrayObject;
let meshVertexBuffer: WebGLBuffer;
let meshPositionLocation = -1;
let meshNormalLocation = -1;
let meshUvLocation = -1;
let meshColorLocation = -1;
let meshModelLocation: WebGLUniformLocation;
let meshNormalMatrixLocation: WebGLUniformLocation;
let meshViewProjectionLocation: WebGLUniformLocation;
let meshCameraPositionLocation: WebGLUniformLocation;
let meshTextureLocation: WebGLUniformLocation;
let meshUseTextureLocation: WebGLUniformLocation;
let meshAmbientLocation: WebGLUniformLocation;
let meshDirectionalLightCountLocation: WebGLUniformLocation;
let meshDirectionalLightDirectionLocation: WebGLUniformLocation;
let meshDirectionalLightColorLocation: WebGLUniformLocation;
let meshDirectionalLightIntensityLocation: WebGLUniformLocation;
let meshPointLightCountLocation: WebGLUniformLocation;
let meshPointLightPositionLocation: WebGLUniformLocation;
let meshPointLightColorLocation: WebGLUniformLocation;
let meshPointLightParamsLocation: WebGLUniformLocation;
let meshSurfaceLocation: WebGLUniformLocation;
let meshAlphaCutoffLocation: WebGLUniformLocation;
let meshMetallicFactorLocation: WebGLUniformLocation;
let meshRoughnessFactorLocation: WebGLUniformLocation;
let meshEmissiveFactorLocation: WebGLUniformLocation;
let meshDoubleSidedLocation: WebGLUniformLocation;
let meshUnlitLocation: WebGLUniformLocation;

function textureForMeshControl(state: MeshPipelineState, control: number): TextureHandle {
	const slot = (control & VDP_MDU_CONTROL_TEXTURE_SLOT_MASK) >>> VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
	switch (slot) {
		case VDP_SLOT_PRIMARY: return state.textpagePrimaryTex;
		case VDP_SLOT_SECONDARY: return state.textpageSecondaryTex;
		case VDP_SLOT_SYSTEM: return state.systemSlotTex;
	}
	throw new Error('[MeshPipeline] VDP mesh packet selected a texture slot outside the VDP slot set.');
}

function uploadMeshFrameUniforms(gl: WebGL2RenderingContext, state: MeshPipelineState): void {
	gl.uniformMatrix4fv(meshViewProjectionLocation, false, state.viewProj);
	const camera = state.cameraPosition;
	meshCameraPosition[0] = camera[0];
	meshCameraPosition[1] = camera[1];
	meshCameraPosition[2] = camera[2];
	gl.uniform3fv(meshCameraPositionLocation, meshCameraPosition);
	const lighting = state.lighting;
	meshAmbient[0] = lighting.ambientColor[0];
	meshAmbient[1] = lighting.ambientColor[1];
	meshAmbient[2] = lighting.ambientColor[2];
	meshAmbient[3] = lighting.ambientIntensity;
	gl.uniform4fv(meshAmbientLocation, meshAmbient);
	gl.uniform1i(meshDirectionalLightCountLocation, lighting.dirCount);
	gl.uniform3fv(meshDirectionalLightDirectionLocation, lighting.dirDirections);
	gl.uniform3fv(meshDirectionalLightColorLocation, lighting.dirColors);
	gl.uniform1fv(meshDirectionalLightIntensityLocation, lighting.dirIntensity);
	gl.uniform1i(meshPointLightCountLocation, lighting.pointCount);
	gl.uniform3fv(meshPointLightPositionLocation, lighting.pointPositions);
	gl.uniform3fv(meshPointLightColorLocation, lighting.pointColors);
	gl.uniform2fv(meshPointLightParamsLocation, lighting.pointParams);
}

function applyMeshMaterialDrawState(backend: WebGLBackend, gl: WebGL2RenderingContext, material: ResolvedMeshMaterial): void {
	gl.uniform1i(meshSurfaceLocation, material.surface);
	gl.uniform1f(meshAlphaCutoffLocation, material.alphaCutoff);
	gl.uniform1f(meshMetallicFactorLocation, material.metallicFactor);
	gl.uniform1f(meshRoughnessFactorLocation, material.roughnessFactor);
	meshEmissive[0] = material.emissive0;
	meshEmissive[1] = material.emissive1;
	meshEmissive[2] = material.emissive2;
	gl.uniform3fv(meshEmissiveFactorLocation, meshEmissive);
	gl.uniform1i(meshDoubleSidedLocation, material.doubleSided ? 1 : 0);
	gl.uniform1i(meshUnlitLocation, material.unlit ? 1 : 0);
	backend.setCullEnabled(!material.doubleSided);
	if (!material.doubleSided) {
		gl.cullFace(gl.BACK);
	}
	if (material.surface === MESH_GLES2_SURFACE_BLEND) {
		backend.setBlendEnabled(true);
		backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		backend.setDepthMask(false);
	} else {
		backend.setBlendEnabled(false);
		backend.setDepthMask(true);
	}
}

function uploadMeshDrawStream(backend: WebGLBackend, gl: WebGL2RenderingContext): void {
	gl.uniformMatrix4fv(meshModelLocation, false, meshVertexStream.modelMatrix);
	gl.uniformMatrix3fv(meshNormalMatrixLocation, false, meshVertexStream.normalMatrix);
	backend.updateVertexBuffer(meshVertexBuffer, meshVertexStream.vertices, 0, 0, meshVertexStream.vertexCount * MESH_VERTEX_FLOATS);
	backend.draw(meshPassEncoder, 0, meshVertexStream.vertexCount);
}

function setupMeshLocations(gl: WebGL2RenderingContext): void {
	const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	if (!current) {
		throw new Error('Mesh shader program not bound during bootstrap');
	}
	meshProgram = current;
	meshPositionLocation = gl.getAttribLocation(meshProgram, 'a_position');
	meshNormalLocation = gl.getAttribLocation(meshProgram, 'a_normal');
	meshUvLocation = gl.getAttribLocation(meshProgram, 'a_uv');
	meshColorLocation = gl.getAttribLocation(meshProgram, 'a_color');
	meshModelLocation = gl.getUniformLocation(meshProgram, 'u_model')!;
	meshNormalMatrixLocation = gl.getUniformLocation(meshProgram, 'u_normalMatrix')!;
	meshViewProjectionLocation = gl.getUniformLocation(meshProgram, 'u_viewProjection')!;
	meshCameraPositionLocation = gl.getUniformLocation(meshProgram, 'u_cameraPosition')!;
	meshTextureLocation = gl.getUniformLocation(meshProgram, 'u_texture')!;
	meshUseTextureLocation = gl.getUniformLocation(meshProgram, 'u_useTexture')!;
	meshAmbientLocation = gl.getUniformLocation(meshProgram, 'u_ambient_color_intensity')!;
	meshDirectionalLightCountLocation = gl.getUniformLocation(meshProgram, 'u_numDirLights')!;
	meshDirectionalLightDirectionLocation = gl.getUniformLocation(meshProgram, 'u_dirLightDirection[0]')!;
	meshDirectionalLightColorLocation = gl.getUniformLocation(meshProgram, 'u_dirLightColor[0]')!;
	meshDirectionalLightIntensityLocation = gl.getUniformLocation(meshProgram, 'u_dirLightIntensity[0]')!;
	meshPointLightCountLocation = gl.getUniformLocation(meshProgram, 'u_numPointLights')!;
	meshPointLightPositionLocation = gl.getUniformLocation(meshProgram, 'u_pointLightPosition[0]')!;
	meshPointLightColorLocation = gl.getUniformLocation(meshProgram, 'u_pointLightColor[0]')!;
	meshPointLightParamsLocation = gl.getUniformLocation(meshProgram, 'u_pointLightParams[0]')!;
	meshSurfaceLocation = gl.getUniformLocation(meshProgram, 'u_surface')!;
	meshAlphaCutoffLocation = gl.getUniformLocation(meshProgram, 'u_alphaCutoff')!;
	meshMetallicFactorLocation = gl.getUniformLocation(meshProgram, 'u_metallicFactor')!;
	meshRoughnessFactorLocation = gl.getUniformLocation(meshProgram, 'u_roughnessFactor')!;
	meshEmissiveFactorLocation = gl.getUniformLocation(meshProgram, 'u_emissiveFactor')!;
	meshDoubleSidedLocation = gl.getUniformLocation(meshProgram, 'u_doubleSided')!;
	meshUnlitLocation = gl.getUniformLocation(meshProgram, 'u_unlit')!;
	gl.uniform1i(meshTextureLocation, MESH_TEXTURE_UNIT);
}

export function initMeshPipeline(backend: WebGLBackend): void {
	const gl = backend.gl;
	meshVao = backend.createVertexArray() as WebGLVertexArrayObject;
	meshVertexBuffer = backend.createVertexBuffer(meshVertexStream.vertices, 'dynamic') as WebGLBuffer;
	setupMeshLocations(gl);
	backend.bindVertexArray(meshVao);
	backend.bindArrayBuffer(meshVertexBuffer);
	gl.enableVertexAttribArray(meshPositionLocation);
	gl.enableVertexAttribArray(meshNormalLocation);
	gl.enableVertexAttribArray(meshUvLocation);
	gl.enableVertexAttribArray(meshColorLocation);
	gl.vertexAttribPointer(meshPositionLocation, 3, gl.FLOAT, false, MESH_VERTEX_BYTES, MESH_POSITION_OFFSET);
	gl.vertexAttribPointer(meshNormalLocation, 3, gl.FLOAT, false, MESH_VERTEX_BYTES, MESH_NORMAL_OFFSET);
	gl.vertexAttribPointer(meshUvLocation, 2, gl.FLOAT, false, MESH_VERTEX_BYTES, MESH_UV_OFFSET);
	gl.vertexAttribPointer(meshColorLocation, 4, gl.FLOAT, false, MESH_VERTEX_BYTES, MESH_COLOR_OFFSET);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
}

export function renderMeshBatch(backend: WebGLBackend, view: GameView, runtime: Runtime, state: MeshPipelineState): void {
	const meshCount = view.vdpMeshCount;
	if (meshCount === 0) {
		return;
	}
	const gl = backend.gl;
	backend.setViewportRect(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(true);
	backend.setDepthFunc(gl.LEQUAL);
	backend.setDepthMask(true);
	backend.setBlendEnabled(false);
	backend.bindVertexArray(meshVao);
	uploadMeshFrameUniforms(gl, state);
	meshPassEncoder.fbo = null;
	for (let entryIndex = 0; entryIndex < meshCount; entryIndex += 1) {
		const source = resolveMeshRomDrawSource(runtime, view, entryIndex);
		meshVertexStream.build(view, source.model, source.mesh, entryIndex);
		const control = view.vdpMeshControl[entryIndex];
		const useTexture = (control & VDP_MDU_CONTROL_TEXTURE_ENABLE) !== 0;
		gl.uniform1i(meshUseTextureLocation, useTexture ? 1 : 0);
		applyMeshMaterialDrawState(backend, gl, meshVertexStream.material);
		if (useTexture) {
			backend.setActiveTexture(MESH_TEXTURE_UNIT);
			backend.bindTexture2D(textureForMeshControl(state, control) as WebGLTexture);
		}
		uploadMeshDrawStream(backend, gl);
	}
	backend.bindVertexArray(null);
	backend.setCullEnabled(false);
	backend.setDepthMask(true);
	backend.setBlendEnabled(false);
}

export function registerMeshPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'mesh',
		name: 'Mesh',
		vsCode: meshVS,
		fsCode: meshFS,
		bindingLayout: {
			uniforms: ['FrameUniforms'],
			textures: [{ name: 'u_texture' }],
			samplers: [{ name: 's_texture' }],
		},
		bootstrap: (backend) => {
			initMeshPipeline(backend as WebGLBackend);
		},
		graph: {
			writes: ['frame_color', 'frame_depth'],
		},
		writesDepth: true,
		depthTest: true,
		shouldExecute: () => consoleCore.view.vdpMeshCount !== 0,
		exec: (backend, _fbo, state) => {
			renderMeshBatch(backend as WebGLBackend, consoleCore.view, consoleCore.runtime, state as MeshPipelineState);
		},
		prepare: (_backend, _state) => {
			const gv = consoleCore.view;
			const frameShared = registry.getState('frame_shared');
			resetLightingDescriptorPools();
			registry.setState('mesh', {
				width: gv.offscreenCanvasSize.x,
				height: gv.offscreenCanvasSize.y,
				viewProj: gv.vdpTransform.viewProj,
				cameraPosition: gv.vdpTransform.eye,
				lighting: buildLightingDescriptorPooled(frameShared.lighting),
				textpagePrimaryTex: gv.textures[VDP_PRIMARY_SLOT_TEXTURE_KEY],
				textpageSecondaryTex: gv.textures[VDP_SECONDARY_SLOT_TEXTURE_KEY],
				systemSlotTex: gv.textures[SYSTEM_SLOT_TEXTURE_KEY],
			});
		},
	});
}
