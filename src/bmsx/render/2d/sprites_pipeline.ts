// Sprites pipeline (formerly glview.2d) inlined from legacy module.
// Provides batched 2D sprite + primitive rendering using shared buffers.
import { WebGLBackend } from '../..';
import { new_vec2, new_vec3 } from '../../core/utils';
import type { ImgMeta, Polygon, vec2arr } from '../../rompack/rompack';
import * as GLR from '../backend/gl_resources';
import { GPUBackend } from '../backend/pipeline_interfaces';
import { getRenderContext } from '../backend/pipeline_registry';
import {
    ATLAS_ID_BUFFER_OFFSET_MULTIPLIER,
    ATLAS_ID_COMPONENTS,
    ATLAS_ID_SIZE,
    COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER,
    COLOR_OVERRIDE_COMPONENTS,
    COLOR_OVERRIDE_SIZE,
    DEFAULT_VERTEX_COLOR,
    DEFAULT_ZCOORD,
    MAX_SPRITES,
    POSITION_COMPONENTS,
    RESOLUTION_VECTOR_SIZE,
    SPRITE_DRAW_OFFSET,
    TEXCOORD_COMPONENTS,
    TEXTURE_UNIT_ATLAS, TEXTURE_UNIT_ATLAS_DYNAMIC,
    TEXTURECOORDS_SIZE,
    VERTEX_BUFFER_OFFSET_MULTIPLIER,
    VERTICES_PER_SPRITE,
    ZCOORD_BUFFER_OFFSET_MULTIPLIER,
    ZCOORD_COMPONENTS,
    ZCOORD_MAX,
    ZCOORDS_SIZE
} from '../backend/webgl.constants';
import { color, DrawImgOptions, DrawRectOptions, GameView } from '../view';
// import { ScratchBatch } from '../../core/scratchbatch';
import { FeatureQueue } from '../backend/feature_queue';
import { bvec } from './vertexutils2d';

export let spriteShaderProgram: WebGLProgram;
let vertexLocation: number;
let texcoordLocation: number;
let zcoordLocation: number;
let color_overrideLocation: number;
let atlas_idLocation: number;
let resolutionLocation: WebGLUniformLocation;
let texture0Location: WebGLUniformLocation;
let texture1Location: WebGLUniformLocation;
let vertexBuffer: WebGLBuffer;
let texcoordBuffer: WebGLBuffer;
let zBuffer: WebGLBuffer;
let color_overrideBuffer: WebGLBuffer;
let atlas_idBuffer: WebGLBuffer;
let spriteVAO: WebGLVertexArrayObject | null = null;
const spriteShaderData = {
    resolutionVector: new Float32Array(RESOLUTION_VECTOR_SIZE),
    vertexcoords: null as Float32Array | null, // Lazy init to avoid circular dependency timing with backend
    texcoords: new Float32Array(TEXTURECOORDS_SIZE * MAX_SPRITES),
    zcoords: new Float32Array(ZCOORDS_SIZE * MAX_SPRITES),
    color_override: new Float32Array(COLOR_OVERRIDE_SIZE * MAX_SPRITES),
    atlas_id: new Uint8Array(ATLAS_ID_SIZE * MAX_SPRITES),
};
let spriteShaderScaleLocation: WebGLUniformLocation;
// Feature-local, double-buffered submission queue (UE-like feature queue)
type SpriteSubmission = { options: DrawImgOptions; imgmeta: ImgMeta };
const spriteQueue = new FeatureQueue<SpriteSubmission>(256);

// Removed: program creation is handled by the backend/pipeline manager

export function setupSpriteShaderLocations(backend: GPUBackend): void {
    const gl = (backend as WebGLBackend).gl;
    // If program not explicitly created yet, pick up the program bound by the PipelineManager
    if (!spriteShaderProgram) {
        const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
        if (!current) throw new Error('Sprite shader program not bound during bootstrap');
        spriteShaderProgram = current;
    }
    const locations = {
        vertex: gl.getAttribLocation(spriteShaderProgram, 'a_position'),
        texcoord: gl.getAttribLocation(spriteShaderProgram, 'a_texcoord'),
        zcoord: gl.getAttribLocation(spriteShaderProgram, 'a_pos_z'),
        color_override: gl.getAttribLocation(spriteShaderProgram, 'a_color_override'),
        atlas_id: gl.getAttribLocation(spriteShaderProgram, 'a_atlas_id'),
    };
    vertexLocation = locations.vertex;
    texcoordLocation = locations.texcoord;
    zcoordLocation = locations.zcoord;
    color_overrideLocation = locations.color_override;
    atlas_idLocation = locations.atlas_id;
    resolutionLocation = gl.getUniformLocation(spriteShaderProgram, 'u_resolution')!;
    texture0Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture0')!;
    texture1Location = gl.getUniformLocation(spriteShaderProgram, 'u_texture1')!;
    spriteShaderScaleLocation = gl.getUniformLocation(spriteShaderProgram, 'u_scale');
}

