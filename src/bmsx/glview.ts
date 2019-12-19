import { view, model } from "./engine";
import { Size, Point } from "./common";
import { BaseView, Color, DrawImgFlags } from './view';

var m3 = {
	multiply: function (a, b) {
		var a00 = a[0 * 3 + 0];
		var a01 = a[0 * 3 + 1];
		var a02 = a[0 * 3 + 2];
		var a10 = a[1 * 3 + 0];
		var a11 = a[1 * 3 + 1];
		var a12 = a[1 * 3 + 2];
		var a20 = a[2 * 3 + 0];
		var a21 = a[2 * 3 + 1];
		var a22 = a[2 * 3 + 2];
		var b00 = b[0 * 3 + 0];
		var b01 = b[0 * 3 + 1];
		var b02 = b[0 * 3 + 2];
		var b10 = b[1 * 3 + 0];
		var b11 = b[1 * 3 + 1];
		var b12 = b[1 * 3 + 2];
		var b20 = b[2 * 3 + 0];
		var b21 = b[2 * 3 + 1];
		var b22 = b[2 * 3 + 2];

		return [
			b00 * a00 + b01 * a10 + b02 * a20,
			b00 * a01 + b01 * a11 + b02 * a21,
			b00 * a02 + b01 * a12 + b02 * a22,
			b10 * a00 + b11 * a10 + b12 * a20,
			b10 * a01 + b11 * a11 + b12 * a21,
			b10 * a02 + b11 * a12 + b12 * a22,
			b20 * a00 + b21 * a10 + b22 * a20,
			b20 * a01 + b21 * a11 + b22 * a21,
			b20 * a02 + b21 * a12 + b22 * a22,
		];
	},
	translation: function (tx, ty) {
		return [
			1, 0, 0,
			0, 1, 0,
			tx, ty, 1,
		];
	},

	rotation: function (angleInRadians) {
		var c = Math.cos(angleInRadians);
		var s = Math.sin(angleInRadians);
		return [
			c, -s, 0,
			s, c, 0,
			0, 0, 1,
		];
	},

	scaling: function (sx, sy) {
		return [
			sx, 0, 0,
			0, sy, 0,
			0, 0, 1,
		];
	},

};

