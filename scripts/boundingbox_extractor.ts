const { createCanvas } = require('canvas');
import type { Image } from 'canvas';
import type { Area, BoundingBoxPrecalc, vec2arr } from '../src/bmsx/rompack';

/**
 * Dedicated class for extracting bounding boxes and related operations from images.
 */
export class BoundingBoxExtractor {
    /**
     * Extracts the tightest bounding box around non-transparent pixels in an image.
     */
    static extractBoundingBox(image: Image): Area {
        const canvas = createCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, image.width, image.height);
        const imageData = context.getImageData(0, 0, image.width, image.height);
        const data = imageData.data;

        let startx = image.width, starty = image.height, endx = 0, endy = 0;
        let totalWeightX = 0, totalWeightY = 0;
        let totalAlpha = 0;

        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
                const index = (y * image.width + x) * 4;
                const alpha = data[index + 3];
                if (alpha !== 0) {
                    startx = Math.min(startx, x);
                    starty = Math.min(starty, y);
                    endx = Math.max(endx, x);
                    endy = Math.max(endy, y);
                    totalWeightX += x * alpha;
                    totalWeightY += y * alpha;
                    totalAlpha += alpha;
                }
            }
        }
        return { start: { x: ~~startx, y: ~~starty }, end: { x: ~~endx, y: ~~endy } };
    }

    /**
     * Extracts concave hull polygons for each contiguous non-transparent region (shape) in the image.
     * Uses BFS for connected-component labeling and Andrew's monotone chain for concave hull extraction.
     * Returns an array of polygons (each as an array of {x, y} points), one for each detected shape.
     *
     * @param image The image to analyze.
     * @returns Array of concave hull polygons, one per detected shape.
     */
    static extractConcaveHull(image: Image): vec2arr[][] {
        const width = image.width;
        const height = image.height;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, width, height);
        const data = imageData.data;
        // Visited map: 1D array for performance
        const visited = new Uint8Array(width * height);
        const polygons: vec2arr[][] = [];
        // Helper to get alpha at (x, y)
        function alphaAt(x: number, y: number): number {
            return data[(y * width + x) * 4 + 3];
        }

        function isBorder(x: number, y: number): boolean {
            if (alphaAt(x, y) === 0) return false;        // transparant → geen contour
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
            return (
                alphaAt(x - 1, y) === 0 || alphaAt(x + 1, y) === 0 ||
                alphaAt(x, y - 1) === 0 || alphaAt(x, y + 1) === 0
            );
        }

        // Moore-Neighbor tracing (border following)
        function traceBorder(sx: number, sy: number): vec2arr[] {
            const dirs = [
                [1, 0], [1, 1], [0, 1], [-1, 1],
                [-1, 0], [-1, -1], [0, -1], [1, -1]
            ] as const;

            const border: vec2arr[] = [];
            let px = sx, py = sy;
            let dir = 0;                         // uitgangsrichting
            const start = { x: sx, y: sy };

            do {
                // ------ 1. bewaar + markeer ----------------------------------------
                border.push([px, py]);
                visited[py * width + px] = 1;    // <-- nu meteen

                // ------ 2. zoek volgende on-bezochte rand­pixel --------------------
                let found = false;
                for (let k = 0; k < 8; k++) {
                    const ndir = (dir + 6 + k) & 7;      // (dir+6) = ‘links van inkomende’
                    const [dx, dy] = dirs[ndir];
                    const nx = px + dx, ny = py + dy;

                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    if (!visited[ny * width + nx] && isBorder(nx, ny)) {
                        px = nx; py = ny; dir = ndir;
                        found = true;
                        break;
                    }
                }
                if (!found) break;               // geïsoleerde pixel

            } while (!(px === start.x && py === start.y));

            return border;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (visited[idx]) continue;
                if (alphaAt(x, y) === 0) continue;
                // Only start tracing if this pixel is on the border
                let isBorder = false;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height || alphaAt(nx, ny) === 0) {
                        isBorder = true; break;
                    }
                }
                if (!isBorder) { visited[idx] = 1; continue; }
                // Trace the border
                const border = traceBorder(x, y);
                // Mark all border pixels as visited
                for (const pt of border) {
                    visited[pt[1] * width + pt[0]] = 1;
                }
                if (border.length > 2) {
                    polygons.push(border);
                }
            }
        }
        return polygons;
    }

    static extractConvexHull(image: Image): vec2arr[] {
        const { width, height } = image;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Check opacity
        const isOpaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] !== 0;

        // Check if pixel is on boundary
        const isBoundary = (x: number, y: number) => {
            if (!isOpaque(x, y)) return false;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height || !isOpaque(nx, ny)) return true;
            }
            return false;
        };

        const points: vec2arr[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (isBoundary(x, y)) {
                    points.push([x, y]);
                }
            }
        }

        return this.computeConvexPolygon(points);
    }

    private static computeConvexPolygon(points: vec2arr[]): vec2arr[] {
        if (points.length <= 1) return points.slice();
        const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const lower: vec2arr[] = [];
        for (const p of sorted) {
            while (lower.length >= 2 && this.cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
        const upper: vec2arr[] = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i];
            while (upper.length >= 2 && this.cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
        upper.pop();
        lower.pop();
        return lower.concat(upper);
    }

    /**
     * Cross product of OA and OB vectors (for concave hull orientation test).
     */
    static cross(o: vec2arr, a: vec2arr, b: vec2arr): number {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }

    static flipBoundingBoxHorizontally(box: Area, width: number): Area {
        return {
            start: { x: width - box.end.x, y: box.start.y },
            end: { x: width - box.start.x, y: box.end.y }
        };
    }

    static flipBoundingBoxVertically(box: Area, height: number): Area {
        return {
            start: { x: box.start.x, y: height - box.end.y },
            end: { x: box.end.x, y: height - box.start.y }
        };
    }

    static generateFlippedBoundingBox(image: Image, extractedBoundingBox: Area): BoundingBoxPrecalc {
        const originalBoundingBox = extractedBoundingBox;
        const horizontalFlipped = this.flipBoundingBoxHorizontally(originalBoundingBox, image.width);
        const verticalFlipped = this.flipBoundingBoxVertically(originalBoundingBox, image.height);
        const bothFlipped = this.flipBoundingBoxHorizontally(this.flipBoundingBoxVertically(originalBoundingBox, image.height), image.width);
        return {
            original: originalBoundingBox,
            fliph: horizontalFlipped,
            flipv: verticalFlipped,
            fliphv: bothFlipped
        };
    }

    static calculateCenterPoint(boundingBox: Area): vec2arr {
        const middlex = (boundingBox.start.x + boundingBox.end.x) / 2;
        const middley = (boundingBox.start.y + boundingBox.end.y) / 2;
        return [~~middlex, ~~middley];
    }
}
