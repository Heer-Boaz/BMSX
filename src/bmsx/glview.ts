import { Size } from "./bmsx";
import { BaseView, Color, DrawImgOptions } from './view';

const bvec = {
    /**
     * Sets the vertices of a rectangle in a Float32Array, using the given parameters.
     * @param v - The Float32Array to set the vertices in.
     * @param x - The x-coordinate of the top-left corner of the rectangle.
     * @param y - The y-coordinate of the top-left corner of the rectangle.
     * @param w - The width of the rectangle.
     * @param h - The height of the rectangle.
     * @param sx - The horizontal scaling factor.
     * @param sy - The vertical scaling factor.
     */
    set: function (v: Float32Array, x: number, y: number, w: number, h: number, sx: number, sy: number): void {
        const x2 = x + w * sx;
        const y2 = y + h * sy;

        v[0] = x, v[1] = y,
            v[2] = x2, v[3] = y,
            v[4] = x, v[5] = y2,
            v[6] = x, v[7] = y2,
            v[8] = x2, v[9] = y,
            v[10] = x2, v[11] = y2;
    },
    /**
     * Sets the z-coordinates of a rectangle in a Float32Array, using the given parameter.
     * @param v - The Float32Array to set the z-coordinates in.
     * @param z - The z-coordinate of the rectangle.
     */
    set_zcoord: function (v: Float32Array, z: number): void {
        for (let i = 0; i < 6; i++) {
            v[i] = z;
        }
    },
    /**
     * Sets the color of a rectangle in a Float32Array, using the given Color object.
     * @param v - The Float32Array to set the color in.
     * @param color - The Color object to use for the rectangle's color.
     */
    set_color: function (v: Float32Array, color: Color): void {
        const { r, g, b, a } = color;
        for (let i = 0; i < 24; i += 4) {
            v[i] = r, v[i + 1] = g, v[i + 2] = b, v[i + 3] = a;
        }
    },
};