var m4 = {
	translation: function (tx: number, ty: number, tz: number) {
		return [
			1, 0, 0, 0,
			0, 1, 0, 0,
			0, 0, 1, 0,
			tx, ty, tz, 1,
		];
	},

	xRotation: function (angleInRadians: number) {
		var c = Math.cos(angleInRadians);
		var s = Math.sin(angleInRadians);

		return [
			1, 0, 0, 0,
			0, c, s, 0,
			0, -s, c, 0,
			0, 0, 0, 1,
		];
	},

	yRotation: function (angleInRadians: number) {
		var c = Math.cos(angleInRadians);
		var s = Math.sin(angleInRadians);

		return [
			c, 0, -s, 0,
			0, 1, 0, 0,
			s, 0, c, 0,
			0, 0, 0, 1,
		];
	},

	zRotation: function (angleInRadians: number) {
		var c = Math.cos(angleInRadians);
		var s = Math.sin(angleInRadians);

		return [
			c, s, 0, 0,
			-s, c, 0, 0,
			0, 0, 1, 0,
			0, 0, 0, 1,
		];
	},

	scaling: function (sx: number, sy: number, sz: number) {
		return [
			sx, 0, 0, 0,
			0, sy, 0, 0,
			0, 0, sz, 0,
			0, 0, 0, 1,
		];
	},

	multiply: function (a, b) {
		var b00 = b[0 * 4 + 0];
		var b01 = b[0 * 4 + 1];
		var b02 = b[0 * 4 + 2];
		var b03 = b[0 * 4 + 3];
		var b10 = b[1 * 4 + 0];
		var b11 = b[1 * 4 + 1];
		var b12 = b[1 * 4 + 2];
		var b13 = b[1 * 4 + 3];
		var b20 = b[2 * 4 + 0];
		var b21 = b[2 * 4 + 1];
		var b22 = b[2 * 4 + 2];
		var b23 = b[2 * 4 + 3];
		var b30 = b[3 * 4 + 0];
		var b31 = b[3 * 4 + 1];
		var b32 = b[3 * 4 + 2];
		var b33 = b[3 * 4 + 3];
		var a00 = a[0 * 4 + 0];
		var a01 = a[0 * 4 + 1];
		var a02 = a[0 * 4 + 2];
		var a03 = a[0 * 4 + 3];
		var a10 = a[1 * 4 + 0];
		var a11 = a[1 * 4 + 1];
		var a12 = a[1 * 4 + 2];
		var a13 = a[1 * 4 + 3];
		var a20 = a[2 * 4 + 0];
		var a21 = a[2 * 4 + 1];
		var a22 = a[2 * 4 + 2];
		var a23 = a[2 * 4 + 3];
		var a30 = a[3 * 4 + 0];
		var a31 = a[3 * 4 + 1];
		var a32 = a[3 * 4 + 2];
		var a33 = a[3 * 4 + 3];
		return [
			b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30,
			b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31,
			b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32,
			b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33,
			b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30,
			b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31,
			b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32,
			b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33,
			b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30,
			b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31,
			b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32,
			b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33,
			b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30,
			b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31,
			b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32,
			b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33,
		];
	},

	translate: function (m: number[], tx: number, ty: number, tz: number): number[] {
		return m4.multiply(m, m4.translation(tx, ty, tz));
	// translate: function (m: number[], x: number, y: number): void {
		// m[12] = m[0] * x + m[4] * y + m[8];
		// m[13] = m[1] * x + m[5] * y + m[9];
		// m[14] = m[2] * x + m[6] * y + m[10];
		// m[15] = m[3] * x + m[7] * y + m[11];
	},

	xRotate: function (m, angleInRadians) {
		return m4.multiply(m, m4.xRotation(angleInRadians));
	},

	yRotate: function (m, angleInRadians) {
		return m4.multiply(m, m4.yRotation(angleInRadians));
	},

	zRotate: function (m, angleInRadians) {
		return m4.multiply(m, m4.zRotation(angleInRadians));
	},

	scale: function (m, sx, sy, sz) {
		return m4.multiply(m, m4.scaling(sx, sy, sz));
	// scale2d: function (m: number[], x: number, y: number): void {
		// m[0] = m[0] * x;
		// m[1] = m[1] * x;
		// m[2] = m[2] * x;
		// m[3] = m[3] * x;
		// m[4] = m[4] * y;
		// m[5] = m[5] * y;
		// m[6] = m[6] * y;
		// m[7] = m[7] * y;
	},

	projection: function (width, height, depth) {
		// Note: This matrix flips the Y axis so 0 is at the top.
		return [
			2 / width, 0, 0, 0,
			0, -2 / height, 0, 0,
			0, 0, 2 / depth, 0,
			-1, 1, 0, 1,
		];
	},

	orthographic: function (m: Float32Array, left, right, bottom, top, near, far): void {
		m[0] = 2 / (right - left);
		m[1] = 0;
		m[2] = 0;
		m[3] = 0;
		m[4] = 0;
		m[5] = 2 / (top - bottom);
		m[6] = 0;
		m[7] = 0;
		m[8] = 0;
		m[9] = 0;
		m[10] = 2 / (near - far);
		m[11] = 0;
		m[12] = (left + right) / (left - right);
		m[13] = (bottom + top) / (bottom - top);
		m[14] = (near + far) / (near - far);
		m[15] = 1;

		// return [
		// 	2 / (right - left), 0, 0, 0,
		// 	0, 2 / (top - bottom), 0, 0,
		// 	0, 0, 2 / (near - far), 0,

		// 	(left + right) / (left - right),
		// 	(bottom + top) / (bottom - top),
		// 	(near + far) / (near - far),
		// 	1,
		// ];
	},

	set: function(outm: Float32Array, inm: Float32Array) {
		for (let i = 0; i < outm.length; i++) outm[i] = inm[i];
	},

	translate_scale2d: function (m: Float32Array, tx: number, ty: number, sx: number, sy: number) {
		m[12] = m[0] * tx + m[4] * ty + m[8] + m[12];
		m[13] = m[1] * tx + m[5] * ty + m[9] + m[13];
		m[14] = m[2] * tx + m[6] * ty + m[10] + m[14];
		m[15] = m[3] * tx + m[7] * ty + m[11] + m[15];

		m[0] = m[0] * sx;
		m[1] = m[1] * sx;
		m[2] = m[2] * sx;
		m[3] = m[3] * sx;
		m[4] = m[4] * sy;
		m[5] = m[5] * sy;
		m[6] = m[6] * sy;
		m[7] = m[7] * sy;
	}

};

interface TextureInfo { width: number, height: number, texture: WebGLTexture; };

export abstract class GLView extends BaseView {
	public glctx: WebGLRenderingContext;
	private textures: { [key: number]: TextureInfo; };

	private program: WebGLProgram;
	private positionLocation: number;
	private texcoordLocation: number;
	private matrixLocation: WebGLUniformLocation;
	private textureLocation: WebGLUniformLocation;
	private positionBuffer: WebGLBuffer;
	private texcoordBuffer: WebGLBuffer;
	private basematrix: Float32Array = new Float32Array(16);
	private gonutsmatrix: Float32Array = new Float32Array(16);

