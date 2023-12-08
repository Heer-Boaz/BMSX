import { Size } from "./bmsx";
import { BaseView, Color, DrawImgOptions } from './view';

function catchWebGLError(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
        const returnValue = originalMethod.apply(this, args);
        const gl = (global.view as GLView).glctx;
        if (gl) {
            const error = gl.getError();
            if (error != gl.NO_ERROR) {
                throw new Error(`WebGL error in ${propertyKey}: ${getWebGLErrorString(gl, error)}`);
            }
        }
        return returnValue;
    };
    return descriptor;
}

function getWebGLErrorString(gl: WebGLRenderingContext, error: number): string {
    switch (error) {
        case gl.NO_ERROR: return "NO_ERROR";
        case gl.INVALID_ENUM: return "INVALID_ENUM";
        case gl.INVALID_VALUE: return "INVALID_VALUE";
        case gl.INVALID_OPERATION: return "INVALID_OPERATION";
        case gl.OUT_OF_MEMORY: return "OUT_OF_MEMORY";
        case gl.CONTEXT_LOST_WEBGL: return "CONTEXT_LOST_WEBGL";
        default: return "UNKNOWN_ERROR";
    }
}

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
    private additionalPositionBuffer: WebGLBuffer;
    private additionalTexcoordBuffer: WebGLBuffer;
    private color_overrideBuffer: WebGLBuffer;
    private readonly resolutionVector: Float32Array = new Float32Array(RESOLUTION_VECTOR_SIZE);
    private readonly vertexcoords: Float32Array = new Float32Array(VERTEX_COORDS_SIZE);
    private readonly texcoords: Float32Array = new Float32Array(TEX_COORDS_SIZE);
    private readonly zcoords: Float32Array = new Float32Array(Z_COORDS_SIZE);
    private readonly color_override: Float32Array = new Float32Array(COLOR_OVERRIDE_SIZE);
    private drawImgReqIndex: number;

    private additionalTexcoordLocation: GLint;
    private additionalResolutionLocation: WebGLUniformLocation;
    private additionalTimeLocation: WebGLUniformLocation;
    private additionalRandomLocation: WebGLUniformLocation;
    private additionalPositionLocation: GLint;
    private additionalProgram: WebGLProgram;
    private framebuffer: WebGLFramebuffer;
    private isRendering: boolean = false;
    private needsResize: boolean = false;

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
			outputColor = color;
		}`;

    // MSX1 color palette
    // const vec3 palette[16] = vec3[](
    //     vec3(0.0, 0.0, 0.0), // Transparent
    //     vec3(0.0, 0.0, 0.0), // Black
    //     vec3(0.0, 241.0/255.0, 20.0/255.0), // Medium Green
    //     vec3(68.0/255.0, 249.0/255.0, 86.0/255.0), // Light Green
    //     vec3(85.0/255.0, 79.0/255.0, 255.0/255.0), // Dark Blue
    //     vec3(128.0/255.0, 111.0/255.0, 255.0/255.0), // Light Blue
    //     vec3(250.0/255.0, 80.0/255.0, 51.0/255.0), // Dark Red
    //     vec3(12.0/255.0, 255.0/255.0, 255.0/255.0), // Cyan
    //     vec3(255.0/255.0, 81.0/255.0, 52.0/255.0), // Medium Red
    //     vec3(255.0/255.0, 115.0/255.0, 86.0/255.0), // Light Red
    //     vec3(226.0/255.0, 210.0/255.0, 4.0/255.0), // Dark Yellow
    //     vec3(242.0/255.0, 217.0/255.0, 71.0/255.0), // Light Yellow
    //     vec3(4.0/255.0, 212.0/255.0, 19.0/255.0), // Dark Green
    //     vec3(231.0/255.0, 80.0/255.0, 229.0/255.0), // Magenta
    //     vec3(208.0/255.0, 208.0/255.0, 208.0/255.0), // Gray
    //     vec3(255.0/255.0, 255.0/255.0, 255.0/255.0) // White
    // );

    // // Function to find the closest color in the palette
    // vec3 findClosestColor(vec3 color) {
    //     float minDistance = distance(color, palette[0]);
    //     vec3 closestColor = palette[0]; for (int i = 1; i < 16; i++) {
    //         float currentDistance = distance(color, palette[i]);
    //         if (currentDistance < minDistance) {
    //             minDistance = currentDistance;
    //             closestColor = palette[i];
    //         }
    //     } return closestColor;
    // }


    // // Define a 3x3 blur kernel
    // const float kernel[9] = float[](
    //     0.0, 1.0/4.0, 0.0,
    //     1.0/4.0, 1.0/2.0, 1.0/4.0,
    //     0.0, 1.0/4.0, 0.0
    // );

    // vec3 applyBlur(vec2 uv) {
    //     vec3 blurredColor = vec3(0.0);
    //     for (int y = -1; y <= 1; y++) {
    //         for (int x = -1; x <= 1; x++) {
    //             vec2 offset = vec2(x, y) / u_resolution;
    //             vec3 color = textureLod(u_texture, uv + offset, 0.0).rgb;
    //             blurredColor += color * kernel[(y + 1) * 3 + (x + 1)];
    //         }
    //     }
    //     return blurredColor;
    // }


    // Apply MSX1 color palette emulation
    // texColor = findClosestMSX1Color(texColor); // Implement this function

    public static readonly fragmentShaderCRTCode: string =
        `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_random;
