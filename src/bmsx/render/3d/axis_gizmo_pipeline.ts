import { $ } from '../../core/engine';
import axisFS from './shaders/axis_gizmo.frag.glsl';
import axisVS from './shaders/axis_gizmo.vert.glsl';
import { RenderPassLibrary } from '../backend/pass/library';
import type { color } from '../shared/submissions';
import { M4 } from './math';
import { WebGLBackend } from '../backend/webgl/backend';
import { clamp } from '../../common/clamp';
import { resolveActiveCamera3D } from '../shared/hardware/camera';

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

const AXIS_VERTEX_COUNT = 6;
const AXIS_GIZMO_SIZE = 0.15;
const AXIS_LABEL_MARGIN_PX = 24;
const AXIS_LABEL_SPACING_PX = 56;
const AXIS_LABEL_PAD_PX = 8;
const AXIS_LABEL_INSET_PX = 6;
const AXIS_VERTEX_STRIDE = 6 * 4;
const AXIS_VERTEX_DATA = new Float32Array([
	0, 0, 0, 1, 0, 0,
	1, 0, 0, 1, 0, 0,
	0, 0, 0, 0, 1, 0,
	0, 1, 0, 0, 1, 0,
	0, 0, 0, 0, 0, 1,
	0, 0, 1, 0, 0, 1,
]);
const axisInvRot = new Float32Array(16);
const AXIS_LABEL_X_COLOR: color = { r: 1, g: 0, b: 0, a: 1 };
const AXIS_LABEL_Y_COLOR: color = { r: 0, g: 1, b: 0, a: 1 };
const AXIS_LABEL_Z_COLOR: color = { r: 0, g: 0, b: 1, a: 1 };
const AXIS_LABEL_R_COLOR: color = { r: 1, g: 0.5, b: 0.5, a: 1 };
const AXIS_LABEL_U_COLOR: color = { r: 0.5, g: 1, b: 0.5, a: 1 };
const AXIS_LABEL_F_COLOR: color = { r: 0.5, g: 0.5, b: 1, a: 1 };

function axisLabelScale(depth: number): number {
	return 0.70 + 0.30 * clamp(depth, -1, 1);
}

function axisNdcToPixelX(x: number, width: number): number {
	return (x + 1) * 0.5 * width;
}

function axisNdcToPixelY(y: number, height: number): number {
	return (1 - y) * 0.5 * height;
}

function drawAxisLabel(px: number, py: number, letter: string, col: color, scale: number): void {
	const font = $.view.default_font;
	const imgid = font.char_to_img(letter);
	$.view.renderer.submit.sprite({ imgid, pos: { x: Math.round(px), y: Math.round(py), z: 999 }, scale: { x: scale, y: scale }, flip: { flip_h: false, flip_v: false }, colorize: col, layer: 'ui' });
}

function placeAxisLabel(originX: number, originY: number, vx: number, vy: number, letter: string, col: color, scale: number, aspect: number, width: number, height: number): void {
	const tipX = originX + (vx / aspect) * AXIS_GIZMO_SIZE;
	const tipY = originY + vy * AXIS_GIZMO_SIZE;
	const originPixelX = axisNdcToPixelX(originX, width);
	const originPixelY = axisNdcToPixelY(originY, height);
	const tipPixelX = axisNdcToPixelX(tipX, width);
	const tipPixelY = axisNdcToPixelY(tipY, height);
	let dx = tipPixelX - originPixelX;
	let dy = tipPixelY - originPixelY;
	const length = Math.hypot(dx, dy) || 1;
	dx /= length;
	dy /= length;
	const x = clamp(tipPixelX + dx * AXIS_LABEL_PAD_PX, AXIS_LABEL_INSET_PX, width - AXIS_LABEL_INSET_PX);
	const y = clamp(tipPixelY + dy * AXIS_LABEL_PAD_PX, AXIS_LABEL_INSET_PX, height - AXIS_LABEL_INSET_PX);
	drawAxisLabel(x, y, letter, col, scale);
}

