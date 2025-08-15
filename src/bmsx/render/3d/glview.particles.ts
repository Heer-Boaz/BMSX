import type { vec3arr } from '../../rompack/rompack';
import { glLoadShader, glSwitchProgram } from '../glutils';
import { Color } from '../view';
import { M4 } from './math3d';
import particleFragCode from './shaders/particle.frag.glsl';
import particleVertCode from './shaders/particle.vert.glsl';

export interface DrawParticleOptions {
    position: vec3arr;
    size: number;
    color: Color;
}

export let particlesToDraw: DrawParticleOptions[] = [];

const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 8; // vec4(position+size) + vec4(color)
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;

let particleProgram: WebGLProgram;
let vao: WebGLVertexArrayObject;
let quadBuffer: WebGLBuffer;
let instanceBuffer: WebGLBuffer;
let viewProjLocation: WebGLUniformLocation;
let cameraRightLocation: WebGLUniformLocation;
let cameraUpLocation: WebGLUniformLocation;

const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS);
const camRight = new Float32Array(3);
const camUp = new Float32Array(3);

export function init(gl: WebGL2RenderingContext): void {
    vao = gl.createVertexArray()!;
    quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const quad = new Float32Array([
        -0.5, -0.5,
        0.5, -0.5,
        0.5, 0.5,
        -0.5, -0.5,
        0.5, 0.5,
        -0.5, 0.5,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

export function createParticleProgram(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram()!;
    particleProgram = program;
    const vert = glLoadShader(gl, gl.VERTEX_SHADER, particleVertCode);
    const frag = glLoadShader(gl, gl.FRAGMENT_SHADER, particleFragCode);
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(`Unable to initialize the particle shader program: ${gl.getProgramInfoLog(program)}`);
    }
    viewProjLocation = gl.getUniformLocation(program, 'u_viewProjection')!;
    cameraRightLocation = gl.getUniformLocation(program, 'u_cameraRight')!;
    cameraUpLocation = gl.getUniformLocation(program, 'u_cameraUp')!;
}

export function setupParticleLocations(gl: WebGL2RenderingContext): void {
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * INSTANCE_BYTES, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

export function renderParticleBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
    const count = particlesToDraw.length;
    if (count === 0) return;

    const activeCamera = $.model.activeCamera3D;
    M4.viewRightUpInto(activeCamera.view, camRight, camUp);

    for (let i = 0; i < count && i < MAX_PARTICLES; i++) {
        const p = particlesToDraw[i];
        const base = i * INSTANCE_FLOATS;
        instanceData[base] = p.position[0];
        instanceData[base + 1] = p.position[1];
        instanceData[base + 2] = p.position[2];
        instanceData[base + 3] = p.size;
        instanceData[base + 4] = p.color.r;
        instanceData[base + 5] = p.color.g;
        instanceData[base + 6] = p.color.b;
        instanceData[base + 7] = p.color.a;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, count * INSTANCE_FLOATS));

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    glSwitchProgram(gl, particleProgram);
    gl.uniformMatrix4fv(viewProjLocation, false, activeCamera.viewProjection);
    gl.uniform3fv(cameraRightLocation, camRight);
    gl.uniform3fv(cameraUpLocation, camUp);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    particlesToDraw.length = 0;
}
