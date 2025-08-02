import { new_vec2, new_vec3 } from '../../core/utils';
import type { ImgMeta, Polygon, vec2arr } from '../../rompack/rompack';
import { buildQuadTexCoords, glCreateBuffer, glLoadShader, glSetupAttributeFloat, glSetupAttributeInt, glSwitchProgram, glUpdateBuffer } from '../glutils';
import type { GLView } from '../glview';
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
} from '../glview.constants';
import { BaseView, Color, DrawImgOptions, DrawRectOptions } from '../view';
import spriteShaderFragCode from './shaders/2d.frag.glsl';
import spriteShaderVertCode from './shaders/2d.vert.glsl';
import { bvec } from './vertexutils2d';


let imagesToDraw: { options: DrawImgOptions; imgmeta: ImgMeta }[] = [];
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
    vertexcoords: buildQuadTexCoords(),
    texcoords: new Float32Array(TEXTURECOORDS_SIZE * MAX_SPRITES),
    zcoords: new Float32Array(ZCOORDS_SIZE * MAX_SPRITES),
    color_override: new Float32Array(COLOR_OVERRIDE_SIZE * MAX_SPRITES),
    atlas_id: new Uint8Array(ATLAS_ID_SIZE * MAX_SPRITES),
}
let spriteShaderScaleLocation: WebGLUniformLocation;


/**
 * Creates the sprite shader programs (vertex and fragment shaders).
 */
export function createSpriteShaderPrograms(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) throw Error(`Failed to create the GLSL program! Aborting as we cannot create the GLView for the game!`);
    spriteShaderProgram = program;
    const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, spriteShaderVertCode);
    const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, spriteShaderFragCode);

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw Error(`Unable to initialize the shader program: ${gl.getProgramInfoLog(program)} `);
    }
}

/**
 * Sets up the sprites shader locations for the sprite shader program.
 */
export function setupSpriteShaderLocations(gl: WebGL2RenderingContext): void {
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
    spriteShaderData.resolutionVector.set([...canvasSize]); // Set the resolution vector for the game shader, which uses a different resolution than the CRT shader
    gl.uniform2fv(resolutionLocation, spriteShaderData.resolutionVector);
    gl.uniform1i(texture0Location, 0); // Texture unit 0 is typically used for the main texture
    gl.uniform1i(texture1Location, 1); // Texture unit 1 can be used for additional textures or effects

}

export function setupBuffers(gl: WebGL2RenderingContext): void {
    const buffers = {
        vertex: glCreateBuffer(gl, spriteShaderData.vertexcoords),
        texturecoord: glCreateBuffer(gl, spriteShaderData.texcoords),
        z: glCreateBuffer(gl, spriteShaderData.zcoords),
        color_override: glCreateBuffer(gl, spriteShaderData.color_override),
        atlas_id: glCreateBuffer(gl, spriteShaderData.atlas_id),
    };

    vertexBuffer = buffers.vertex;
    texcoordBuffer = buffers.texturecoord;
    zBuffer = buffers.z;
    color_overrideBuffer = buffers.color_override;
    atlas_idBuffer = buffers.atlas_id;
}

/**
 * Sets up the attribute locations for the game shader program.
 * This method initializes the attribute locations for the vertex, texture coordinate, z-coordinate, and color override attributes.
 */
export function setupSpriteLocations(gl: WebGL2RenderingContext): void {
    glSwitchProgram(gl, spriteShaderProgram);

    glSetupAttributeFloat(gl, vertexBuffer, vertexLocation, VERTEX_ATTRIBUTE_SIZE);
    glSetupAttributeFloat(gl, texcoordBuffer, texcoordLocation, TEXTURECOORD_ATTRIBUTE_SIZE);
    glSetupAttributeFloat(gl, zBuffer, zcoordLocation, ZCOORD_ATTRIBUTE_SIZE);
    glSetupAttributeFloat(gl, color_overrideBuffer, color_overrideLocation, COLOR_OVERRIDE_ATTRIBUTE_SIZE);
    glSetupAttributeInt(gl, atlas_idBuffer, atlas_idLocation, ATLAS_ID_ATTRIBUTE_SIZE);
}

