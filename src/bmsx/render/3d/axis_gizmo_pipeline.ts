import { consoleCore } from '../../core/console';
import axisFS from './shaders/axis_gizmo.frag.glsl';
import axisVS from './shaders/axis_gizmo.vert.glsl';
import type { color } from '../shared/submissions';
import { WebGLBackend } from '../backend/webgl/backend';
import { clamp } from '../../common/clamp';

let vao: WebGLVertexArrayObject = null;
let program: WebGLProgram = null;
let posLoc = -1;
let colLoc = -1;
let uViewLoc: WebGLUniformLocation = null;
let uAspectLoc: WebGLUniformLocation = null;
let uSizeLoc: WebGLUniformLocation = null;
let uOffsetLoc: WebGLUniformLocation = null;
let vbo: WebGLBuffer = null;

let enabled = false;
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
const AXIS_LABEL_X_COLOR: color = 0xffff0000;
const AXIS_LABEL_Y_COLOR: color = 0xff00ff00;
const AXIS_LABEL_Z_COLOR: color = 0xff0000ff;
const AXIS_LABEL_R_COLOR: color = 0xffff7f7f;
const AXIS_LABEL_U_COLOR: color = 0xff7fff7f;
const AXIS_LABEL_F_COLOR: color = 0xff7f7fff;

type AxisGizmoHostImageSink = (imgid: string, x: number, y: number, z: number, scale: number, color: color) => void;

function axisLabelScale(depth: number): number {
	return 0.70 + 0.30 * clamp(depth, -1, 1);
}

function axisNdcToPixelX(x: number, width: number): number {
	return (x + 1) * 0.5 * width;
}

function axisNdcToPixelY(y: number, height: number): number {
	return (1 - y) * 0.5 * height;
}

function placeAxisLabel(originX: number, originY: number, vx: number, vy: number, letter: string, col: color, scale: number, aspect: number, width: number, height: number, emitHostImage: AxisGizmoHostImageSink): void {
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
	const font = consoleCore.view.default_font;
	emitHostImage(font.char_to_img(letter), x, y, 999, scale, col);
}

export function bootstrapAxisGizmo_WebGL(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	vao = gl.createVertexArray();
	vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, AXIS_VERTEX_DATA, gl.STATIC_DRAW);

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

export function shouldRenderAxisGizmo(): boolean {
	return enabled;
}

export function renderAxisGizmo_WebGL(backend: WebGLBackend, emitHostImage: AxisGizmoHostImageSink): void {
	if (!shouldRenderAxisGizmo()) {
		return;
	}
	if (program === null || vao === null) {
		throw new Error('[AxisGizmo] Pipeline was not bootstrapped.');
	}
	const gl = backend.gl as WebGL2RenderingContext;
	const gv = consoleCore.view;
	const view = gv.vdpTransform.view;
	if (gv.offscreenCanvasSize.y === 0 || gv.viewportSize.x === 0 || gv.viewportSize.y === 0) {
		throw new Error('[AxisGizmo] Viewport size is not initialized.');
	}
	const aspect = gv.offscreenCanvasSize.x / gv.offscreenCanvasSize.y;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setViewportRect(0, 0, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y);
	gl.useProgram(program);
	gl.bindVertexArray(vao);

	const prevCull = gl.getParameter(gl.CULL_FACE);
	const prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
	const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
	gl.disable(gl.CULL_FACE);
	gl.disable(gl.DEPTH_TEST);
	gl.depthMask(false);

	gl.uniformMatrix4fv(uViewLoc, false, view);
	gl.uniform1f(uAspectLoc, aspect);
	gl.uniform1f(uSizeLoc, AXIS_GIZMO_SIZE);
	const w = gv.viewportSize.x;
	const h = gv.viewportSize.y;
	const dxNDC = (AXIS_LABEL_MARGIN_PX / w) * 2.0;
	const dyNDC = (AXIS_LABEL_MARGIN_PX / h) * 2.0;
	const offsetX = 1.0 - dxNDC;
	const offsetY = 1.0 - dyNDC;
	gl.uniform2f(uOffsetLoc, offsetX, offsetY);

	gl.drawArrays(gl.LINES, 0, AXIS_VERTEX_COUNT);

	const spacingNDC = (AXIS_LABEL_SPACING_PX / w) * 2.0;
	const offset2X = offsetX - spacingNDC;
	const offset2Y = offsetY;

	axisInvRot.set(gv.vdpTransform.skyboxView);
	axisInvRot[8] = -axisInvRot[8];
	axisInvRot[9] = -axisInvRot[9];
	axisInvRot[10] = -axisInvRot[10];
	gl.uniformMatrix4fv(uViewLoc, false, axisInvRot);
	gl.uniform2f(uOffsetLoc, offset2X, offset2Y);
	gl.drawArrays(gl.LINES, 0, AXIS_VERTEX_COUNT);

	placeAxisLabel(offsetX, offsetY, view[0], view[1], 'X', AXIS_LABEL_X_COLOR, axisLabelScale(axisInvRot[8]), aspect, w, h, emitHostImage);
	placeAxisLabel(offsetX, offsetY, view[4], view[5], 'Y', AXIS_LABEL_Y_COLOR, axisLabelScale(axisInvRot[9]), aspect, w, h, emitHostImage);
	placeAxisLabel(offsetX, offsetY, view[8], view[9], 'Z', AXIS_LABEL_Z_COLOR, axisLabelScale(axisInvRot[10]), aspect, w, h, emitHostImage);

	placeAxisLabel(offset2X, offset2Y, axisInvRot[0], axisInvRot[1], 'R', AXIS_LABEL_R_COLOR, axisLabelScale(axisInvRot[8]), aspect, w, h, emitHostImage);
	placeAxisLabel(offset2X, offset2Y, axisInvRot[4], axisInvRot[5], 'U', AXIS_LABEL_U_COLOR, axisLabelScale(axisInvRot[9]), aspect, w, h, emitHostImage);
	placeAxisLabel(offset2X, offset2Y, axisInvRot[8], axisInvRot[9], 'F', AXIS_LABEL_F_COLOR, axisLabelScale(axisInvRot[10]), aspect, w, h, emitHostImage);

	if (prevCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
	if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
	gl.depthMask(prevDepthMask);

	gl.bindVertexArray(null);
}
