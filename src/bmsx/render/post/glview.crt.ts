import { vec3arr } from '../../rompack/rompack';
import { bvec } from '../2d/vertexutils2d';
import { glLoadShader, glSwitchProgram } from '../glutils';
import { POSITION_COMPONENTS, SPRITE_DRAW_OFFSET, TEXCOORD_COMPONENTS, VERTICES_PER_SPRITE } from '../glview.constants';
import fragmentShaderCRTCode from './shaders/crt.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';

export interface CRTShaderOptions {
    applyNoise?: boolean,
    applyColorBleed?: boolean,
    applyScanlines?: boolean,
    applyBlur?: boolean,
    applyGlow?: boolean,
    applyFringing?: boolean,
    blurIntensity?: number,
    noiseIntensity?: number,
    colorBleed?: vec3arr,
    glowColor?: vec3arr
};

let CRTShaderTexcoordLocation: GLint;
let CRTShaderResolutionLocation: WebGLUniformLocation;
let CRTShaderTimeLocation: WebGLUniformLocation;
let CRTShaderRandomLocation: WebGLUniformLocation;
let CRTShaderVertexLocation: GLint;
let CRTShaderApplyNoiseLocation: WebGLUniformLocation;
let CRTShaderApplyColorBleedLocation: WebGLUniformLocation;
let CRTShaderApplyScanlinesLocation: WebGLUniformLocation;
let CRTShaderApplyBlurLocation: WebGLUniformLocation;
let CRTShaderApplyGlowLocation: WebGLUniformLocation;
let CRTShaderApplyFringingLocation: WebGLUniformLocation;
let CRTShaderNoiseIntensityLocation: WebGLUniformLocation;
let CRTShaderColorBleedLocation: WebGLUniformLocation;
let CRTShaderBlurIntensityLocation: WebGLUniformLocation;
let CRTShaderGlowColorLocation: WebGLUniformLocation;
let CRTFragmentShaderTextureLocation: WebGLUniformLocation;
let CRTShaderProgram: WebGLProgram;
let CRTShaderVertexBuffer: WebGLBuffer;
let CRTShaderTexcoordBuffer: WebGLBuffer;
let CRTVertexShaderScaleLocation: WebGLUniformLocation;
let CRTFragmentShaderScaleLocation: WebGLUniformLocation;

export function setCrtOptions(gl: WebGL2RenderingContext, options: CRTShaderOptions): void {
    const { applyNoise, applyColorBleed, applyScanlines, applyBlur, applyGlow, applyFringing, blurIntensity, noiseIntensity, colorBleed, glowColor } = options;

    gl.useProgram(CRTShaderProgram);
    if (applyNoise !== undefined) gl.uniform1i(CRTShaderApplyNoiseLocation, applyNoise ? 1 : 0);
    if (applyColorBleed !== undefined) gl.uniform1i(CRTShaderApplyColorBleedLocation, applyColorBleed ? 1 : 0);
    if (applyScanlines !== undefined) gl.uniform1i(CRTShaderApplyScanlinesLocation, applyScanlines ? 1 : 0);
    if (applyBlur !== undefined) gl.uniform1i(CRTShaderApplyBlurLocation, applyBlur ? 1 : 0);
    if (applyGlow !== undefined) gl.uniform1i(CRTShaderApplyGlowLocation, applyGlow ? 1 : 0);
    if (applyFringing !== undefined) gl.uniform1i(CRTShaderApplyFringingLocation, applyFringing ? 1 : 0);
    if (noiseIntensity !== undefined) gl.uniform1f(CRTShaderNoiseIntensityLocation, noiseIntensity);
    if (colorBleed !== undefined) gl.uniform3fv(CRTShaderColorBleedLocation, new Float32Array(colorBleed));
    if (blurIntensity !== undefined) gl.uniform1f(CRTShaderBlurIntensityLocation, blurIntensity);
    if (glowColor !== undefined) gl.uniform3fv(CRTShaderGlowColorLocation, new Float32Array(glowColor));
}

/**
 * Draws a full-screen quad using the CRT shader.
 */
export function applyCrtPostProcess(gl: WebGL2RenderingContext, viewportWidth: number, viewportHeight: number): void {
    // Bind the default framebuffer so that the rendering output goes to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Set the viewport to match the size of the offscreen framebuffer
    gl.viewport(0, 0, viewportWidth, viewportHeight);

    // Switch to the post-processing shader
    glSwitchProgram(gl, CRTShaderProgram);

    // Bind the vertex position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, CRTShaderVertexBuffer);
    gl.vertexAttribPointer(CRTShaderVertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(CRTShaderVertexLocation);

    // Bind the texcoord buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, CRTShaderTexcoordBuffer);
    gl.vertexAttribPointer(CRTShaderTexcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(CRTShaderTexcoordLocation);

    // Update the time uniform
    const currentTime = Date.now() / 1000; // Get the current time in seconds
    gl.uniform1f(CRTShaderTimeLocation, currentTime); // Add this line
    gl.uniform1f(CRTShaderRandomLocation, Math.random()); // Add this line

    // Draw the full-screen quad
    gl.drawArrays(gl.TRIANGLES, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE);
}

/**
 * Creates the CRT shader programs.
 *
 * @remarks
 * This method creates the additional GLSL program for the CRT shader effect. It loads the vertex and fragment shaders,
 * attaches them to the program, and links the program. If the program fails to link, an error is thrown.
 */
export function createCRTShaderPrograms(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) throw Error(`Failed to create the CRT Shader GLSL program! Aborting as we cannot create the GLView for the game!`);
    CRTShaderProgram = program;

    const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, vertexShaderCRTCode);
    const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, fragmentShaderCRTCode);

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(`Unable to initialize the crt shader shader program: ${gl.getProgramInfoLog(program)}.`);
    }
}