	private readonly vertexShaderCode =
		`
		precision lowp float;
		attribute vec4 a_position;
		attribute vec2 a_texcoord;

		uniform mat4 u_matrix;

		varying vec2 v_texcoord;

		void main() {
			gl_Position = u_matrix * a_position;
			v_texcoord = a_texcoord;
		}`;

	private readonly fragmentShaderFillRectangleCode =
		`
			precision lowp float;

			uniform vec4 uColor;

			void main() {
				gl_FragColor = uColor;
			}`;

	private readonly fragmentShaderTextureCode =
		`
		precision lowp float;
 		varying vec2 v_texcoord;
 		uniform sampler2D u_texture;

		void main() {
			gl_FragColor = texture2D(u_texture, v_texcoord);
		}`;

	constructor(viewportsize: Size) {
		super(viewportsize);
		this.glctx = this.canvas.getContext('webgl', { alpha: false });
	}

	public init(): void {
		super.init();
		let gl = this.glctx;
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);
		// setup GLSL program
		this.program = gl.createProgram();
		let vertShader = this.loadShader(gl.VERTEX_SHADER, this.vertexShaderCode);
		let fragShader = this.loadShader(gl.FRAGMENT_SHADER, this.fragmentShaderTextureCode);
		if (!vertShader || !fragShader) return;

		gl.attachShader(this.program, vertShader);
		gl.attachShader(this.program, fragShader);
		gl.linkProgram(this.program);

		// look up where the vertex data needs to go
		this.positionLocation = gl.getAttribLocation(this.program, "a_position");
		this.texcoordLocation = gl.getAttribLocation(this.program, "a_texcoord");

		// lookup uniforms
		this.matrixLocation = gl.getUniformLocation(this.program, "u_matrix");
		this.textureLocation = gl.getUniformLocation(this.program, "u_texture");

		// Create a buffer.
		this.positionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

		// Put a unit quad in the buffer
		let positions = [
			0, 0,
			0, 1,
			1, 0,
			1, 0,
			0, 1,
			1, 1,
		];
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

