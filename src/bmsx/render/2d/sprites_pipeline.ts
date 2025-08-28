// Sprites pipeline (formerly glview.2d) inlined from legacy module.
// Provides batched 2D sprite + primitive rendering using shared buffers.
import { $ } from '../../core/game';
import { new_vec2, new_vec3 } from '../../core/utils';
import type { ImgMeta, Polygon, vec2arr } from '../../rompack/rompack';
import * as GLR from '../backend/gl_resources';
import { GPUBackend, RenderContext } from '../backend/pipeline_interfaces';
import { getRenderContext } from '../backend/pipeline_registry';
import {
    ATLAS_ID_ATTRIBUTE_SIZE,
    ATLAS_ID_BUFFER_OFFSET_MULTIPLIER,
    ATLAS_ID_COMPONENTS,
    ATLAS_ID_SIZE,
    COLOR_OVERRIDE_ATTRIBUTE_SIZE,
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
    TEXTURECOORD_ATTRIBUTE_SIZE,
    TEXTURECOORDS_SIZE,
    VERTEX_ATTRIBUTE_SIZE,
    VERTEX_BUFFER_OFFSET_MULTIPLIER,
    VERTICES_PER_SPRITE,
    ZCOORD_ATTRIBUTE_SIZE,
    ZCOORD_BUFFER_OFFSET_MULTIPLIER,
    ZCOORD_COMPONENTS,
    ZCOORD_MAX,
    ZCOORDS_SIZE,
} from '../backend/webgl.constants';
import { Color, DrawImgOptions, DrawRectOptions, GameView } from '../view';
import { RenderView } from '../view/render_view';
import { TEXTURE_UNIT_ATLAS, TEXTURE_UNIT_ATLAS_DYNAMIC } from '../backend/webgl.constants';
import spriteShaderFragCode from './shaders/2d.frag.glsl';
import spriteShaderVertCode from './shaders/2d.vert.glsl';
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
const spriteShaderData = {
    resolutionVector: new Float32Array(RESOLUTION_VECTOR_SIZE),
    vertexcoords: null as Float32Array | null, // Lazy init to avoid circular dependency timing with backend
    texcoords: new Float32Array(TEXTURECOORDS_SIZE * MAX_SPRITES),
    zcoords: new Float32Array(ZCOORDS_SIZE * MAX_SPRITES),
    color_override: new Float32Array(COLOR_OVERRIDE_SIZE * MAX_SPRITES),
    atlas_id: new Uint8Array(ATLAS_ID_SIZE * MAX_SPRITES),
};
let spriteShaderScaleLocation: WebGLUniformLocation;

export function createSpriteShaderPrograms(gl: WebGL2RenderingContext): void {
    const gv = $.viewAs<RenderView>();
    const b = gv.getBackend();
    const program = b.buildProgram(spriteShaderVertCode, spriteShaderFragCode, 'sprites');
    if (!program) throw Error('Failed to build sprite shader program');
    spriteShaderProgram = program;
}

export function setupSpriteShaderLocations(gl: WebGL2RenderingContext): void {
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

export function setupDefaultUniformValues(gl: WebGL2RenderingContext, defaultScale: number, canvasSize: vec2arr): void {
    gl.useProgram(spriteShaderProgram);
    gl.uniform1f(spriteShaderScaleLocation, defaultScale);
    spriteShaderData.resolutionVector.set([...canvasSize]);
    gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
    gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS);
    gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_DYNAMIC);
}

