import { Size, vec3 } from "./bmsx";
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
    set_zcoord: function (v: Float32Array, z: number): void {
        v[0] = z, v[1] = z, v[2] = z, v[3] = z, v[4] = z, v[5] = z;
    },
    set_color: function (v: Float32Array, color: Color): void {
        v[0] = color.r, v[1] = color.g, v[2] = color.b, v[3] = color.a,
            v[4] = color.r, v[5] = color.g, v[6] = color.b, v[7] = color.a,
            v[8] = color.r, v[9] = color.g, v[10] = color.b, v[11] = color.a,
            v[12] = color.r, v[13] = color.g, v[14] = color.b, v[15] = color.a,
            v[16] = color.r, v[17] = color.g, v[18] = color.b, v[19] = color.a,
            v[20] = color.r, v[21] = color.g, v[22] = color.b, v[23] = color.a;
    },
    // set_color_values: function (v: Float32Array, r: number, g: number, b: number, a: number): void {
    // 	v[0] = r, v[1] = g, v[2] = b, v[3] = a,
    // 	v[4] = r, v[5] = g, v[6] = b, v[7] = a,
    // 	v[8] = r, v[9] = g, v[10] = b, v[11] = a,
    // 	v[12] = r, v[13] = g, v[14] = b, v[15] = a,
    // 	v[16] = r, v[17] = g, v[18] = b, v[19] = a,
    // 	v[20] = r, v[21] = g, v[22] = b, v[23] = a;
    // },
    // seti: function (v: Float32Array, i: number, x: number, y: number, w: number, h: number): void {
    // 	// Do the Boaz matrix translate and scale
    // 	let x1 = x;
    // 	let x2 = x + w;
    // 	let y1 = y;
    // 	let y2 = y + h;

    // 	v[0 + i] = x1, v[1 + i] = y1,
    // 		v[2 + i] = x2, v[3 + i] = y1,
    // 		v[4 + i] = x1, v[5 + i] = y2,
    // 		v[6 + i] = x1, v[7 + i] = y2,
    // 		v[8 + i] = x2, v[9 + i] = y1,
    // 		v[10 + i] = x2, v[11 + i] = y2;
    // },
    // uvcoords: function (v: Float32Array, i: number, x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number) {
    // 	const left = x / imageWidth;
    // 	const bottom = y / imageHeight;
    // 	const right = (x + width) / imageWidth;
    // 	const top = (y + height) / imageHeight;

    // 	v[i] = left,
    // 		v[i + 1] = top,
    // 		v[i + 2] = right,
    // 		v[i + 3] = top,
    // 		v[i + 4] = right,
    // 		v[i + 5] = bottom,
    // 		v[i + 6] = left,
    // 		v[i + 7] = bottom;
    // },
};