export const DEFAULT_VERTEX_COLOR: Color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_RED: Color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_GREEN: Color = { r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_BLUE: Color = { r: 0.0, g: 0.0, b: 1.0, a: 1.0 };
export const MAX_SPRITES = 1000;
const RESOLUTION_VECTOR_SIZE = 2;
const VERTEX_COORDS_SIZE = 12;
const TEX_COORDS_SIZE = 12;
const Z_COORDS_SIZE = 6;
const COLOR_OVERRIDE_SIZE = 24;

const POSITION_BUFFER_SIZE = 12;
const TEXCOORD_BUFFER_SIZE = 12;
const Z_BUFFER_SIZE = 1;
const COLOR_OVERRIDE_BUFFER_SIZE = 24;
const POSITION_ATTRIBUTE_SIZE = 2;
const TEXCOORD_ATTRIBUTE_SIZE = 2;
const ZCOORD_ATTRIBUTE_SIZE = 1;
const COLOR_OVERRIDE_ATTRIBUTE_SIZE = 4;

const BUFFER_OFFSET_MULTIPLIER = 48;
const ZCOORD_DIVISOR = 10000;
const ZCOORD_BUFFER_OFFSET_MULTIPLIER = 24;
const COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER = 96;

/**
 * Represents a view that renders graphics using WebGL.
 */
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
    private positionBuffer: WebGLBuffer;
    private texcoordBuffer: WebGLBuffer;
    private zBuffer: WebGLBuffer;
    private color_overrideBuffer: WebGLBuffer;
    private readonly resolutionVector: Float32Array = new Float32Array(RESOLUTION_VECTOR_SIZE);
    private readonly vertexcoords: Float32Array = new Float32Array(VERTEX_COORDS_SIZE);
    private readonly texcoords: Float32Array = new Float32Array(TEX_COORDS_SIZE);
    private readonly zcoords: Float32Array = new Float32Array(Z_COORDS_SIZE);
    private readonly color_override: Float32Array = new Float32Array(COLOR_OVERRIDE_SIZE);
    private drawImgReqIndex: number;

    public static readonly vertexShaderCode: string =
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
            // Convert the rectangle from pixels to clipspace coordinates and invert Y-axis
            vec2 clipSpace = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);

            gl_Position = vec4(clipSpace, a_pos_z, 1);

            // Pass the texCoord and color_override to the fragment shader
            v_texcoord = a_texcoord;
            v_color_override = a_color_override;
    	}`;

    public static readonly fragmentShaderTextureCode: string =
        `#version 300 es
		precision highp float;
 		uniform sampler2D u_texture;
 		in vec2 v_texcoord;
		in vec4 v_color_override;
		out vec4 outputColor;

		void main() {
			lowp vec4 color = texture(u_texture, v_texcoord) * v_color_override;
			// if (color.a < 0.1)
    		// 	discard;
			outputColor = color;
		}`;

    constructor(viewportsize: Size) {
        super(viewportsize);
        this.glctx = this.canvas.getContext('webgl2', {
            alpha: true,
            desynchronized: false,
            preserveDrawingBuffer: false,
            antialias: false,
        }) as WebGL2RenderingContext;
    }

    override init(): void {
        super.init();
        this.setupGLContext();
        this.createProgram();
        this.setupLocations();
        this.setupBuffers();
        this.setupAttributes();
        this.setupUniforms();
        this.setupTextures();
    }

    private setupBuffers(): void {
        const buffers = {
            position: this.createBuffer(POSITION_BUFFER_SIZE),
            texcoord: this.createBuffer(TEXCOORD_BUFFER_SIZE, this.getTextureCoordinates()),
            z: this.createBuffer(Z_BUFFER_SIZE),
            color_override: this.createBuffer(COLOR_OVERRIDE_BUFFER_SIZE),
        };

        this.positionBuffer = buffers.position;
        this.texcoordBuffer = buffers.texcoord;
        this.zBuffer = buffers.z;
        this.color_overrideBuffer = buffers.color_override;
    }

    private setupAttributes(): void {
        this.glctx.useProgram(this.program);

        this.setupAttribute(this.positionBuffer, this.positionLocation, POSITION_ATTRIBUTE_SIZE);
        this.setupAttribute(this.texcoordBuffer, this.texcoordLocation, TEXCOORD_ATTRIBUTE_SIZE);
        this.setupAttribute(this.zBuffer, this.zcoordLocation, ZCOORD_ATTRIBUTE_SIZE);
        this.setupAttribute(this.color_overrideBuffer, this.color_overrideLocation, COLOR_OVERRIDE_ATTRIBUTE_SIZE);
    }

    private setupUniforms(): void {
        this.resolutionVector.set([this.canvas.width, this.canvas.height]);
        this.glctx.uniform2fv(this.resolutionLocation, this.resolutionVector);
        this.glctx.uniform1i(this.textureLocation, 0);
    }

    private setupTextures(): void {
        this.textures = {};
        this.textures['_atlas'] = this.createTexture(BaseView.images['_atlas']);
    }

    private setupGLContext(): void {
        const gl = this.glctx;
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GREATER);
        gl.enable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
    }

    private createProgram(): void {
        const gl = this.glctx;
        const program = gl.createProgram();
        if (!program) throw `Failed to create the GLSL program! Aborting as we cannot create the GLView for the game!`;
        this.program = program;

        const vertShader = this.loadShader(gl.VERTEX_SHADER, GLView.vertexShaderCode);
        const fragShader = this.loadShader(gl.FRAGMENT_SHADER, GLView.fragmentShaderTextureCode);

        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw `Unable to initialize the shader program: ${gl.getProgramInfoLog(program)}`;
        }
    }

    private setupLocations(): void {
        const gl = this.glctx;
        this.resolutionVector.set([this.viewportSize.x, this.viewportSize.y]);
        const locations = {
            position: gl.getAttribLocation(this.program, "a_position"),
            texcoord: gl.getAttribLocation(this.program, "a_texcoord"),
            zcoord: gl.getAttribLocation(this.program, "a_pos_z"),
            color_override: gl.getAttribLocation(this.program, "a_color_override")
        };
        this.positionLocation = locations.position;
        this.texcoordLocation = locations.texcoord;
        this.zcoordLocation = locations.zcoord;
        this.color_overrideLocation = locations.color_override;
        this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution")!;
        this.textureLocation = gl.getUniformLocation(this.program, "u_texture")!;
    }

    private createBuffer(size: number, data?: Float32Array): WebGLBuffer {
        const gl = this.glctx;
        const buffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data || new Float32Array(size * MAX_SPRITES), gl.DYNAMIC_DRAW);
        return buffer;
    }

    private setupAttribute(buffer: WebGLBuffer, location: number, size: number): void {
        const gl = this.glctx;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    private getTextureCoordinates(): Float32Array {
        const textureCoordinates = new Float32Array(TEXCOORD_BUFFER_SIZE * MAX_SPRITES);
        for (let i = 0; i < TEXCOORD_BUFFER_SIZE * MAX_SPRITES - TEXCOORD_BUFFER_SIZE; i += TEXCOORD_BUFFER_SIZE) {
            textureCoordinates.set([
                0.0, 0.0,
                1.0, 0.0,
                0.0, 1.0,
                0.0, 1.0,
                1.0, 0.0,
                1.0, 1.0,
            ], i);
        }
        return textureCoordinates;
    }

    /**
     * Compiles a WebGL shader from the provided source code.
     * @param type The type of shader to compile (either gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
     * @param source The source code of the shader.
     * @returns The compiled WebGL shader.
     * @throws An error if the shader fails to compile.
     */
    private loadShader(type: number, source: string): WebGLShader {
        const gl = this.glctx;
        const shader = gl.createShader(type)!;

        // Send the source to the shader object
        gl.shaderSource(shader, source);

        // Compile the shader program
        gl.compileShader(shader);

        // See if it compiled successfully
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = `'An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`;
            gl.deleteShader(shader);

            console.error(message);
            throw message;
        }

        return shader;
    }

    /**
     * Creates a WebGL texture from an HTMLImageElement.
     * @param img The HTMLImageElement to create the texture from.
     * @returns The created WebGL texture.
     */
    private createTexture(img: HTMLImageElement): WebGLTexture {
        const gl = this.glctx;

        const result = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, result);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        // let's assume all images are not a power of 2
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        return result;
    }

    /**
     * Overrides the base class method to handle resizing of the canvas and viewport for WebGL rendering.
     * This method should be called whenever the canvas is resized.
     */
    override handleResize(): void {
        super.handleResize();
        const _this = global.view as GLView;
        _this.glctx.viewport(0, 0, _this.canvas.width, _this.canvas.height);
    }

    /**
     * Overrides the base class method to draw the game using WebGL.
     * @param clearCanvas Whether to clear the canvas before drawing.
     */
    override drawgame(clearCanvas: boolean = true): void {
        super.drawgame(clearCanvas);
        this.drawSprites();
    }

    /**
     * Overrides the base class method to clear the WebGL canvas.
     */
    override clear(): void {
        const gl = this.glctx;
        gl.clearDepth(0.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    /**
     * Draws all the sprites that have been queued for drawing using WebGL.
     * This method should be called once per frame after all sprites have been queued.
     */
    public drawSprites(): void {
        const _this = global.view as GLView;
        const gl = _this.glctx;
        gl.drawArrays(gl.TRIANGLES, 0, 6 * _this.drawImgReqIndex);
        _this.drawImgReqIndex = 0;
    }

    /**
     * Updates a WebGL buffer with new data.
     * @param gl The WebGL rendering context.
     * @param buffer The buffer to update.
     * @param target The target buffer object.
     * @param offset The offset into the buffer to start updating.
     * @param data The new data to write into the buffer.
     */
    private static updateBuffer(gl: WebGLRenderingContext, buffer: WebGLBuffer, target: GLenum, offset: number, data: ArrayBufferView) {
        gl.bindBuffer(target, buffer);
        gl.bufferSubData(target, offset, data);
    }

    /**
     * Draws an image on the canvas using WebGL.
     * @param options An object containing the image's position, size, and other options.
     * @throws An error if the image metadata cannot be found.
     */
    override drawImg(options: DrawImgOptions): void {
        const { x, y, z, imgid, flip_h = false, flip_v = false, sx = 1, sy = 1, colorize = DEFAULT_VERTEX_COLOR } = options;
        const imgmeta = global.rom['img_assets'][imgid]?.['imgmeta'];

        if (!imgmeta) {
            throw `Image with id '${imgid}' not found while trying to retrieve image metadata!`;
        }

        const { glctx: gl, vertexcoords, texcoords, zcoords, color_override, drawImgReqIndex } = this;
        const { width, height } = imgmeta;

        bvec.set(vertexcoords, x, y, width, height, sx, sy);
        texcoords.set(this.getTexCoords(flip_h, flip_v, imgmeta));
        bvec.set_zcoord(zcoords, z / ZCOORD_DIVISOR);
        bvec.set_color(color_override, colorize);

        const bufferOffset = BUFFER_OFFSET_MULTIPLIER * drawImgReqIndex;
        this.updateBuffers(gl, bufferOffset, vertexcoords, texcoords, zcoords, color_override);

        this.drawImgReqIndex++;
    }

    private getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: any): Float32Array {
        if (flip_h && flip_v) {
            return imgmeta['texcoords_fliphv'];
        } else if (flip_h) {
            return imgmeta['texcoords_fliph'];
        } else if (flip_v) {
            return imgmeta['texcoords_flipv'];
        } else {
            return imgmeta['texcoords'];
        }
    }

    private updateBuffers(gl: WebGLRenderingContext, bufferOffset: number, vertexcoords: Float32Array, texcoords: Float32Array, zcoords: Float32Array, color_override: Float32Array): void {
        GLView.updateBuffer(gl, this.positionBuffer, gl.ARRAY_BUFFER, bufferOffset, vertexcoords);
        GLView.updateBuffer(gl, this.texcoordBuffer, gl.ARRAY_BUFFER, bufferOffset, texcoords);
        GLView.updateBuffer(gl, this.zBuffer, gl.ARRAY_BUFFER, ZCOORD_BUFFER_OFFSET_MULTIPLIER * this.drawImgReqIndex, zcoords);
        GLView.updateBuffer(gl, this.color_overrideBuffer, gl.ARRAY_BUFFER, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * this.drawImgReqIndex, color_override);
    }

    override drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // Use the white pixel image and color it with the desired color
        const imgid = 'whitepixel';

        // Draw the top border
        this.drawImg({ x: x, y: y, z: 0, imgid: imgid, sx: ex - x, sy: 1, colorize: c });
        // Draw the bottom border
        this.drawImg({ x: x, y: ey - 1, z: 0, imgid: imgid, sx: ex - x, sy: 1, colorize: c });
        // Draw the left border
        this.drawImg({ x: x, y: y, z: 0, imgid: imgid, sx: 1, sy: ey - y, colorize: c });
        // Draw the right border
        this.drawImg({ x: ex - 1, y: y, z: 0, imgid: imgid, sx: 1, sy: ey - y, colorize: c });
    }

    override fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // Use the white pixel image and color it with the desired color
        const imgid = 'whitepixel';

        // Draw and stretch the image to fill the rectangle
        this.drawImg({ x: x, y: y, z: 0, imgid: imgid, sx: ex - x, sy: ey - y, colorize: c });
    }
}
