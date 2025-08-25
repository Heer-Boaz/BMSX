import { ATLAS_ID_ATTRIBUTE_SIZE, ATLAS_ID_SIZE, COLOR_OVERRIDE_ATTRIBUTE_SIZE, COLOR_OVERRIDE_SIZE, TEXTURECOORDS_SIZE, VERTEXCOORDS_SIZE, ZCOORDS_SIZE, ZCOORD_ATTRIBUTE_SIZE } from '../backend/webgl.constants';
import type { Color } from '../view';


export const bvec = {
    set(v: Float32Array, i: number, x: number, y: number, w: number, h: number, sx: number, sy: number): void {
        const x2 = x + w * sx, y2 = y + h * sy, offset = i * VERTEXCOORDS_SIZE;
        // Arrange vertices so that, after the Y axis is flipped in the vertex
        // shader, the triangles maintain a counter clockwise winding order. This
        // allows front faces to be rendered correctly when using standard back
        // face culling.
        v.set([x, y, x, y2, x2, y, x2, y, x, y2, x2, y2], offset);
    },
    set_texturecoords(v: Float32Array, i: number, coords: number[]): void {
        const offset = i * TEXTURECOORDS_SIZE;
        v.set(coords, offset);
    },
    set_zcoord(v: Float32Array, i: number, z: number): void {
        const offset = i * ZCOORDS_SIZE;
        for (let j = offset; j < offset + ZCOORDS_SIZE; j += ZCOORD_ATTRIBUTE_SIZE) v[j] = z;
    },
    set_color(v: Float32Array, i: number, color: Color): void {
        const offset = i * COLOR_OVERRIDE_SIZE;
        const colorArray = [color.r, color.g, color.b, color.a];
        for (let j = offset; j < offset + COLOR_OVERRIDE_SIZE; j += COLOR_OVERRIDE_ATTRIBUTE_SIZE) v.set(colorArray, j);
    },
    set_atlas_id(v: Uint8Array, i: number, atlas_id: number): void {
        const offset = i * ATLAS_ID_SIZE;
        for (let j = offset; j < offset + ATLAS_ID_SIZE; j += ATLAS_ID_ATTRIBUTE_SIZE) v[j] = atlas_id;
    }
};