export function setupDefaultUniformValues(backend: GPUBackend, defaultScale: number, canvasSize: vec2arr): void {
    const gl = (backend as WebGLBackend).gl;
    gl.useProgram(spriteShaderProgram);
    gl.uniform1f(spriteShaderScaleLocation, defaultScale);
    spriteShaderData.resolutionVector.set([canvasSize[0], canvasSize[1]]);
    gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
    gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS);
    gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_DYNAMIC);
}

export function setupBuffers(fbo: unknown): void {
    const gl = (getRenderContext().getBackend() as WebGLBackend).gl;
    if (!spriteShaderData.vertexcoords) spriteShaderData.vertexcoords = GLR.buildQuadTexCoords();
    const cvertexBuffer = GLR.glCreateBuffer(gl, spriteShaderData.vertexcoords);
    const ctexcoordBuffer = GLR.glCreateBuffer(gl, spriteShaderData.texcoords);
    const czBuffer = GLR.glCreateBuffer(gl, spriteShaderData.zcoords);
    const ccolor_overrideBuffer = GLR.glCreateBuffer(gl, spriteShaderData.color_override);
    const catlas_idBuffer = GLR.glCreateBuffer(gl, spriteShaderData.atlas_id);
    vertexBuffer = cvertexBuffer;
    texcoordBuffer = ctexcoordBuffer;
    zBuffer = czBuffer;
    color_overrideBuffer = ccolor_overrideBuffer;
    atlas_idBuffer = catlas_idBuffer;
}