/**
 * Sets up the CRT shader locations.
 * This method initializes the necessary shader locations for the crt shader program used in the GL view.
 * It sets the resolution vector, retrieves the attribute and uniform locations,
 * and enables the position and texcoord attributes for the shader.
 */
export function setupCRTShaderLocations(gl: WebGL2RenderingContext): void {
    const locations = {
        vertex: gl.getAttribLocation(CRTShaderProgram, 'a_position'),
        texturecoord: gl.getAttribLocation(CRTShaderProgram, 'a_texcoord'),
        resolution: gl.getUniformLocation(CRTShaderProgram, 'u_resolution'),
        random: gl.getUniformLocation(CRTShaderProgram, 'u_random'),
        time: gl.getUniformLocation(CRTShaderProgram, 'u_time')
    };
    CRTShaderVertexLocation = locations.vertex;
    CRTShaderTexcoordLocation = locations.texturecoord;
    CRTShaderResolutionLocation = locations.resolution;
    CRTShaderTimeLocation = locations.time;
    CRTShaderRandomLocation = locations.random;
    CRTShaderApplyNoiseLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyNoise');
    CRTShaderApplyColorBleedLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyColorBleed');
    CRTShaderApplyScanlinesLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyScanlines');
    CRTShaderApplyBlurLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyBlur');
    CRTShaderApplyGlowLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyGlow');
    CRTShaderApplyFringingLocation = gl.getUniformLocation(CRTShaderProgram, 'u_applyFringing');
    CRTShaderNoiseIntensityLocation = gl.getUniformLocation(CRTShaderProgram, 'u_noiseIntensity');
    CRTShaderColorBleedLocation = gl.getUniformLocation(CRTShaderProgram, 'u_colorBleed');
    CRTShaderBlurIntensityLocation = gl.getUniformLocation(CRTShaderProgram, 'u_blurIntensity');
    CRTShaderGlowColorLocation = gl.getUniformLocation(CRTShaderProgram, 'u_glowColor');
    CRTVertexShaderScaleLocation = gl.getUniformLocation(CRTShaderProgram, 'u_scale');
    CRTFragmentShaderScaleLocation = gl.getUniformLocation(CRTShaderProgram, 'u_fragscale');
    CRTFragmentShaderTextureLocation = gl.getUniformLocation(CRTShaderProgram, 'u_texture');

    // Enable the position attribute for the shader
    gl.enableVertexAttribArray(CRTShaderVertexLocation);

    // Enable the texcoord attribute for the shader
    gl.enableVertexAttribArray(CRTShaderTexcoordLocation);
}

export function setDefaultUniformValues(gl: WebGL2RenderingContext, options: CRTShaderOptions): void {
    setCrtOptions(gl, options); // Also sets the current program to CRTShaderProgram
    gl.uniform1f(CRTVertexShaderScaleLocation, 1.0);
    gl.uniform1f(CRTFragmentShaderScaleLocation, 1.0);
    const POST_UNIT = gl.TEXTURE8; // Use a texture unit that is not used by the game shader
    const CRTFRAGMENT_SHADER_TEXTURE_UNIT_INDEX = POST_UNIT - gl.TEXTURE0; // Calculate the texture unit index for the CRT fragment shader
    gl.uniform1i(CRTFragmentShaderTextureLocation, CRTFRAGMENT_SHADER_TEXTURE_UNIT_INDEX); // Set the texture unit for the post-processing shader texture. Note that the uniform expects an index instead of a WebGLTexture object, so we subtract gl.TEXTURE0 to get the index of the texture unit.
    // Note that the resolution vector is set in the handleResize method for the CRT shader
}

/**
 * Creates the CRT shader vertex buffer for the full-screen quad used in the CRT fragment shader.
 */
export function createCRTVertexBuffer(gl: WebGL2RenderingContext, width: number, height: number): void {
    // Define the vertex positions for a full-screen quad (in clip space)
    const vertices = new Float32Array([
        -1.0, -1.0, // bottom left
        1.0, -1.0, // bottom right
        -1.0, 1.0, // top left
        1.0, -1.0, // bottom right
        1.0, 1.0, // top right
        -1.0, 1.0  // top left
    ]);

    // Create a new buffer and bind the vertex position data to it
    bvec.set(vertices, 0, 0, 0, width, height, 1, 1);
    CRTShaderVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, CRTShaderVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

/**
 * Creates the CRT shader texture coordinate buffer for the full-screen quad used in the CRT fragment shader.
 */
export function createCRTShaderTexcoordBuffer(gl: WebGL2RenderingContext): void {
    // Define the texture coordinates for a full-screen quad
    const texcoords = new Float32Array([
        // Match the vertex ordering used by bvec.set so the image isn't
        // rotated or mirrored when drawn as a full-screen quad
        0.0, 1.0, // top-left
        0.0, 0.0, // bottom-left
        1.0, 1.0, // top-right
        1.0, 1.0, // top-right
        0.0, 0.0, // bottom-left
        1.0, 0.0, // bottom-right
    ]);

    // Create a new buffer and bind the texture coordinate data to it
    CRTShaderTexcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, CRTShaderTexcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
}

export function handleResize(gl: WebGL2RenderingContext, newWidth: number, newHeight: number): void {
    // Set the resolution uniform
    if (CRTShaderResolutionLocation) { // This is only set if the additional shader is being used
        gl.useProgram(CRTShaderProgram);
        gl.uniform2fv(CRTShaderResolutionLocation, new Float32Array([newWidth, newHeight]));
    }
}
