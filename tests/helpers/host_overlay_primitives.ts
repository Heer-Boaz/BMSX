import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';

export const hostOverlayPrimitives: readonly [string, Host2DKind, Host2DRef][] = [
	['fill', Host2DKind.Rect, { kind: RectRenderKind.Fill, area: { left: 2, top: 3, right: 60, bottom: 44, z: 0 }, color: 0xffffffff, layer: LAYER_2D_IDE }],
	['stroke', Host2DKind.Rect, { kind: RectRenderKind.Rect, area: { left: 8, top: 12, right: 48, bottom: 39, z: 0 }, color: 0xffffffff, layer: LAYER_2D_IDE }],
	['poly', Host2DKind.Poly, { points: [0, 1, 60, 42, 60, 20, 0, 20], z: 0, color: 0xffffffff, thickness: 3, layer: LAYER_2D_IDE }],
	['fractional poly', Host2DKind.Poly, { points: [-3.5, 2.5, 60.9, 40.4], z: 0, color: 0xffffffff, thickness: 2.5, layer: LAYER_2D_IDE }],
	['image', Host2DKind.Img, { imgid: new Font({ variant: 'tiny' }).getGlyph('A').imgid, pos: { x: 7, y: 5, z: 0 }, scale: { x: 8, y: 8 }, flip: { flip_h: true, flip_v: true }, colorize: 0xffffffff, ambient_affected: false, ambient_factor: 1, layer: LAYER_2D_IDE }],
	['glyphs', Host2DKind.Glyphs, { items: 'ABCDEFGHIJ\nKLMNOPQRST\nUVWXYZ', item_start: 0, item_end: 28, x: 8, y: 7, z: 0, font: new Font({ variant: 'tiny' }), color: 0xffffffff, has_background_color: true, background_color: 0xff223344, layer: LAYER_2D_IDE }],
];