export function setupSpriteLocations(backend: GPUBackend): void {
    // Program is bound by the backend; prefer VAO to avoid per-frame attrib churn
    const gl = (backend as WebGLBackend).gl;
    try {
        const vao = backend.createVertexArray ? backend.createVertexArray() as WebGLVertexArrayObject : null;
        if (vao && backend.bindVertexArray) {
            backend.bindVertexArray(vao);
            backend.bindArrayBuffer?.(vertexBuffer);
            backend.enableVertexAttrib?.(vertexLocation);
            backend.vertexAttribPointer?.(vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
            backend.bindArrayBuffer?.(texcoordBuffer);
            backend.enableVertexAttrib?.(texcoordLocation);
            backend.vertexAttribPointer?.(texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
            backend.bindArrayBuffer?.(zBuffer);
            backend.enableVertexAttrib?.(zcoordLocation);
            backend.vertexAttribPointer?.(zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
            backend.bindArrayBuffer?.(color_overrideBuffer);
            backend.enableVertexAttrib?.(color_overrideLocation);
            backend.vertexAttribPointer?.(color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0);
            backend.bindArrayBuffer?.(atlas_idBuffer);
            backend.enableVertexAttrib?.(atlas_idLocation);
            backend.vertexAttribIPointer?.(atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0);
            backend.bindVertexArray(null);
            spriteVAO = vao;
        } else {
            spriteVAO = null; // Fallback to per-draw attribute binding
        }
    } catch {
        spriteVAO = null;
    }
}

// Note: 'fbo' is provided by the render graph and used only to satisfy the
// PassEncoder shape for backend.draw(). WebGL draw ignores it; WebGPU may use it.
export function renderSpriteBatch(
    fbo: unknown,
    canvasWidth: number,
    canvasHeight: number,
    logicalWidth?: number,
    logicalHeight?: number,
): void {
    const gl = (getRenderContext().getBackend() as WebGLBackend).gl;
    // Use feature queue
    spriteQueue.swap();
    if (spriteQueue.sizeFront() === 0) return;
    // FBO binding handled by RenderGraph beginRenderPass
    const backend = getRenderContext().getBackend() as WebGLBackend;
    backend.setViewport?.({ x: 0, y: 0, w: canvasWidth, h: canvasHeight });
    // backend.setCullEnabled(false);
    // backend.setDepthMask(false);
    // backend.setBlendEnabled(true);
    // const resW = logicalWidth ?? canvasWidth;
    // const resH = logicalHeight ?? canvasHeight;
    // // Update resolution uniform if changed (dynamic resize safety) using logical size
    // if (spriteShaderData.resolutionVector[0] !== resW || spriteShaderData.resolutionVector[1] !== resH) {
    //     spriteShaderData.resolutionVector[0] = resW; spriteShaderData.resolutionVector[1] = resH;
    //     gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
    // }
    const useVAO = !!spriteVAO && !!backend.bindVertexArray;
    if (useVAO) {
        backend.bindVertexArray!(spriteVAO as unknown as WebGLVertexArrayObject);
    } else {
        // Fallback path: bind attributes explicitly each frame
        backend.bindArrayBuffer?.(vertexBuffer); backend.vertexAttribPointer?.(vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(vertexLocation);
        backend.bindArrayBuffer?.(texcoordBuffer); backend.vertexAttribPointer?.(texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(texcoordLocation);
        backend.bindArrayBuffer?.(zBuffer); backend.vertexAttribPointer?.(zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(zcoordLocation);
        backend.bindArrayBuffer?.(color_overrideBuffer); backend.vertexAttribPointer?.(color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(color_overrideLocation);
        backend.bindArrayBuffer?.(atlas_idBuffer); backend.vertexAttribIPointer?.(atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0); backend.enableVertexAttrib?.(atlas_idLocation);
    }
    const front = spriteQueue.frontArray();
    front.sort((a, b) => (a.options.pos.z ?? 0) - (b.options.pos.z ?? 0));
    const { vertexcoords, texcoords, zcoords, color_override, atlas_id } = spriteShaderData; let i = 0;
    for (const { options, imgmeta } of front) {
        const { pos, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 }, colorize = DEFAULT_VERTEX_COLOR } = options;
        const { width, height } = imgmeta;
        bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
        bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
        const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
        bvec.set_zcoord(zcoords, i, zNorm);
        bvec.set_color(color_override, i, colorize);
        bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
        ++i;
        if (i >= MAX_SPRITES) { updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0); const passStub = { fbo, desc: { label: 'sprites' } } as unknown as Parameters<GPUBackend['draw']>[0]; backend.draw!(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i); i = 0; }
    }
    if (i > 0) { updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0); const passStub = { fbo, desc: { label: 'sprites' } } as unknown as Parameters<GPUBackend['draw']>[0]; backend.draw!(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i); }
    if (useVAO) backend.bindVertexArray!(null);
    // FeatureQueue back buffer already cleared on swap
}

export function drawImg(options: DrawImgOptions): void {
    const { imgid } = options; const imgmeta = GameView.imgassets[imgid]?.imgmeta; if (!imgmeta) throw Error(`Image with id '${imgid}' not found while trying to retrieve image metadata!`);
    // Deep-copy nested objects to freeze values at submission time
    spriteQueue.submit({
        options: {
            ...options,
            pos: options.pos ? { ...options.pos } : undefined,
            scale: options.scale ? { ...options.scale } : undefined,
            colorize: options.colorize ? { ...options.colorize } : undefined,
            flip: options.flip ? { ...options.flip } : undefined,
        },
        imgmeta,
    });
}

export function getQueuedSpriteCount(): number { return spriteQueue.sizeBack(); }
export function getSpriteQueueDebug(): { front: number; back: number } {
    try { return { front: spriteQueue.sizeFront(), back: spriteQueue.sizeBack() }; } catch { return { front: spriteQueue.frontArray().length, back: spriteQueue.sizeBack() }; }
}

export function getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: ImgMeta): number[] {
    if (flip_h && flip_v) return imgmeta['texcoords_fliphv'];
    if (flip_h) return imgmeta['texcoords_fliph'];
    if (flip_v) return imgmeta['texcoords_flipv'];
    return imgmeta['texcoords'];
}

export function updateBuffers(
    gl: WebGL2RenderingContext,
    vertexcoords: Float32Array,
    texcoords: Float32Array,
    zcoords: Float32Array,
    color_override: Float32Array,
    atlasid: Uint8Array,
    index: number,
): void {
    // Orphan + upload pattern to avoid driver stalls on mobile GPUs.
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexcoords.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, vertexcoords);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, texcoords);

    gl.bindBuffer(gl.ARRAY_BUFFER, zBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, zcoords.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, ZCOORD_BUFFER_OFFSET_MULTIPLIER * index, zcoords);

    gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, color_override.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * index, color_override);

    gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, atlasid.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER * index, atlasid);
}

export function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
    if (ex < x) { [x, ex] = [ex, x]; }
    if (ey < y) { [y, ey] = [ey, y]; }
    return [x, y, ex, ey];
}

export function drawRectangle(options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg({ pos: new_vec3(x, ey, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
    drawImg({ pos: new_vec3(ex, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
}

export function fillRectangle(options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, ey - y), colorize: c });
}

export function drawPolygon(coords: Polygon, z: number, color: color, thickness: number = 1): void {
    if (!coords || coords.length < 4) return; const imgid = 'whitepixel';
    for (let i = 0; i < coords.length; i += 2) {
        let x0 = Math.round(coords[i]), y0 = Math.round(coords[i + 1]); const next = (i + 2) % coords.length; let x1 = Math.round(coords[next]), y1 = Math.round(coords[next + 1]);
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let err = dx - dy;
        if (dx > dy) {
            while (true) {
                drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); break; } if (e2 < dx) { err += dx; y0 += sy; }
            }
        } else {
            while (true) {
                drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); break; } if (e2 < dx) { err += dx; y0 += sy; }
            }
        }
    }
}
