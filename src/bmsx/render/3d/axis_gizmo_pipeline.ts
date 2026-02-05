import { $ } from '../../core/engine_core';
import axisFS from './shaders/axis_gizmo.frag.glsl';
import axisVS from './shaders/axis_gizmo.vert.glsl';
import { RenderPassLibrary } from '../backend/renderpasslib';
import type { color } from '../shared/render_types';
import { M4 } from './math3d';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { clamp } from '../../utils/clamp';;
import { resolveActiveCamera3D } from '../shared/hardware_camera';

let vao: WebGLVertexArrayObject = null;
let program: WebGLProgram = null;
let posLoc = -1;
let colLoc = -1;
let uViewLoc: WebGLUniformLocation = null;
let uAspectLoc: WebGLUniformLocation = null;
let uSizeLoc: WebGLUniformLocation = null;
let uOffsetLoc: WebGLUniformLocation = null;
let vbo: WebGLBuffer = null;

let enabled = true;
export function setAxisGizmoEnabled(v: boolean) { enabled = v; }

function init(gl: WebGL2RenderingContext): void {
	vao = gl.createVertexArray();
	// 6 vertices: origin->+X, origin->+Y, origin->+Z with colors
	const data = new Float32Array([
		// x axis (red)
		0, 0, 0, 1, 0, 0,
		1, 0, 0, 1, 0, 0,
		// y axis (green)
		0, 0, 0, 0, 1, 0,
		0, 1, 0, 0, 1, 0,
		// z axis (blue)
		0, 0, 0, 0, 0, 1,
		0, 0, 1, 0, 0, 1,
	]);
	vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

	const backend = $.view.backend as WebGLBackend;
	const prog = backend.buildProgram(axisVS, axisFS, 'axis_gizmo');
	if (!prog) throw Error('Failed to build axis gizmo program');
	program = prog;

	gl.useProgram(program);
	posLoc = gl.getAttribLocation(program, 'a_position');
	colLoc = gl.getAttribLocation(program, 'a_color');
	uViewLoc = gl.getUniformLocation(program, 'u_view');
	uAspectLoc = gl.getUniformLocation(program, 'u_aspect');
	uSizeLoc = gl.getUniformLocation(program, 'u_size');
	uOffsetLoc = gl.getUniformLocation(program, 'u_offset');

	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	const stride = 6 * 4; // 6 floats per vertex
	gl.enableVertexAttribArray(posLoc);
	gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
	gl.enableVertexAttribArray(colLoc);
	gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, stride, 3 * 4);
	gl.bindVertexArray(null);
}

