import { Size, Point } from "./bmsx";
import { BaseView, Color, DrawImgFlags } from './view';

var bvec = {
	set: function (v: Float32Array, x: number, y: number, w: number, h: number, sx: number, sy: number): void {
		// Do the Boaz matrix translate and scale
		let x1 = x;
		let x2 = x + w * sx;
		let y1 = y;
		let y2 = y + h * sy;

		v[0] = x1, v[1] = y1,
			v[2] = x2, v[3] = y1,
			v[4] = x1, v[5] = y2,
			v[6] = x1, v[7] = y2,
			v[8] = x2, v[9] = y1,
			v[10] = x2, v[11] = y2;
	},
	seti: function (v: Float32Array, i: number, x: number, y: number, w: number, h: number): void {
		// Do the Boaz matrix translate and scale
		let x1 = x;
		let x2 = x + w;
		let y1 = y;
		let y2 = y + h;

		v[0 + i] = x1, v[1 + i] = y1,
			v[2 + i] = x2, v[3 + i] = y1,
			v[4 + i] = x1, v[5 + i] = y2,
			v[6 + i] = x1, v[7 + i] = y2,
			v[8 + i] = x2, v[9 + i] = y1,
			v[10 + i] = x2, v[11 + i] = y2;
	},
	uvcoords: function (v: Float32Array, i: number, x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number) {
		const left = x / imageWidth;
		const bottom = y / imageHeight;
		const right = (x + width) / imageWidth;
		const top = (y + height) / imageHeight;

		v[i] = left,
			v[i + 1] = top,
			v[i + 2] = right,
			v[i + 3] = top,
			v[i + 4] = right,
			v[i + 5] = bottom,
			v[i + 6] = left,
			v[i + 7] = bottom;
	},
};

export abstract class GLView extends BaseView {
	public glctx: WebGL2RenderingContext;
	private textures: { [key: number]: WebGLTexture; };

	private program: WebGLProgram;
	private positionLocation: number;
	private texcoordLocation: number;
	private resolutionLocation: WebGLUniformLocation;
	private textureLocation: WebGLUniformLocation;
	private positionBuffer: WebGLBuffer;
	private texcoordBuffer: WebGLBuffer;
	private resVec2: Float32Array = new Float32Array(2);
	private vertexcoords: Float32Array = new Float32Array(12);
	private texcoords: Float32Array = new Float32Array(12);
	private drawImgReqIndex: number = 0;

	private readonly vertexShaderCode =
		`#version 300 es
			precision highp float;

			in vec2 a_position;
			in vec2 a_texcoord;

			uniform vec2 u_resolution;

			out vec2 v_texcoord;

		void main() {
			// convert the rectangle from pixels to 0.0 to 1.0
			vec2 zeroToOne = a_position / u_resolution;

			// convert from 0->1 to 0->2
			vec2 zeroToTwo = zeroToOne * 2.0;

			// convert from 0->2 to -1->+1 (clipspace)
			vec2 clipSpace = zeroToTwo - 1.0;

			gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

			// pass the texCoord to the fragment shader
			// The GPU will interpolate this value between points.
			v_texcoord = a_texcoord;
		}`;

	private readonly fragmentShaderFillRectangleCode =
		`#version 300 es
			precision highp float;
			uniform vec4 uColor;

			out vec4 outputColor;

			void main() {
				outputColor = uColor;
			}`;

	private readonly fragmentShaderTextureCode =
		`#version 300 es
		precision highp float;
 		uniform sampler2D u_texture;
 		in vec2 v_texcoord;
		out vec4 outputColor;

		void main() {
			// gl_FragColor = vec4(1, 0, 0, 1);
			lowp vec4 color = texture(u_texture, v_texcoord);
			if (color.a < 0.1)
    			discard;
			outputColor = color;
		}`;

	constructor(viewportsize: Size) {
		super(viewportsize);
		this.glctx = this.canvas.getContext('webgl2', {
			alpha: false,
			desynchronized: false,
			preserveDrawingBuffer: false,
			antialias: false,
		}) as WebGL2RenderingContext;
	}

	override init(): void {
		super.init();
		let gl = this.glctx;
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.enable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.FRONT);