function initAxisGizmoPipeline(gl: WebGL2RenderingContext): void {
	vao = gl.createVertexArray();
	vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, AXIS_VERTEX_DATA, gl.STATIC_DRAW);

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
	gl.enableVertexAttribArray(posLoc);
	gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, AXIS_VERTEX_STRIDE, 0);
	gl.enableVertexAttribArray(colLoc);
	gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, AXIS_VERTEX_STRIDE, 3 * 4);
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
			initAxisGizmoPipeline(gl);
		},
		shouldExecute: () => enabled && !!resolveActiveCamera3D(),
		exec: (backend, _fbo, _s) => {
			const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
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
			gl.uniform1f(uSizeLoc, AXIS_GIZMO_SIZE);
			// Screen size in pixels
			const w = gv.viewportSize.x; const h = gv.viewportSize.y;
			// Place gizmo with pixel-based margin to keep labels visible
			const dxNDC = (AXIS_LABEL_MARGIN_PX / Math.max(1, w)) * 2.0;
			const dyNDC = (AXIS_LABEL_MARGIN_PX / Math.max(1, h)) * 2.0;
			// Top-right corner, moved inward by pixel margin
			const offsetX = 1.0 - dxNDC;
			const offsetY = 1.0 - dyNDC;
			gl.uniform2f(uOffsetLoc, offsetX, offsetY);

			gl.drawArrays(gl.LINES, 0, AXIS_VERTEX_COUNT);

			// --- Camera-axes gizmo (R/U/F) next to world gizmo ---
			// Compute a leftward offset in NDC so gizmos sit side-by-side
			const spacingNDC = (AXIS_LABEL_SPACING_PX / Math.max(1, w)) * 2.0;
			const offset2X = offsetX - spacingNDC;
			const offset2Y = offsetY;

			// Inverse rotation (transpose of view's 3x3) to express camera axes in world frame
			M4.skyboxFromViewInto(axisInvRot, view);
			// Flip third column so Z axis represents camera Forward (+Z_cam)
			axisInvRot[8] = -axisInvRot[8]; axisInvRot[9] = -axisInvRot[9]; axisInvRot[10] = -axisInvRot[10];
			gl.uniformMatrix4fv(uViewLoc, false, axisInvRot);
			gl.uniform2f(uOffsetLoc, offset2X, offset2Y);
			gl.drawArrays(gl.LINES, 0, AXIS_VERTEX_COUNT);

			placeAxisLabel(offsetX, offsetY, view[0], view[1], 'X', AXIS_LABEL_X_COLOR, axisLabelScale(axisInvRot[8]), aspect, w, h);
			placeAxisLabel(offsetX, offsetY, view[4], view[5], 'Y', AXIS_LABEL_Y_COLOR, axisLabelScale(axisInvRot[9]), aspect, w, h);
			placeAxisLabel(offsetX, offsetY, view[8], view[9], 'Z', AXIS_LABEL_Z_COLOR, axisLabelScale(axisInvRot[10]), aspect, w, h);

			placeAxisLabel(offset2X, offset2Y, axisInvRot[0], axisInvRot[1], 'R', AXIS_LABEL_R_COLOR, axisLabelScale(axisInvRot[8]), aspect, w, h);
			placeAxisLabel(offset2X, offset2Y, axisInvRot[4], axisInvRot[5], 'U', AXIS_LABEL_U_COLOR, axisLabelScale(axisInvRot[9]), aspect, w, h);
			placeAxisLabel(offset2X, offset2Y, axisInvRot[8], axisInvRot[9], 'F', AXIS_LABEL_F_COLOR, axisLabelScale(axisInvRot[10]), aspect, w, h);

			// Restore state
			if (prevCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
			if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
			gl.depthMask(prevDepthMask);

			gl.bindVertexArray(null);
		},
	});
}