export function registerAxisGizmoPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'axis_gizmo',
		name: 'AxisGizmo',
		vsCode: axisVS,
		fsCode: axisFS,
		// Uses own VAO + GL state; no depth testing/writes
		depthTest: false,
		depthWrite: false,
		bootstrap: (backend) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			init(gl);
		},
		shouldExecute: () => enabled && !!resolveActiveCamera3D(),
		exec: (backend, _fbo, _s) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
			if (!program || !vao) return;
			const cam = resolveActiveCamera3D()!;
			const view = cam.view; // full view; translation ignored via w=0
			const gv = $.view;
			const aspect = gv.offscreenCanvasSize.x / Math.max(1, gv.offscreenCanvasSize.y);

			gl.useProgram(program);
			gl.bindVertexArray(vao);

			// State: overlay style
			const prevCull = gl.getParameter(gl.CULL_FACE);
			const prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
			const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
			gl.disable(gl.CULL_FACE);
			gl.disable(gl.DEPTH_TEST);
			gl.depthMask(false);

			// Uniforms
			gl.uniformMatrix4fv(uViewLoc, false, view);
			gl.uniform1f(uAspectLoc, aspect);
			const size = 0.15; // NDC length
			gl.uniform1f(uSizeLoc, size);
			// Screen size in pixels
			const w = gv.viewportSize.x; const h = gv.viewportSize.y;
			// Place gizmo with pixel-based margin to keep labels visible
			const marginPx = 24; // pixels from right/top edges (tighter to corner)
			const dxNDC = (marginPx / Math.max(1, w)) * 2.0;
			const dyNDC = (marginPx / Math.max(1, h)) * 2.0;
			// Top-right corner, moved inward by pixel margin
			const offsetX = 1.0 - dxNDC;
			const offsetY = 1.0 - dyNDC;
			gl.uniform2f(uOffsetLoc, offsetX, offsetY);

			gl.drawArrays(gl.LINES, 0, 6);

			// --- Camera-axes gizmo (R/U/F) next to world gizmo ---
			// Compute a leftward offset in NDC so gizmos sit side-by-side
			const spacingPx = 56;
			const spacingNDC = (spacingPx / Math.max(1, w)) * 2.0;
			const offset2X = offsetX - spacingNDC;
			const offset2Y = offsetY;

			// Inverse rotation (transpose of view's 3x3) to express camera axes in world frame
			const invRot = new Float32Array(16);
			M4.skyboxFromViewInto(invRot, view);
			// Flip third column so Z axis represents camera Forward (+Z_cam)
			invRot[8] = -invRot[8]; invRot[9] = -invRot[9]; invRot[10] = -invRot[10];
			gl.uniformMatrix4fv(uViewLoc, false, invRot);
			gl.uniform2f(uOffsetLoc, offset2X, offset2Y);
			gl.drawArrays(gl.LINES, 0, 6);

			// Label endpoints using the 2D glyph system (drawn in Sprites pass)
			// w,h already computed above
			const toPixel = (ndc: { x: number; y: number }) => ({
				x: (ndc.x + 1) * 0.5 * w,
				y: (1 - ndc.y) * 0.5 * h,
			});
			const originNDC = { x: offsetX, y: offsetY };
			const endpointNDC = (vx: number, vy: number, ox = offsetX, oy = offsetY) => ({ x: ox + (vx / aspect) * size, y: oy + vy * size });
			const drawLetter = (px: number, py: number, letter: string, col: color, scale: number) => {
				const font = gv.default_font;
				const imgid = font.char_to_img(letter);
				$.view.renderer.submit.sprite({ imgid, pos: { x: Math.round(px), y: Math.round(py), z: 999 }, scale: { x: scale, y: scale }, colorize: col, layer: 'ui' });
			};
			const placeLabel = (vx: number, vy: number, letter: string, col: color, scale: number) => {
				const a = originNDC; const b = endpointNDC(vx, vy, originNDC.x, originNDC.y);
				const pa = toPixel(a); const pb = toPixel(b);
				let dx = pb.x - pa.x, dy = pb.y - pa.y;
				const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
				const pad = 8; // pixels past tip (slightly tighter)
				let lx = pb.x + dx * pad; let ly = pb.y + dy * pad;
				// Clamp labels to screen bounds with a small inset to avoid clipping
				const inset = 6;
				const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
				lx = clamp(lx, inset, w - inset);
				ly = clamp(ly, inset, h - inset);
				drawLetter(lx, ly, letter, col, scale);
			};
			// Use first two rows of view's rotation columns for 2D projection (same as shader)
			// Subtle depth cue: scale letters based on whether that world axis points toward camera
			// Camera forward in world (from invRot after flip):
			const fwd = { x: invRot[8], y: invRot[9], z: invRot[10] };
			const scaleFor = (d: number) => {
				// clamp d to [-1, 1] then map linearly to [0.5, 1.0]:
				// scale = 0.75 + 0.25 * d  -> d=-1 => 0.5, d=1 => 1.0
				const cd = clamp(d, -1, 1);
				return 0.70 + 0.30 * cd;
			};
			placeLabel(view[0], view[1], 'X', { r: 1, g: 0, b: 0, a: 1 }, scaleFor(fwd.x));
			placeLabel(view[4], view[5], 'Y', { r: 0, g: 1, b: 0, a: 1 }, scaleFor(fwd.y));
			placeLabel(view[8], view[9], 'Z', { r: 0, g: 0, b: 1, a: 1 }, scaleFor(fwd.z));

			// Camera axes labels (R, U, F) at the second gizmo origin
			const origin2NDC = { x: offset2X, y: offset2Y };
			const placeLabel2 = (vx: number, vy: number, letter: string, col: color, scale: number) => {
				const a = origin2NDC; const b = endpointNDC(vx, vy, origin2NDC.x, origin2NDC.y);
				const pa = toPixel(a); const pb = toPixel(b);
				let dx = pb.x - pa.x, dy = pb.y - pa.y;
				const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
				const pad = 8;
				let lx = pb.x + dx * pad; let ly = pb.y + dy * pad;
				const inset = 6;
				const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
				lx = clamp(lx, inset, w - inset);
				ly = clamp(ly, inset, h - inset);
				drawLetter(lx, ly, letter, col, scale);
			};
			// invRot columns after flip: [right, up, forward]
			const fwd2 = { x: invRot[8], y: invRot[9], z: invRot[10] };
			placeLabel2(invRot[0], invRot[1], 'R', { r: 1, g: 0.5, b: 0.5, a: 1 }, scaleFor(fwd2.x));
			placeLabel2(invRot[4], invRot[5], 'U', { r: 0.5, g: 1, b: 0.5, a: 1 }, scaleFor(fwd2.y));
			placeLabel2(invRot[8], invRot[9], 'F', { r: 0.5, g: 0.5, b: 1, a: 1 }, scaleFor(fwd2.z));

			// Restore state
			if (prevCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
			if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
			gl.depthMask(prevDepthMask);

			gl.bindVertexArray(null);
		},
	});
}