export function setupBuffers(gl: WebGL2RenderingContext): void {
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

export function setupSpriteLocations(gl: WebGL2RenderingContext): void {
    // Program is bound by the backend; set up attributes via backend helpers
    const backend = getRenderContext().getBackend();
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
}

export function renderSpriteBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, logicalWidth?: number, logicalHeight?: number): void {
    // Prefer centralized queue if available
    type V = { renderer?: { queues?: { sprites?: DrawImgOptions[] } } };
    const view = $.viewAs<RenderView>() as unknown as V;
    const queued = view.renderer?.queues?.sprites;
    const combined: { options: DrawImgOptions; imgmeta: ImgMeta }[] = [];
    if (queued && queued.length) {
        for (const options of queued) {
            const imgmeta = GameView.imgassets[options.imgid]?.imgmeta; if (!imgmeta) continue;
            // Deep-copy nested fields to avoid aliasing if the caller reuses objects
            const distinct: DrawImgOptions = {
                ...options,
                pos: options.pos ? { ...options.pos } : undefined,
                scale: options.scale ? { ...options.scale } : undefined,
                colorize: options.colorize ? { ...options.colorize } : undefined,
                flip: options.flip ? { ...options.flip } : undefined,
            };
            combined.push({ options: distinct, imgmeta });
        }
    }
    // no legacy sprite list; only centralized queue is used
    if (combined.length === 0) return;
    // FBO binding handled by RenderGraph beginRenderPass
    getRenderContext().getBackend().setViewport?.({ x: 0, y: 0, w: canvasWidth, h: canvasHeight });
    const resW = logicalWidth ?? canvasWidth;
    const resH = logicalHeight ?? canvasHeight;
    // Update resolution uniform if changed (dynamic resize safety) using logical size
    if (spriteShaderData.resolutionVector[0] !== resW || spriteShaderData.resolutionVector[1] !== resH) {
        spriteShaderData.resolutionVector[0] = resW; spriteShaderData.resolutionVector[1] = resH;
        gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
    }
    const backend = getRenderContext().getBackend();
    backend.bindArrayBuffer?.(vertexBuffer); backend.vertexAttribPointer?.(vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(vertexLocation);
    backend.bindArrayBuffer?.(texcoordBuffer); backend.vertexAttribPointer?.(texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(texcoordLocation);
    backend.bindArrayBuffer?.(zBuffer); backend.vertexAttribPointer?.(zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(zcoordLocation);
    backend.bindArrayBuffer?.(color_overrideBuffer); backend.vertexAttribPointer?.(color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0); backend.enableVertexAttrib?.(color_overrideLocation);
    backend.bindArrayBuffer?.(atlas_idBuffer); backend.vertexAttribIPointer?.(atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0); backend.enableVertexAttrib?.(atlas_idLocation);
    combined.sort((i1, i2) => (i1.options.pos.z ?? 0) - (i2.options.pos.z ?? 0));
    const { vertexcoords, texcoords, zcoords, color_override, atlas_id } = spriteShaderData; let i = 0;
    for (const { options, imgmeta } of combined) {
        const { pos, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 }, colorize = DEFAULT_VERTEX_COLOR } = options;
        const { width, height } = imgmeta;
        bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
        bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
        const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
        bvec.set_zcoord(zcoords, i, zNorm);
        bvec.set_color(color_override, i, colorize);
        bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
        ++i;
        if (i >= MAX_SPRITES) { updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0); const passStub = { fbo: framebuffer, desc: { label: 'sprites' } } as unknown as Parameters<GPUBackend['draw']>[0]; backend.draw!(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i); i = 0; }
    }
    if (i > 0) { updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0); const passStub = { fbo: framebuffer, desc: { label: 'sprites' } } as unknown as Parameters<GPUBackend['draw']>[0]; backend.draw!(passStub, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i); }
    // Clear used queues
    if (queued) queued.length = 0;
}

export function drawImg(view: RenderContext, options: DrawImgOptions): void {
    const { imgid } = options; const imgmeta = GameView.imgassets[imgid]?.imgmeta; if (!imgmeta) throw Error(`Image with id '${imgid}' not found while trying to retrieve image metadata!`);
    const gv = $.viewAs<RenderView>() as unknown as { renderer?: { queues?: { sprites?: DrawImgOptions[] } } };
    const q = gv.renderer?.queues?.sprites;
    if (!q) throw Error('Render queues not initialized for sprites');
    // Deep-copy nested objects to freeze values at submission time
    q.push({
        ...options,
        pos: options.pos ? { ...options.pos } : undefined,
        scale: options.scale ? { ...options.scale } : undefined,
        colorize: options.colorize ? { ...options.colorize } : undefined,
        flip: options.flip ? { ...options.flip } : undefined,
    });
}

export function getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: ImgMeta): number[] {
    if (flip_h && flip_v) return imgmeta['texcoords_fliphv'];
    if (flip_h) return imgmeta['texcoords_fliph'];
    if (flip_v) return imgmeta['texcoords_flipv'];
    return imgmeta['texcoords'];
}

export function updateBuffers(gl: WebGL2RenderingContext, vertexcoords: Float32Array, texcoords: Float32Array, zcoords: Float32Array, color_override: Float32Array, atlasid: Uint8Array, index: number): void {
    const backend = getRenderContext().getBackend();
    backend.updateVertexBuffer?.(vertexBuffer, vertexcoords, VERTEX_BUFFER_OFFSET_MULTIPLIER * index);
    backend.updateVertexBuffer?.(texcoordBuffer, texcoords, VERTEX_BUFFER_OFFSET_MULTIPLIER * index);
    backend.updateVertexBuffer?.(zBuffer, zcoords, ZCOORD_BUFFER_OFFSET_MULTIPLIER * index);
    backend.updateVertexBuffer?.(color_overrideBuffer, color_override, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * index);
    backend.updateVertexBuffer?.(atlas_idBuffer, atlasid, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER * index);
}

// For scheduling checks
// No legacy pending count; scheduling uses centralized queue length.

export function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
    if (ex < x) { [x, ex] = [ex, x]; }
    if (ey < y) { [y, ey] = [ey, y]; }
    return [x, y, ex, ey];
}

export function drawRectangle(view: RenderContext, options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg(view, { pos: new_vec3(x, ey, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
    drawImg(view, { pos: new_vec3(ex, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
}

export function fillRectangle(view: RenderContext, options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area; const c = options.color; const imgid = 'whitepixel';[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, ey - y), colorize: c });
}

export function drawPolygon(view: RenderContext, coords: Polygon, z: number, color: Color, thickness: number = 1): void {
    if (!coords || coords.length < 4) return; const imgid = 'whitepixel';
    for (let i = 0; i < coords.length; i += 2) {
        let x0 = Math.round(coords[i]), y0 = Math.round(coords[i + 1]); const next = (i + 2) % coords.length; let x1 = Math.round(coords[next]), y1 = Math.round(coords[next + 1]);
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let err = dx - dy;
        if (dx > dy) {
            while (true) {
                drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); break; } if (e2 < dx) { err += dx; y0 += sy; }
            }
        } else {
            while (true) {
                drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color }); break; } if (e2 < dx) { err += dx; y0 += sy; }
            }
        }
    }
}
