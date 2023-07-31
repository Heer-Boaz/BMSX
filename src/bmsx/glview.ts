import { Size, vec3 } from "./bmsx";
import { BaseView, Color, DrawImgOptions } from './view';

var bvec = {
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
        // Do the Boaz matrix translate and scale
        const x1 = x;
        const x2 = x + w * sx;
        const y1 = y;
        const y2 = y + h * sy;

        v[0] = x1, v[1] = y1,
            v[2] = x2, v[3] = y1,
            v[4] = x1, v[5] = y2,
            v[6] = x1, v[7] = y2,
            v[8] = x2, v[9] = y1,
            v[10] = x2, v[11] = y2;
    },
    /**
     * Sets the z-coordinates of a rectangle in a Float32Array, using the given parameter.
     * @param v - The Float32Array to set the z-coordinates in.
     * @param z - The z-coordinate of the rectangle.
     */
    set_zcoord: function (v: Float32Array, z: number): void {
        v[0] = z, v[1] = z, v[2] = z, v[3] = z, v[4] = z, v[5] = z;
    },
    /**
     * Sets the color of a rectangle in a Float32Array, using the given Color object.
     * @param v - The Float32Array to set the color in.
     * @param color - The Color object to use for the rectangle's color.
     */
    set_color: function (v: Float32Array, color: Color): void {
        v[0] = color.r, v[1] = color.g, v[2] = color.b, v[3] = color.a,
            v[4] = color.r, v[5] = color.g, v[6] = color.b, v[7] = color.a,
            v[8] = color.r, v[9] = color.g, v[10] = color.b, v[11] = color.a,
            v[12] = color.r, v[13] = color.g, v[14] = color.b, v[15] = color.a,
            v[16] = color.r, v[17] = color.g, v[18] = color.b, v[19] = color.a,
            v[20] = color.r, v[21] = color.g, v[22] = color.b, v[23] = color.a;
    },
};

export const DEFAULT_VERTEX_COLOR: Color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_RED: Color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_GREEN: Color = { r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_BLUE: Color = { r: 0.0, g: 0.0, b: 1.0, a: 1.0 };

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
    private resVec2: Float32Array = new Float32Array(2);
    private vertexcoords: Float32Array = new Float32Array(12);
    private texcoords: Float32Array = new Float32Array(12);
    private zcoords: Float32Array = new Float32Array(6);
    private color_override: Float32Array = new Float32Array(24);
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
			if (color.a < 0.1)
    			discard;
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
        const gl = this.glctx;
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GREATER);
        gl.enable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);


        // setup GLSL program
        const program = gl.createProgram();
        if (!program) throw `Failed to create the GLSL program! Aborting as we cannot create the GLView for the game!`;
        this.program = program;

        const vertShader = this.loadShader(gl.VERTEX_SHADER, GLView.vertexShaderCode);
        const fragShader = this.loadShader(gl.FRAGMENT_SHADER, GLView.fragmentShaderTextureCode);

        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        this.resVec2.set([this.viewportSize.x, this.viewportSize.y]);
        // look up where the vertex data needs to go
        this.positionLocation = gl.getAttribLocation(program, "a_position");
        this.texcoordLocation = gl.getAttribLocation(program, "a_texcoord");
        this.zcoordLocation = gl.getAttribLocation(program, "a_pos_z");
        this.color_overrideLocation = gl.getAttribLocation(program, "a_color_override");

        // lookup uniforms
        this.resolutionLocation = gl.getUniformLocation(program, "u_resolution")!;
        this.textureLocation = gl.getUniformLocation(program, "u_texture")!;

        // Create a buffer.
        this.positionBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(12 * 1000), gl.DYNAMIC_DRAW);
        // Create a buffer for texture coords
        this.texcoordBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        const uglyTexCoordStuff = new Float32Array(12 * 1000);
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

        // Create buffer for z position information for the vertex shader
        this.zBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.zBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1 * 1000), gl.DYNAMIC_DRAW);

        // Create buffer for color override information for the vertex shader
        this.color_overrideBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.color_overrideBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(24 * 1000), gl.DYNAMIC_DRAW);

        gl.useProgram(program);

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
        if (!imgmeta) throw `Image with id '${imgid}' not found while trying to retrieve image metadata!`;

        const _this = global.view as GLView;
        const { glctx: gl, vertexcoords, texcoords, zcoords, color_override, drawImgReqIndex } = _this;
        const width = imgmeta['width'];
        const height = imgmeta['height'];

        bvec.set(vertexcoords, x, y, width, height, sx, sy);
        texcoords.set(flip_h && flip_v ? imgmeta['texcoords_fliphv'] :
            flip_h ? imgmeta['texcoords_fliph'] :
                flip_v ? imgmeta['texcoords_flipv'] :
                    imgmeta['texcoords']);
        bvec.set_zcoord(zcoords, z / 10000);
        bvec.set_color(color_override, colorize);

        const bufferOffset = 48 * drawImgReqIndex;
        GLView.updateBuffer(gl, this.positionBuffer, gl.ARRAY_BUFFER, bufferOffset, vertexcoords);
        GLView.updateBuffer(gl, this.texcoordBuffer, gl.ARRAY_BUFFER, bufferOffset, texcoords);
        GLView.updateBuffer(gl, this.zBuffer, gl.ARRAY_BUFFER, 24 * drawImgReqIndex, zcoords);
        GLView.updateBuffer(gl, this.color_overrideBuffer, gl.ARRAY_BUFFER, 96 * drawImgReqIndex, color_override);

        _this.drawImgReqIndex++;
    }

    override drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // console.warn('GLView.drawRectangle nog niet gecodeerd :-(');

    }

    override fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void {
        // console.warn('GLView.fillRectangle nog niet gecodeerd :-(');

    }
};