		this.resVec2.set([this.viewportSize.x, this.viewportSize.y]);
		this.glctx.uniform2fv(this.resolutionLocation, this.resVec2);

		// setup GLSL program
		this.program = gl.createProgram() as WebGLProgram;
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
		this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution")!;
		this.textureLocation = gl.getUniformLocation(this.program, "u_texture")!;

		// Create a buffer.
		this.positionBuffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(12 * 1000), gl.DYNAMIC_DRAW);
		// Create a buffer for texture coords
		this.texcoordBuffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
		let uglyTexCoordStuff = new Float32Array(12 * 1000);
		for (let i = 0; i < 12 * 1000 - 12; i += 12) {
			uglyTexCoordStuff.set([
				0.0, 0.0,
				1.0, 0.0,
				0.0, 1.0,
				0.0, 1.0,
				1.0, 0.0,
				1.0, 1.0,
			], i);
		}
		gl.bufferData(gl.ARRAY_BUFFER, uglyTexCoordStuff, gl.DYNAMIC_DRAW);
		gl.useProgram(this.program);

		// Setup the attributes to pull data from our buffers
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.enableVertexAttribArray(this.positionLocation);
		gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
		gl.enableVertexAttribArray(this.texcoordLocation);
		gl.vertexAttribPointer(this.texcoordLocation, 2, gl.FLOAT, false, 0, 0);

		// this matrix will convert from pixels to clip space
		this.resVec2.set([this.canvas.width, this.canvas.height]);
		gl.uniform2fv(this.resolutionLocation, this.resVec2);

		// Tell the shader to get the texture from texture unit 0
		gl.uniform1i(this.textureLocation, 0);

		this.textures = {};
		this.textures['_atlas'] = this.createTexture(BaseView.images['_atlas']);
	}

	private loadShader(type: number, source: string): WebGLShader | null {
		let gl = this.glctx;
		const shader = gl.createShader(type)!;

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

	private createTexture(img: HTMLImageElement): WebGLTexture {
		let gl = this.glctx;

		let result = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, result);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		// let's assume all images are not a power of 2
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		return result;
	}

	override handleResize(): void {
		super.handleResize();
		let _this = global.view as GLView;
		_this.glctx.viewport(0, 0, _this.canvas.width, _this.canvas.height);
	}

	override drawgame(gamescreenOffset?: Point, clearCanvas: boolean = true): void {
		super.drawgame(gamescreenOffset, clearCanvas);
	}

	override clear(): void {
		let gl = this.glctx;
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	public drawSprites(): void {
		let _this = global.view as GLView;
		let gl = _this.glctx;
		gl.drawArrays(gl.TRIANGLES, 0, 6 * _this.drawImgReqIndex);
		_this.drawImgReqIndex = 0;
	}

	override drawImg(imgid: string, x: number, y: number, options: number = 0, sx?: number, sy?: number): void {
		let imgmeta = global.game.rom['imgresources'][imgid]?.['imgmeta'];
		if (!imgmeta) throw `Image with id '${imgid}' not found while trying to retrieve image metadata!`;
		let _this = global.view as GLView;
		let gl = _this.glctx;
		let width = imgmeta['width'];
		let height = imgmeta['height'];

		let flipx: number = options & DrawImgFlags.HFLIP;
		let flipy: number = options & DrawImgFlags.VFLIP;

		bvec.set(_this.vertexcoords, x, y, width, height, sx ?? 1, sy ?? 1);
		if (flipx && flipy) _this.texcoords.set(imgmeta['texcoords_fliphv']);
		else if (flipx) _this.texcoords.set(imgmeta['texcoords_fliph']);
		else if (flipy) _this.texcoords.set(imgmeta['texcoords_flipv']);
		else _this.texcoords.set(imgmeta['texcoords']);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 48 * _this.drawImgReqIndex, _this.vertexcoords);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 48 * _this.drawImgReqIndex, _this.texcoords);
		++_this.drawImgReqIndex;
	}

	override drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
		// console.warn('GLView.drawRectangle nog niet gecodeerd :-(');

	}

	override fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
		// console.warn('GLView.fillRectangle nog niet gecodeerd :-(');
	}
}
