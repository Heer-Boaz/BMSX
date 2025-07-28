import { new_vec2, new_vec3 } from '../../core/game';
import type { ImgMeta, Polygon } from '../../rompack/rompack';
import { switchProgram as glSwitchProgram, updateBuffer as glUpdateBuffer } from '../glutils';
import {
    ATLAS_ID_BUFFER_OFFSET_MULTIPLIER,
    ATLAS_ID_COMPONENTS,
    COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER,
    COLOR_OVERRIDE_COMPONENTS,
    DEFAULT_VERTEX_COLOR,
    DEFAULT_ZCOORD,
    MAX_SPRITES,
    POSITION_COMPONENTS,
    SPRITE_DRAW_OFFSET,
    TEXCOORD_COMPONENTS,
    VERTEX_BUFFER_OFFSET_MULTIPLIER,
    VERTICES_PER_SPRITE,
    ZCOORD_BUFFER_OFFSET_MULTIPLIER,
    ZCOORD_COMPONENTS,
    ZCOORD_MAX,
} from '../glview.constants';
import { bvec } from './vertexutils2d';
import { BaseView, Color, DrawImgOptions, DrawRectOptions } from '../view';
import type { GLView } from '../glview';

let imagesToDraw: { options: DrawImgOptions; imgmeta: ImgMeta }[] = [];

export function renderSpriteBatch(view: GLView): void {
    const self = view as any;
    const gl: WebGL2RenderingContext = self.glctx;

    gl.bindFramebuffer(gl.FRAMEBUFFER, self.framebuffer);
    gl.viewport(0, 0, view.offscreenCanvasSize.x, view.offscreenCanvasSize.y);
    glSwitchProgram(gl, self.gameShaderProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, self.vertexBuffer);
    gl.vertexAttribPointer(self.vertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(self.vertexLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, self.texcoordBuffer);
    gl.vertexAttribPointer(self.texcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(self.texcoordLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, self.zBuffer);
    gl.vertexAttribPointer(self.zcoordLocation, ZCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(self.zcoordLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, self.color_overrideBuffer);
    gl.vertexAttribPointer(self.color_overrideLocation, COLOR_OVERRIDE_COMPONENTS, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(self.color_overrideLocation);

    gl.bindBuffer(gl.ARRAY_BUFFER, self.atlas_idBuffer);
    gl.vertexAttribIPointer(self.atlas_idLocation, ATLAS_ID_COMPONENTS, gl.UNSIGNED_BYTE, 0, 0);
    gl.enableVertexAttribArray(self.atlas_idLocation);

    imagesToDraw.sort((i1, i2) => (i1.options.pos.z ?? 0) - (i2.options.pos.z ?? 0));

    const data = self.vertex_shader_data;
    const { vertexcoords, texcoords, zcoords, color_override, atlas_id } = data;
    let i = 0;
    for (const { options, imgmeta } of imagesToDraw) {
        const { pos, flip = { flip_h: false, flip_v: false }, scale = { x: 1, y: 1 }, colorize = DEFAULT_VERTEX_COLOR } = options;
        const { width, height } = imgmeta;
        bvec.set(vertexcoords, i, pos.x, pos.y, width, height, scale.x, scale.y);
        bvec.set_texturecoords(texcoords, i, getTexCoords(flip.flip_h, flip.flip_v, imgmeta));
        bvec.set_zcoord(zcoords, i, (pos.z ?? DEFAULT_ZCOORD) / ZCOORD_MAX);
        bvec.set_color(color_override, i, colorize);
        bvec.set_atlas_id(atlas_id, i, imgmeta.atlasid);
        ++i;
        if (i >= MAX_SPRITES) {
            updateBuffers(view, gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0);
            gl.drawArrays(gl.TRIANGLES, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE * i);
            i = 0;
        }
    }

    if (i > 0) {
        updateBuffers(view, gl, vertexcoords, texcoords, zcoords, color_override, atlas_id, 0);
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

export function updateBuffers(view: GLView, gl: WebGL2RenderingContext, vertexcoords: Float32Array, texcoords: Float32Array, zcoords: Float32Array, color_override: Float32Array, atlasid: Uint8Array, index: number): void {
    const self = view as any;
    glUpdateBuffer(gl, self.vertexBuffer, gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, vertexcoords);
    glUpdateBuffer(gl, self.texcoordBuffer, gl.ARRAY_BUFFER, VERTEX_BUFFER_OFFSET_MULTIPLIER * index, texcoords);
    glUpdateBuffer(gl, self.zBuffer, gl.ARRAY_BUFFER, ZCOORD_BUFFER_OFFSET_MULTIPLIER * index, zcoords);
    glUpdateBuffer(gl, self.color_overrideBuffer, gl.ARRAY_BUFFER, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER * index, color_override);
    glUpdateBuffer(gl, self.atlas_idBuffer, gl.ARRAY_BUFFER, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER * index, atlasid);
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