export function renderSpriteBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    glSwitchProgram(gl, spriteShaderProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.vertexAttribPointer(texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(texcoordLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, zBuffer);
    gl.vertexAttribPointer(zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(zcoordLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, color_overrideBuffer);
    gl.vertexAttribPointer(color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(color_overrideLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, atlas_idBuffer);
    gl.vertexAttribIPointer(atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0);
    gl.enableVertexAttribArray(atlas_idLocation);

    imagesToDraw.sort((i1, i2) => (i1.options.pos.z ?? 0) - (i2.options.pos.z ?? 0));

    const { vertexcoords, texcoords, zcoords, color_override, atlas_id } = spriteShaderData;
    let i = 0;
    for (const { options, imgmeta } of imagesToDraw) {
        const { pos, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 }, colorize = DEFAULT_VERTEX_COLOR } = options;
        const { width, height } = imgmeta;
        bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
        bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
        // With standard depth where 0 is near and 1 is far, higher z values
        // should appear in front. Normalize the sprite's z coordinate by
        // inverting it so that a larger pos.z results in a smaller depth value.
        const zNorm = 1 - (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX;
        bvec.set_zcoord(zcoords, i, zNorm);
        bvec.set_color(color_override, i, colorize);
        bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
        ++i;
        if (i >= MAX_SPRITES) {
            updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0);
            gl.drawArrays(gl.TRIANGLES, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i);
            i = 0;
        }
    }

    if (i > 0) {
        updateBuffers(gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0);
        gl.drawArrays(gl.TRIANGLES, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i);
    }

    imagesToDraw = [];
}

export function drawImg(view: GLView, options: DrawImgOptions): void {
    const { imgid } = options;
    const imgmeta = BaseView.imgassets[imgid]?.imgmeta;
    if (!imgmeta) {
        throw Error(`Image with id '${imgid}' not found while trying to retrieve image metadata!`);
    }

    const distinct = {
        ...options,
        pos: options.pos !== undefined ? { ...options.pos } : undefined,
        scale: options.scale !== undefined ? { ...options.scale } : undefined,
        colorize: options.colorize !== undefined ? { ...options.colorize } : undefined,
        flip: options.flip !== undefined ? { ...options.flip } : undefined,
    };

    imagesToDraw.push({ options: distinct, imgmeta });
}

export function getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: ImgMeta): number[] {
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

export function updateBuffers(gl: WebGL2RenderingContext, vertexcoords: Float32Array, texcoords: Float32Array, zcoords: Float32Array, color_override: Float32Array, atlasid: Uint8Array, index: number): void {
    glUpdateBuffer(gl, vertexBuffer, gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, vertexcoords);
    glUpdateBuffer(gl, texcoordBuffer, gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, texcoords);
    glUpdateBuffer(gl, zBuffer, gl.ARRAY_BUFFER, ZCOORD_BUFFER_OFFSET_MULTIPLIER * index, zcoords);
    glUpdateBuffer(gl, color_overrideBuffer, gl.ARRAY_BUFFER, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * index, color_override);
    glUpdateBuffer(gl, atlas_idBuffer, gl.ARRAY_BUFFER, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER * index, atlasid);
}

export function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
    if (ex < x) {
        [x, ex] = [ex, x];
    }
    if (ey < y) {
        [y, ey] = [ey, y];
    }
    return [x, y, ex, ey];
}

export function drawRectangle(view: GLView, options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area;
    const c = options.color;
    const imgid = 'whitepixel';
    [x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg(view, { pos: new_vec3(x, ey, z), imgid, scale: new_vec2(ex - x, 1), colorize: c });
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
    drawImg(view, { pos: new_vec3(ex, y, z), imgid, scale: new_vec2(1, ey - y), colorize: c });
}

export function fillRectangle(view: GLView, options: DrawRectOptions): void {
    let { start: { x, y, z }, end: { x: ex, y: ey } } = options.area;
    const c = options.color;
    const imgid = 'whitepixel';
    [x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
    drawImg(view, { pos: new_vec3(x, y, z), imgid, scale: new_vec2(ex - x, ey - y), colorize: c });
}

export function drawPolygon(view: GLView, coords: Polygon, z: number, color: Color, thickness: number = 1): void {
    if (!coords || coords.length < 4) return;
    const imgid = 'whitepixel';
    for (let i = 0; i < coords.length; i += 2) {
        let x0 = Math.round(coords[i]), y0 = Math.round(coords[i + 1]);
        let next = (i + 2) % coords.length;
        let x1 = Math.round(coords[next]), y1 = Math.round(coords[next + 1]);

        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        if (dx > dy) {
            while (true) {
                drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color });
                if (x0 === x1 && y0 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (x0 === x1 && y0 === y1) {
                    drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color });
                    break;
                }
                if (e2 < dx) { err += dx; y0 += sy; }
            }
        } else {
            while (true) {
                drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color });
                if (x0 === x1 && y0 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (x0 === x1 && y0 === y1) {
                    drawImg(view, { pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color });
                    break;
                }
                if (e2 < dx) { err += dx; y0 += sy; }
            }
        }
    }
}
