import type { RenderPassLibrary } from '../pass/library';
import type { RenderPassStateRegistry } from '../backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../texture_params';
import {
	bindFullscreenQuad,
	createFullscreenQuad,
	POST_PROCESS_TEXCOORDS,
	type FullscreenQuad,
	updateFullscreenQuad,
} from './fullscreen_quad';
import type { WebGLBackend } from './backend';
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
import vertexShaderCode from '../../post/webgl/shaders/fullscreen.vert.glsl';
import fragmentShaderCode from './shaders/gx_character_plane.frag.glsl';

const CHARACTER_CELL_TEXTURE_UNIT = 0;
const CHARACTER_GLYPH_TEXTURE_UNIT = 1;
const CHARACTER_PALETTE_TEXTURE_UNIT = 2;

export function registerGxCharacterPlanePass(registry: RenderPassLibrary): void {
	const cellPixels = new Uint8Array(GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES);
	const glyphPixels = new Uint8Array(GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES);
	const palettePixels = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES);
	let cellTexture: WebGLTexture;
	let glyphTexture: WebGLTexture;
	let paletteTexture: WebGLTexture;
	let cellRevision = 0;
	let glyphRevision = 0;
	let paletteRevision = 0;
	let fullscreenQuad: FullscreenQuad;

	registry.register({
		id: 'gx_character_plane',
		name: 'GXCharacterPlane',
		initialState: createGxCharacterPlanePipelineState(registry.view),
		graph: {
			writes: ['frame_color'],
			writeState: writeGxCharacterPlanePipelineState,
		},
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		bootstrap: (backend) => {
			const webgl = backend as WebGLBackend;
			const gl = webgl.gl as WebGL2RenderingContext;
			cellTexture = webgl.createTexture(cellPixels, GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH, GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
			glyphTexture = webgl.createTexture(glyphPixels, GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH, GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
			paletteTexture = webgl.createTexture(palettePixels, GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH, GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
			fullscreenQuad = {
				gl,
				positionBuffer: null,
				texcoordBuffer: null,
				positionAttrib: -1,
				texcoordAttrib: -1,
				width: -1,
				height: -1,
				texcoords: POST_PROCESS_TEXCOORDS,
				label: 'GXCharacterPlane',
			};
			createFullscreenQuad(fullscreenQuad);
		},
		shouldExecute: shouldRenderGxCharacterPlane,
		prepare: (backend, state: RenderPassStateRegistry['gx_character_plane']) => {
			const webgl = backend as WebGLBackend;
			const output = state.output;
			if (cellRevision !== output.cellRevision) {
				writeGxCharacterPlaneCellTexture(output.cellBytes, cellPixels);
				webgl.updateTexture(cellTexture, cellPixels, GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH, GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
				cellRevision = output.cellRevision;
			}
			if (glyphRevision !== output.glyphRevision) {
				writeGxCharacterPlaneGlyphTexture(output.glyphBytes, glyphPixels);
				webgl.updateTexture(glyphTexture, glyphPixels, GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH, GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
				glyphRevision = output.glyphRevision;
			}
			if (paletteRevision !== output.paletteRevision) {
				writeGxCharacterPlanePaletteTexture(output.paletteBytes, palettePixels);
				webgl.updateTexture(paletteTexture, palettePixels, GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH, GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS);
				paletteRevision = output.paletteRevision;
			}
			webgl.setUniform2f('u_resolution', state.width, state.height);
			webgl.setUniform1f('u_scale', 1);
			webgl.setUniform1i('u_character_cells', CHARACTER_CELL_TEXTURE_UNIT);
			webgl.setUniform1i('u_character_glyphs', CHARACTER_GLYPH_TEXTURE_UNIT);
			webgl.setUniform1i('u_character_palette', CHARACTER_PALETTE_TEXTURE_UNIT);
			webgl.setActiveTexture(CHARACTER_CELL_TEXTURE_UNIT);
			webgl.bindTexture2D(cellTexture);
			webgl.setActiveTexture(CHARACTER_GLYPH_TEXTURE_UNIT);
			webgl.bindTexture2D(glyphTexture);
			webgl.setActiveTexture(CHARACTER_PALETTE_TEXTURE_UNIT);
			webgl.bindTexture2D(paletteTexture);
		},
		exec: (backend: WebGLBackend, fbo, state: RenderPassStateRegistry['gx_character_plane']) => {
			const gl = backend.gl as WebGL2RenderingContext;
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo as WebGLFramebuffer);
			backend.setViewportRect(0, 0, state.width, state.height);
			backend.setCullEnabled(false);
			backend.setDepthTestEnabled(false);
			backend.setBlendEnabled(false);
			updateFullscreenQuad(fullscreenQuad, state.width, state.height);
			bindFullscreenQuad(fullscreenQuad, fullscreenQuad.positionAttrib, fullscreenQuad.texcoordAttrib);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		},
	});
}
