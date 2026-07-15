import type {
	ColorAttachmentSpec,
	RenderPassDesc,
	RenderPassStateRegistry,
} from '../backend';
import type { RenderPassLibrary } from '../pass/library';
import type { WebGPUBackend, WebGPUPassEncoder } from './backend';
import {
	GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES,
	GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT,
	GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH,
	GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES,
	GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT,
	GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH,
	GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES,
	GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT,
	GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH,
	writeGxCharacterPlaneCellTexture,
	writeGxCharacterPlaneGlyphTexture,
	writeGxCharacterPlanePaletteTexture,
} from '../../gx/character_plane_resources';
import {
	createGxCharacterPlanePipelineState,
	shouldRenderGxCharacterPlane,
	writeGxCharacterPlanePipelineState,
} from '../../gx/character_plane_state';
import vertexShaderCode from '../../post/webgpu/shaders/fullscreen.vert.wgsl';
import fragmentShaderCode from './shaders/gx_character_plane.wgsl';

export function registerGxCharacterPlanePass(registry: RenderPassLibrary): void {
	const cellPixels = new Uint8Array(GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES);
	const glyphPixels = new Uint8Array(GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES);
	const palettePixels = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES);
	const cellLayout: GPUImageDataLayout = { bytesPerRow: GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH * 4 };
	const cellExtent: GPUExtent3DStrict = { width: GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT };
	const glyphLayout: GPUImageDataLayout = { bytesPerRow: GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH * 4 };
	const glyphExtent: GPUExtent3DStrict = { width: GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT };
	const paletteLayout: GPUImageDataLayout = { bytesPerRow: GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH * 4 };
	const paletteExtent: GPUExtent3DStrict = { width: GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT };
	const colorAttachment = {} as ColorAttachmentSpec;
	const passDesc: RenderPassDesc = { label: 'GXCharacterPlane (WebGPU)', color: colorAttachment };
	let pipeline: GPURenderPipeline;
	let bindGroup: GPUBindGroup;
	let cellCopy: GPUImageCopyTexture;
	let glyphCopy: GPUImageCopyTexture;
	let paletteCopy: GPUImageCopyTexture;
	let cellRevision = 0;
	let glyphRevision = 0;
	let paletteRevision = 0;

	registry.register({
		id: 'gx_character_plane',
		name: 'GXCharacterPlane (WebGPU)',
		stateOnly: true,
		initialState: createGxCharacterPlanePipelineState(registry.view),
		graph: {
			writes: ['frame_color'],
			writeState: (context, state: RenderPassStateRegistry['gx_character_plane']) => {
				writeGxCharacterPlanePipelineState(context, state);
				colorAttachment.tex = context.getTex('frame_color');
			},
		},
		shouldExecute: shouldRenderGxCharacterPlane,
		bootstrap: (backend) => {
			const webgpu = backend as WebGPUBackend;
			const device = webgpu.device;
			const cellTexture = device.createTexture({
				size: { width: GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT },
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			const glyphTexture = device.createTexture({
				size: { width: GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT },
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			const paletteTexture = device.createTexture({
				size: { width: GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH, height: GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT },
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			cellCopy = { texture: cellTexture };
			glyphCopy = { texture: glyphTexture };
			paletteCopy = { texture: paletteTexture };
			const layout = device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
					{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
					{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				],
			});
			pipeline = device.createRenderPipeline({
				label: 'webgpu_gx_character_plane',
				layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
				vertex: {
					module: device.createShaderModule({ code: vertexShaderCode, label: 'webgpu_gx_character_plane_vs' }),
					entryPoint: 'main',
				},
				fragment: {
					module: device.createShaderModule({ code: fragmentShaderCode, label: 'webgpu_gx_character_plane_fs' }),
					entryPoint: 'main',
					targets: [{ format: 'bgra8unorm' }],
				},
				primitive: { topology: 'triangle-list' },
			});
			bindGroup = device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: cellTexture.createView() },
					{ binding: 1, resource: glyphTexture.createView() },
					{ binding: 2, resource: paletteTexture.createView() },
				],
			});
		},
		exec: (backend, _fbo, state: RenderPassStateRegistry['gx_character_plane']) => {
			const webgpu = backend as WebGPUBackend;
			const output = state.output;
			if (cellRevision !== output.cellRevision) {
				writeGxCharacterPlaneCellTexture(output.cellBytes, cellPixels);
				webgpu.device.queue.writeTexture(
					cellCopy,
					cellPixels,
					cellLayout,
					cellExtent,
				);
				webgpu.accountUpload('texture', cellPixels.byteLength);
				cellRevision = output.cellRevision;
			}
			if (glyphRevision !== output.glyphRevision) {
				writeGxCharacterPlaneGlyphTexture(output.glyphBytes, glyphPixels);
				webgpu.device.queue.writeTexture(
					glyphCopy,
					glyphPixels,
					glyphLayout,
					glyphExtent,
				);
				webgpu.accountUpload('texture', glyphPixels.byteLength);
				glyphRevision = output.glyphRevision;
			}
			if (paletteRevision !== output.paletteRevision) {
				writeGxCharacterPlanePaletteTexture(output.paletteBytes, palettePixels);
				webgpu.device.queue.writeTexture(
					paletteCopy,
					palettePixels,
					paletteLayout,
					paletteExtent,
				);
				webgpu.accountUpload('texture', palettePixels.byteLength);
				paletteRevision = output.paletteRevision;
			}
			const pass = webgpu.beginRenderPass(passDesc) as WebGPUPassEncoder;
			pass.encoder.setPipeline(pipeline);
			pass.encoder.setBindGroup(0, bindGroup);
			pass.encoder.draw(3);
			webgpu.endRenderPass(pass);
		},
	});
}