uniform float u_time;

in vec2 v_texcoord;
out vec4 outputColor;
const vec2 originalResolution = vec2(256.0, 192.0);

// Define a 5x5 blur kernel
const float kernel[25] = float[](
    1.0/273.0, 4.0/273.0, 7.0/273.0, 4.0/273.0, 1.0/273.0,
    4.0/273.0, 16.0/273.0, 26.0/273.0, 16.0/273.0, 4.0/273.0,
    7.0/273.0, 26.0/273.0, 41.0/273.0, 26.0/273.0, 7.0/273.0,
    4.0/273.0, 16.0/273.0, 26.0/273.0, 16.0/273.0, 4.0/273.0,
    1.0/273.0, 4.0/273.0, 7.0/273.0, 4.0/273.0, 1.0/273.0
);

vec3 applyBlur(vec2 uv) {
    vec3 blurredColor = vec3(0.0);
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 offset = vec2(x, y) / u_resolution;
            vec3 color = textureLod(u_texture, uv + offset, 0.0).rgb;
            blurredColor += color * kernel[(y + 2) * 5 + (x + 2)];
        }
    }
    return blurredColor;
}

// Function to generate noise
float noise(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec2 uv = v_texcoord;
    vec3 texColor = textureLod(u_texture, uv, 0.0).rgb;

    // Improved noise
    float n = noise(uv * u_resolution + vec2(u_random));
    texColor += vec3(n) * 0.02; // Adjust noise intensity as needed

    // Apply subtle color bleed
    vec3 bleed = vec3(0.02, 0.0, 0.0); // Adjust bleed intensity and color
    texColor += bleed;

    // Apply blur
    vec3 blurredColor = applyBlur(uv);
    texColor = mix(texColor, blurredColor, 0.4); // Adjust blur intensity

    // Apply selective phosphor glow
    vec3 glow = vec3(0.05, 0.02, 0.02);
    float brightness = dot(texColor, vec3(0.299, 0.587, 0.114)); // Luminance
    texColor += glow * clamp(brightness, 0.0, 1.0); // Glow only affects brighter areas

    // Calculate scaled UV coordinates based on the original resolution
    vec2 scaledUV = vec2(uv.x * originalResolution.x / u_resolution.x, uv.y * originalResolution.y / u_resolution.y);

    // // Apply dynamic scanline effect based on the original resolution
    // float scanlineFrequency = originalResolution.y * 20.0; // Increase frequency for smaller scanlines
    // float scanlineOffset = mod(u_time, 40.0) * 0.1; // Adjust speed of scanline movement
    // float scanline = sin((scaledUV.y  + scanlineOffset) * scanlineFrequency);
    // texColor *= 0.9 + 0.1 * scanline; // Adjust scanline intensity

    outputColor = vec4(texColor, 1.0);
}`

    constructor(viewportsize: Size) {
        super(viewportsize);
        this.glctx = this.canvas.getContext('webgl2', {
            alpha: true,
            desynchronized: false,
            preserveDrawingBuffer: false,
            antialias: false,
        }) as WebGL2RenderingContext;
    }

    @catchWebGLError
    override init(): void {
        super.init();
        this.setupGLContext();
        this.createProgram();
        this.setupLocations();
        this.setupBuffers();
        this.setupAttributes();
        this.setupUniforms();
        this.setupTextures();
        this.createAdditionalProgram();
        this.setupAdditionalLocations();
        // this.createFramebufferAndTexture();
        this.createAdditionalVertexBuffer();
        this.createAdditionalTexcoordBuffer();
        this.handleResize(); // This is needed to set the viewport size and create the framebuffer and texture
    }

    @catchWebGLError
    private createAdditionalVertexBuffer(): void {
        const gl = this.glctx;
        // Define the vertex positions for a full-screen quad (in clip space)
        const positions = new Float32Array([
            -1.0, -1.0, // bottom left
            1.0, -1.0, // bottom right
            -1.0, 1.0, // top left
            1.0, -1.0, // bottom right
            1.0, 1.0, // top right
            -1.0, 1.0  // top left
        ]);

        // Create a new buffer and bind the vertex position data to it
        bvec.set(positions, 0, 0, this.canvas.width, this.canvas.height, 1, 1);
        this.additionalPositionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.additionalPositionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    }

    @catchWebGLError
    private createAdditionalTexcoordBuffer(): void {
        const gl = this.glctx;
        // Define the texture coordinates for a full-screen quad
        const texcoords = new Float32Array([
            0.0, 1.0,
            1.0, 1.0,
            0.0, 0.0,
            0.0, 0.0,
            1.0, 1.0,
            1.0, 0.0,
        ]);

        // Create a new buffer and bind the texture coordinate data to it
        this.additionalTexcoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.additionalTexcoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
    }

    @catchWebGLError
    private switchProgram(program: WebGLProgram): void {
        this.glctx.useProgram(program);
    }

    @catchWebGLError
    private createAdditionalProgram(): void {
        const gl = this.glctx;
        const program = gl.createProgram();
        if (!program) throw `Failed to create the additional GLSL program! Aborting as we cannot create the GLView for the game!`;
        this.additionalProgram = program;

        const vertShader = this.loadShader(gl.VERTEX_SHADER, GLView.vertexShaderCode);
        const fragShader = this.loadShader(gl.FRAGMENT_SHADER, GLView.fragmentShaderCRTCode);

        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw `Unable to initialize the additional shader program: ${gl.getProgramInfoLog(program)} `;
        }
    }

    @catchWebGLError
    private setupAdditionalLocations(): void {
        const gl = this.glctx;
        this.resolutionVector.set([this.viewportSize.x, this.viewportSize.y]);
        const locations = {
            position: gl.getAttribLocation(this.additionalProgram, "a_position"),
            texcoord: gl.getAttribLocation(this.additionalProgram, "a_texcoord"),
            resolution: gl.getUniformLocation(this.additionalProgram, "u_resolution"),
            random: gl.getUniformLocation(this.additionalProgram, "u_random"),
            time: gl.getUniformLocation(this.additionalProgram, "u_time")
        };
        this.additionalPositionLocation = locations.position;
        this.additionalTexcoordLocation = locations.texcoord;
        this.additionalResolutionLocation = locations.resolution;
        this.additionalTimeLocation = locations.time;
        this.additionalRandomLocation = locations.random;

        // Enable the position attribute for the shader
        gl.enableVertexAttribArray(this.additionalPositionLocation);

        // Enable the texcoord attribute for the shader
        gl.enableVertexAttribArray(this.additionalTexcoordLocation);
    }

    @catchWebGLError
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

    @catchWebGLError
    private setupAttributes(): void {
        this.glctx.useProgram(this.program);

        this.setupAttribute(this.positionBuffer, this.positionLocation, POSITION_ATTRIBUTE_SIZE);
        this.setupAttribute(this.texcoordBuffer, this.texcoordLocation, TEXCOORD_ATTRIBUTE_SIZE);
        this.setupAttribute(this.zBuffer, this.zcoordLocation, ZCOORD_ATTRIBUTE_SIZE);
        this.setupAttribute(this.color_overrideBuffer, this.color_overrideLocation, COLOR_OVERRIDE_ATTRIBUTE_SIZE);
    }

    @catchWebGLError
    private setupUniforms(): void {
        this.resolutionVector.set([this.canvas.width, this.canvas.height]);
        this.glctx.uniform2fv(this.resolutionLocation, this.resolutionVector);
        this.glctx.uniform1i(this.textureLocation, 0);
    }

    @catchWebGLError
    private setupTextures(): void {
        this.textures = {};
        this.textures['_atlas'] = this.createTexture(BaseView.images['_atlas']);

        // The 'additional' texture is created in createFramebufferAndTexture
    }

    @catchWebGLError
    private setupGLContext(): void {
        const gl = this.glctx;
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GREATER);
        gl.enable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
    }

    @catchWebGLError
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
            throw `Unable to initialize the shader program: ${gl.getProgramInfoLog(program)} `;
        }
    }

    @catchWebGLError
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

    @catchWebGLError
    private createBuffer(size: number, data?: Float32Array): WebGLBuffer {
        const gl = this.glctx;
        const buffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data || new Float32Array(size * MAX_SPRITES), gl.DYNAMIC_DRAW);
        return buffer;
    }

    @catchWebGLError
    private setupAttribute(buffer: WebGLBuffer, location: number, size: number): void {
        const gl = this.glctx;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    @catchWebGLError
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
    @catchWebGLError
    private loadShader(type: number, source: string): WebGLShader {
        const gl = this.glctx;
        const shader = gl.createShader(type)!;
        // Send the source to the shader object
        gl.shaderSource(shader, source);

        // Compile the shader program
        gl.compileShader(shader);

        // Check for errors
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw `Error compiling vertex shader: ${gl.getShaderInfoLog(shader)} `;
        }

        return shader;
    }

    /**
     * Creates a WebGL texture from an HTMLImageElement or a given size.
     * @param img The HTMLImageElement to create the texture from.
     * @param size The size to create the texture if no image is provided.
     * @returns The created WebGL texture.
     */
    @catchWebGLError
    private createTexture(img?: HTMLImageElement, size?: { width: number, height: number }): WebGLTexture {
        const gl = this.glctx;

        const result = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, result);

        if (img) {
            // Create the texture from the image
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } else if (size) {
            // Allocate memory for the texture
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        // let's assume all images are not a power of 2
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        return result;
    }

    @catchWebGLError
    private createFramebufferAndTexture(): void {
        const gl = this.glctx;

        // Delete the old framebuffer and texture if they exist
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        if (!this.textures) {
            this.textures = {};
        } else if (this.textures['additional']) {
            gl.deleteTexture(this.textures['additional']);
        }

        // Create a new texture
        this.textures['additional'] = this.createTexture(undefined, { width: this.canvas.width, height: this.canvas.height });

        // Create a new framebuffer
        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

        // Attach the texture to the framebuffer
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures['additional'], 0);

        // Unbind the framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Unbind the texture
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Overrides the base class method to handle resizing of the canvas and viewport for WebGL rendering.
     * This method should be called whenever the canvas is resized.
     */
    @catchWebGLError
    override handleResize(this: GLView): void {
        if (this.isRendering) {
            // If a frame is currently being drawn, set the needsResize flag and return
            this.needsResize = true;
            return;
        }

        super.handleResize();
        const gl = this.glctx;
        if (gl) {
            gl.viewport(0, 0, this.canvas.width, this.canvas.height); // Set the viewport to the new size

            // Recreate the framebuffer and texture to match the new size
            this.createFramebufferAndTexture(); // This also binds the framebuffer

            // Set the resolution uniform
            if (this.additionalResolutionLocation) { // This is only set if the additional shader is being used
                gl.useProgram(this.additionalProgram);
                gl.uniform2fv(this.additionalResolutionLocation, new Float32Array([this.canvas.width, this.canvas.height]));
                gl.useProgram(this.program);
            }
        }

        // Clear the needsResize flag
        this.needsResize = false;
    }

    @catchWebGLError
    override drawgame(clearCanvas: boolean = true): void {
        this.isRendering = true;
        super.drawgame(clearCanvas);

        // Draw all the sprites to a texture using the main shader
        this.drawSprites();
        // this.saveTextureToFile();
        // debugger;

        // Draw a full-screen quad using the post-processing shader
        this.drawFullScreenQuad();

        this.switchProgram(this.program); // Switch back to the main shader

        this.isRendering = false;

        // Check if a resize was requested while rendering
        if (this.needsResize) {
            this.handleResize();
        }
    }

    public saveFramebufferToFile(): void {
        const gl = this.glctx;
        // 2. Read the pixels from the framebuffer into an array
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // 3. Create a new canvas and context
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        // 4. Put the pixel data into an ImageData object and draw it to the canvas
        const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
        context.putImageData(imageData, 0, 0);

        // Flip the context vertically
        context.scale(1, -1);
        context.translate(0, -height);

        // 5. Convert the canvas to a data URL and download it as an image
        const a = document.createElement('a');
        a.download = 'image.png';
        a.href = canvas.toDataURL();
        a.click();
    }

    public saveTextureToFile(): void {
        const gl = this.glctx;

        // 1. Bind the framebuffer that has the texture attached
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

        // 2. Read the pixels from the framebuffer into an array
        const width = this.canvas.width;  // replace with the width of your texture
        const height = this.canvas.height;  // replace with the height of your texture
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // 3. Create a new canvas and context
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        // 4. Put the pixel data into an ImageData object
        const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

        // Draw the image data to the canvas
        context.putImageData(imageData, 0, 0);

        // 5. Flip the canvas vertically
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempContext = tempCanvas.getContext('2d');
        tempContext.putImageData(context.getImageData(0, 0, width, height), 0, 0);
        context.clearRect(0, 0, width, height);
        context.save();
        context.scale(1, -1);
        context.drawImage(tempCanvas, 0, -height);
        context.restore();

        // 6. Convert the canvas to a data URL and download it as an image
        const a = document.createElement('a');
        a.download = 'image.png';
        a.href = canvas.toDataURL();
        a.click();

        // 7. Unbind the framebuffer to return to default rendering to the screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    @catchWebGLError
    private drawFullScreenQuad(): void {
        const gl = this.glctx;
        // Bind the default framebuffer so that the rendering output goes to the screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Switch to the post-processing shader
        this.switchProgram(this.additionalProgram);

        // Bind the texture as the input to the post-processing shader
        gl.bindTexture(gl.TEXTURE_2D, this.textures['additional']);

        // Bind the vertex position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.additionalPositionBuffer);
        gl.vertexAttribPointer(this.additionalPositionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.additionalPositionLocation);

        // Bind the texcoord buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.additionalTexcoordBuffer);
        gl.vertexAttribPointer(this.additionalTexcoordLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.additionalTexcoordLocation);

        // Update the time uniform
        let currentTime = Date.now() / 1000; // Get the current time in seconds
        gl.uniform1f(this.additionalTimeLocation, currentTime); // Add this line
        gl.uniform1f(this.additionalRandomLocation, Math.random()); // Add this line

        // Draw the full-screen quad
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Overrides the base class method to clear the WebGL canvas.
     */
    @catchWebGLError
    override clear(): void {
        const gl = this.glctx;
        gl.clearDepth(0.0);

        // Clear the texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Clear the screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    /**
     * Draws all the sprites that have been queued for drawing using WebGL.
     * This method should be called once per frame after all sprites have been queued.
     */
    @catchWebGLError
    public drawSprites(): void {
        const _this = global.view as GLView;
        const gl = _this.glctx;
        // Bind the framebuffer so that the rendering output goes to the texture
        this.glctx.bindFramebuffer(this.glctx.FRAMEBUFFER, this.framebuffer);
        // Set the viewport to the dimensions of the 'additional' texture
        this.switchProgram(this.program);
        gl.bindTexture(gl.TEXTURE_2D, this.textures['_atlas']);

        // Bind the position buffer and set the position attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, _this.positionBuffer);
        gl.vertexAttribPointer(_this.positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(_this.positionLocation);

        // Bind the texcoord buffer and set the texcoord attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, _this.texcoordBuffer);
        gl.vertexAttribPointer(_this.texcoordLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(_this.texcoordLocation);

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
    @catchWebGLError
    private static updateBuffer(gl: WebGLRenderingContext, buffer: WebGLBuffer, target: GLenum, offset: number, data: ArrayBufferView) {
        gl.bindBuffer(target, buffer);
        gl.bufferSubData(target, offset, data);
    }

    /**
     * Draws an image on the canvas using WebGL.
     * @param options An object containing the image's position, size, and other options.
     * @throws An error if the image metadata cannot be found.
     */
    @catchWebGLError
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

    @catchWebGLError
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
