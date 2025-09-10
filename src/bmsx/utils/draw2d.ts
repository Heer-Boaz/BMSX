import type { color, RectRenderSubmission } from "../render/gameview";
import type { Polygon } from "../rompack/rompack";
import * as SpritesPipeline from "../render/2d/sprites_pipeline";

/**
 * 2D draw helpers that enqueue into the sprites pipeline.
 * Prefer these from gameplay/UI code instead of calling GameView methods.
 */
export function drawRectangle(options: RectRenderSubmission): void {
    SpritesPipeline.drawRectangle(options);
}

export function fillRectangle(options: RectRenderSubmission): void {
    SpritesPipeline.fillRectangle(options);
}

export function drawPolygon(points: Polygon, z: number, c: color, thickness: number = 1, layer?: 'world' | 'ui'): void {
    SpritesPipeline.drawPolygon(points, z, c, thickness, layer);
}