		// Create a buffer for texture coords
		this.texcoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);

		// Put texcoords in the buffer
		let texcoords = [
			0, 0,
			0, 1,
			1, 0,
			1, 0,
			0, 1,
			1, 1,
		];
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);

		// Tell WebGL to use our shader program pair
		gl.useProgram(this.program);

		// Setup the attributes to pull data from our buffers
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.enableVertexAttribArray(this.positionLocation);
		gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
		gl.enableVertexAttribArray(this.texcoordLocation);
		gl.vertexAttribPointer(this.texcoordLocation, 2, gl.FLOAT, false, 0, 0);

		// this matrix will convert from pixels to clip space
		m4.orthographic(this.basematrix, 0, gl.canvas.width, gl.canvas.height, 0, -1, 1);
		m4.orthographic(this.gonutsmatrix, 0, gl.canvas.width, gl.canvas.height, 0, -1, 1);

		// Tell the shader to get the texture from texture unit 0
		gl.uniform1i(this.textureLocation, 0);

		this.textures = {};
		for (const [id, img] of Object.entries(BaseView.images)) {
			if (!img) continue;
			this.textures[id] = this.createTexture(img);
		}
	}

	private loadShader(type: number, source: string): WebGLShader {
		let gl = this.glctx;
		const shader = gl.createShader(type);

		// Send the source to the shader object
		gl.shaderSource(shader, source);

		// Compile the shader program
		gl.compileShader(shader);

		// See if it compiled successfully
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}

		return shader;
	}

	private createTexture(img: HTMLImageElement): TextureInfo {
		let gl = this.glctx;

		let tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		// let's assume all images are not a power of 2
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

		return {
			width: img.width,
			height: img.height,
			texture: tex,
		};
	}

	public handleResize(): void {
		super.handleResize();
		let _this = view as GLView;
		m4.orthographic(_this.basematrix, 0, _this.canvas.width, _this.canvas.height, 0, -1, 1);
	}

	public drawgame(gamescreenOffset?: Point, clearCanvas: boolean = true): void {
		super.drawgame(gamescreenOffset, clearCanvas);
	}

	public clear(): void {
		let gl = this.glctx;
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	public drawImg(imgid: number, x: number, y: number, options?: number): void {
		// let img = BaseView.images[imgid];
		let _this = view as GLView;
		let gl = _this.glctx;
		let tex = _this.textures[imgid];
		gl.bindTexture(gl.TEXTURE_2D, tex.texture);

		// this matrix will scale our 1 unit quad
		// from 1 unit to texWidth, texHeight units
		let flipx = (options & DrawImgFlags.HFLIP) ? -1 : 1;
		let flipy = (options & DrawImgFlags.VFLIP) ? -1 : 1;
		let dx = (options & DrawImgFlags.HFLIP) ? tex.width : 0;
		let dy = (options & DrawImgFlags.VFLIP) ? tex.height : 0;
		// this matrix will translate our quad to dstX, dstY
		// Do the Boaz matrix translate and scale based
		m4.set(_this.gonutsmatrix, _this.basematrix);
		m4.translate_scale2d(_this.gonutsmatrix, x + dx, y + dy, tex.width * flipx, tex.height * flipy);

		// let matrix = m4.translate(_this.basematrix, x + dx, y + dy, 0);
		// matrix = m4.scale(matrix, tex.width * flipx, tex.height * flipy, 1);

		// Set the matrix.
		gl.uniformMatrix4fv(_this.matrixLocation, false, _this.gonutsmatrix);

		// draw the quad (2 triangles, 6 vertices)
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	public drawColoredBitmap(imgid: number, x: number, y: number, options: number, r: boolean = true, g: boolean = true, b: boolean = true, a: boolean = true) {
		let _this = view as GLView;
		_this.glctx.colorMask(r, g, b, a);
		view.drawImg(imgid, x, y, options);
		_this.glctx.colorMask(true, true, true, true);
	}

	public drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
	}

	public fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
		// let _this = view as GLView;
		// let gl = _this.glctx;

		// // Tell WebGL to use our shader program pair
		// gl.useProgram(_this.program);

		// // Setup the attributes to pull data from our buffers
		// gl.bindBuffer(gl.ARRAY_BUFFER, _this.positionBuffer);
		// gl.enableVertexAttribArray(_this.positionLocation);
		// gl.vertexAttribPointer(_this.positionLocation, 2, gl.FLOAT, false, 0, 0);

		// var positions = [
		// 	0, 0,
		// 	0, 0.5,
		// 	0.7, 0,
		// ];
		// gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);


		// // gl.drawElements(gl.LINES, given_animal.vertex_indices_buffer.numItems, gl.UNSIGNED_SHORT, 0);
		// gl.lineWidth(1);
	}


	// private bla() {
	// 	// Get A WebGL context
	// 	var canvas = document.getElementById("c");
	// 	var gl = canvas.getContext("webgl");
	// 	if (!gl) {
	// 		return;
	// 	}

	// 	// Get the strings for our GLSL shaders
	// 	var vertexShaderSource = document.getElementById("2d-vertex-shader").text;
	// 	var fragmentShaderSource = document.getElementById("2d-fragment-shader").text;

	// 	// create GLSL shaders, upload the GLSL source, compile the shaders
	// 	var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	// 	var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

	// 	// Link the two shaders into a program
	// 	var program = createProgram(gl, vertexShader, fragmentShader);

	// 	// look up where the vertex data needs to go.
	// 	var positionAttributeLocation = gl.getAttribLocation(program, "a_position");

	// 	// Create a buffer and put three 2d clip space points in it
	// 	var positionBuffer = gl.createBuffer();

	// 	// Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
	// 	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

	// 	var positions = [
	// 		0, 0,
	// 		0.5, 0,
	// 		0.5, 0.5,
	// 		0, 0.5,
	// 		0, 0,
	// 	];
	// 	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

	// 	// code above this line is initialization code.
	// 	// code below this line is rendering code.

	// 	webglUtils.resizeCanvasToDisplaySize(gl.canvas);

	// 	// Tell WebGL how to convert from clip space to pixels
	// 	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

	// 	// Clear the canvas
	// 	gl.clearColor(0, 0, 0, 0);
	// 	gl.clear(gl.COLOR_BUFFER_BIT);

	// 	// Tell it to use our program (pair of shaders)
	// 	gl.useProgram(program);

	// 	// Turn on the attribute
	// 	gl.enableVertexAttribArray(positionAttributeLocation);

	// 	// Bind the position buffer.
	// 	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

	// 	// Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
	// 	var size = 2;          // 2 components per iteration
	// 	var type = gl.FLOAT;   // the data is 32bit floats
	// 	var normalize = false; // don't normalize the data
	// 	var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
	// 	var offset = 0;        // start at the beginning of the buffer
	// 	gl.vertexAttribPointer(
	// 		positionAttributeLocation, size, type, normalize, stride, offset);

	// 	// draw
	// 	var primitiveType = gl.TRIANGLE_STRIP;
	// 	var offset = 0;
	// 	var count = 5;
	// 	gl.drawArrays(primitiveType, offset, count);
	// }
}