const DEFAULT_VERTEX_COLOR: Color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
const VERTEX_COLOR_COLORIZED_RED: Color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
const VERTEX_COLOR_COLORIZED_GREEN: Color = { r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
const VERTEX_COLOR_COLORIZED_BLUE: Color = { r: 0.0, g: 0.0, b: 1.0, a: 1.0 };

export abstract class GLView extends BaseView {
    public glctx: WebGL2RenderingContext;
    private textures: { [key: number]: WebGLTexture; };

    private program: WebGLProgram;
    private positionLocation: number;
    private texcoordLocation: number;
    private zcoordLocation: number;
    private color_overrideLocation: number;
    private resolutionLocation: WebGLUniformLocation;
    private textureLocation: WebGLUniformLocation;
    // private colorOverrideLocation: WebGLUniformLocation;
    private positionBuffer: WebGLBuffer;
    private texcoordBuffer: WebGLBuffer;
    private zBuffer: WebGLBuffer;
    private color_overrideBuffer: WebGLBuffer;
    private resVec2: Float32Array = new Float32Array(2);
    private vertexcoords: Float32Array = new Float32Array(12);
    private texcoords: Float32Array = new Float32Array(12);
    private zcoords: Float32Array = new Float32Array(6);
    private color_override: Float32Array = new Float32Array(24);
    private drawImgReqIndex: number = 0;

    private readonly vertexShaderCode =
        `#version 300 es
			precision highp float;

			in vec2 a_position;
			in vec2 a_texcoord;
			in vec4 a_color_override;
			in float a_pos_z;

			uniform vec2 u_resolution;

			out vec2 v_texcoord;
			out vec4 v_color_override;

		void main() {
			// Convert the rectangle from pixels to 0.0 to 1.0
			vec2 zeroToOne = a_position / u_resolution;

			// Convert from 0->1 to 0->2
			vec2 zeroToTwo = zeroToOne * 2.0;

			// Convert from 0->2 to -1->+1 (clipspace)
			vec2 clipSpace = zeroToTwo - 1.0;

			gl_Position = vec4(clipSpace * vec2(1, -1), a_pos_z, 1);

			// Pass the texCoord to the fragment shader
			// The GPU will interpolate this value between points.
			v_texcoord = a_texcoord;
			// Pass the color_override value to the fragment shader to colorize sprites!
			v_color_override = a_color_override;
		}`;

    private readonly fragmentShaderTextureCode =
        `#version 300 es
		precision highp float;
 		uniform sampler2D u_texture;
 		in vec2 v_texcoord;
		in vec4 v_color_override;
		out vec4 outputColor;

		void main() {
			// gl_FragColor = vec4(1, 0, 0, 1);
			lowp vec4 color = texture(u_texture, v_texcoord);
			color = color * v_color_override;
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
        gl.depthFunc(gl.GREATER);
        gl.enable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);

        this.resVec2.set([this.viewportSize.x, this.viewportSize.y]);

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
        this.zcoordLocation = gl.getAttribLocation(this.program, "a_pos_z");
        this.color_overrideLocation = gl.getAttribLocation(this.program, "a_color_override");

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
            // ], 0);
        }
        gl.bufferData(gl.ARRAY_BUFFER, uglyTexCoordStuff, gl.DYNAMIC_DRAW);

        // Create buffer for z position information for the vertex shader
        this.zBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1 * 1000), gl.DYNAMIC_DRAW);

        // Create buffer for color override information for the vertex shader
        this.color_overrideBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(24 * 1000), gl.DYNAMIC_DRAW);

        gl.useProgram(this.program);

        // Setup the attributes to pull data from our buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.enableVertexAttribArray(this.texcoordLocation);
        gl.vertexAttribPointer(this.texcoordLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuffer);
        gl.enableVertexAttribArray(this.zcoordLocation);
        gl.vertexAttribPointer(this.zcoordLocation, 1, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.color_overrideLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer);
        gl.vertexAttribPointer(this.color_overrideLocation, 4, gl.FLOAT, false, 0, 0);

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

    override drawgame(gamescreenOffset?: vec3, clearCanvas: boolean = true): void {
        super.drawgame(gamescreenOffset, clearCanvas);
        this.drawSprites();
    }

    override clear(): void {
        let gl = this.glctx;
        gl.clearDepth(0.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    public drawSprites(): void {
        let _this = global.view as GLView;
        let gl = _this.glctx;
        gl.drawArrays(gl.TRIANGLES, 0, 6 * _this.drawImgReqIndex);
        _this.drawImgReqIndex = 0;
    }

    override drawImg(imgid: string, x: number, y: number, z: number, options: DrawImgFlags = DrawImgFlags.None, sx: number = 1, sy: number = 1, _color_override?: Color): void {
        let imgmeta = global.game.rom['imgresources'][imgid]?.['imgmeta'];
        if (!imgmeta) throw `Image with id '${imgid}' not found while trying to retrieve image metadata!`;
        let _this = global.view as GLView;
        let gl = _this.glctx;
        let width = imgmeta['width'];
        let height = imgmeta['height'];

        let flipx = (options & DrawImgFlags.HFLIP) === DrawImgFlags.HFLIP;
        let flipy = (options & DrawImgFlags.VFLIP) === DrawImgFlags.VFLIP;

        bvec.set(_this.vertexcoords, x, y, width, height, sx, sy);
        if (flipx && flipy) _this.texcoords.set(imgmeta['texcoords_fliphv']);
        else if (flipx) _this.texcoords.set(imgmeta['texcoords_fliph']);
        else if (flipy) _this.texcoords.set(imgmeta['texcoords_flipv']);
        else _this.texcoords.set(imgmeta['texcoords']);

        bvec.set_zcoord(_this.zcoords, z / 1000);

        if (_color_override) bvec.set_color(_this.color_override, _color_override);
        else if ((options & DrawImgFlags.COLORIZE_R) === DrawImgFlags.COLORIZE_R) bvec.set_color(_this.color_override, VERTEX_COLOR_COLORIZED_RED);
        else if ((options & DrawImgFlags.COLORIZE_G) === DrawImgFlags.COLORIZE_G) bvec.set_color(_this.color_override, VERTEX_COLOR_COLORIZED_GREEN);
        else if ((options & DrawImgFlags.COLORIZE_B) === DrawImgFlags.COLORIZE_B) bvec.set_color(_this.color_override, VERTEX_COLOR_COLORIZED_BLUE);
        else bvec.set_color(_this.color_override, DEFAULT_VERTEX_COLOR);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 48 * _this.drawImgReqIndex, _this.vertexcoords);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 48 * _this.drawImgReqIndex, _this.texcoords);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 24 * _this.drawImgReqIndex, _this.zcoords);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 96 * _this.drawImgReqIndex, _this.color_override);
        ++_this.drawImgReqIndex;
    }

    override drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // console.warn('GLView.drawRectangle nog niet gecodeerd :-(');

    }

    override fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // console.warn('GLView.fillRectangle nog niet gecodeerd :-(');

    }
}
