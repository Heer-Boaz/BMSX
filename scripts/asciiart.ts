/**
 * Renders a buffer bar where we only do detailed (fractional) rendering
 * at the very first and last cell of each region, and full blocks (█)
 * in between. Overlapping regions are handled by priority (first in array wins).
 */
export function renderBufferBar(
    unfilteredRegions: Array<{ start: number; end: number; colorTag: string }>,
    totalSize: number,
    barLength: number
): string {
    const blocks = ['?', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
    const cellSize = totalSize / barLength;
    const defaultCellChar = ' ';
    const cellChars = new Array(barLength).fill(defaultCellChar);
    const cellColors = new Array(barLength).fill('');

    // Filter out empty regions (start === end === 0)
    const regions = unfilteredRegions.filter(region => region.start !== 0 || region.end !== 0);

    const toBackground = (colorTag: string) => {
        // Convert color tag to background color by replacing -fg with -bg
        return colorTag.replace('-fg}', '-bg}');
    }

    for (const region of regions) {
        const startFloat = region.start / cellSize;
        const endFloat = region.end / cellSize;
        const regionStartCell = Math.floor(startFloat);
        const regionEndCell = Math.floor(endFloat);
        const leftFrac = startFloat - regionStartCell;
        const rightFrac = endFloat - regionEndCell;
        const startCell = Math.max(0, Math.min(barLength - 1, regionStartCell));
        const endCell = Math.max(0, Math.min(barLength - 1, regionEndCell));

        // fill full interior
        for (let i = startCell + 1; i < endCell; i++) {
            if (cellChars[i] === defaultCellChar) {
                cellChars[i] = '█';
                cellColors[i] = region.colorTag;
            }
        }
        // left boundary
        if (cellChars[startCell] === defaultCellChar) {
            if (startCell === endCell) {
                // Region fits entirely within one cell
                const regionStart = region.start;
                const regionEnd = region.end;
                const cellStart = startCell * cellSize;
                const cellEnd = (startCell + 1) * cellSize;
                const overlapStart = Math.max(cellStart, regionStart);
                const overlapEnd = Math.min(cellEnd, regionEnd);
                const overlap = Math.max(0, overlapEnd - overlapStart);
                const coverage = overlap / cellSize;
                const idx = Math.round(coverage * 8);
                if (idx <= 1) {
                    // Fill the one character by computing the whether the region is more left, middle, or right
                    const leftFrac = (regionStart - cellStart) / cellSize;
                    const rightFrac = (cellEnd - regionEnd) / cellSize;

                    // Find the highest-priority overlapping region's colorTag for fg
                    let fgColor = '{black-fg}';
                    for (const r of regions) {
                        // Only check other regions, not the current one
                        if (r === region) continue;
                        // Check if this region overlaps with the current cell
                        if (r.start < cellEnd && r.end > cellStart) {
                            fgColor = r.colorTag;
                            break;
                        }
                    }
                    // If there is any overlapping region, we ignore this region
                    if (fgColor !== '{black-fg}') continue;

                    // Determine whether to use left, right, or middle character
                    if (leftFrac < rightFrac - 0.20) {
                        cellChars[startCell] = '▏'; // left
                    } else if (leftFrac > rightFrac + 0.20) {
                        cellChars[startCell] = '▕'; // right
                    } else {
                        cellChars[startCell] = '│'; // true middle (vertical bar)
                    }

                    cellColors[startCell] = region.colorTag;
                }
                else if (idx >= 8) {
                    cellChars[startCell] = blocks[idx];
                    cellColors[startCell] = region.colorTag;
                }
                else {
                    cellChars[startCell] = blocks[idx];
                    let overlappingRegion = null;
                    // Find the highest-priority overlapping region's colorTag for fg
                    let fgColor = '{black-fg}';
                    for (const r of regions) {
                        // Only check other regions, not the current one
                        if (r === region) continue;
                        // Check if this region overlaps with the current cell
                        if (r.start < cellEnd && r.end > cellStart) {
                            fgColor = r.colorTag;
                            overlappingRegion = r;
                            break;
                        }
                    }
                    // Invert colors **only** if the overlapping region starts before the current region ends (not the cell!)
                    if (overlappingRegion && overlappingRegion.start < region.end) {
                        cellColors[startCell] = toBackground(region.colorTag) + fgColor;
                    }
                    else {
                        // No overlapping region, use the region's colorTag
                        cellColors[startCell] = region.colorTag;
                    }
                }
            }/* ── left boundary (multi-cell branch) ─────────────────────────────── */
            else {                                    // we are inside:  if (startCell !== endCell)
                const coverage = 1 - leftFrac;
                const idx = Math.round(coverage * 8);

                /* ← NEW: handle ultra-thin sliver */
                let needsInvert = false;
                if (idx <= 1) {
                    cellChars[startCell] = '▕';       // thin right-hand bar
                } else if (idx <= 3) {
                    cellChars[startCell] = '▐';       // slightly less thin right-hand bar
                } else {
                    cellChars[startCell] = blocks[idx];
                    needsInvert = true;
                }

                /* same-cell overlap, but restrict search to HIGHER-priority regions */
                const cellStart = startCell * cellSize;
                const cellEnd = cellStart + cellSize;
                const higher = regions
                    .slice(0, regions.indexOf(region))          // only earlier (higher-priority) regions
                    .find(r => r.start < cellEnd && r.end > cellStart);

                if (needsInvert) {
                    const fg = higher ? higher.colorTag : '{black-fg}';
                    cellColors[startCell] = toBackground(region.colorTag) + fg;   // bg = region, fg = higher/black
                } else {
                    cellColors[startCell] = region.colorTag;
                }
            }
        }
        /* ── right boundary ────────────────────────────────────────────────── */
        if (endCell !== startCell && cellChars[endCell] === defaultCellChar) {
            const idx = Math.round(rightFrac * 8);

            /* The region occupies the **left** side of this cell, so the glyph
               already points the correct way.  No inversion is needed. */
            if (idx === 0) {
                cellChars[endCell] = '▏'; // 1/8 left block
            } else {
                cellChars[endCell] = blocks[idx];
            }

            /* Plain colouring: foreground = region colour, background untouched. */
            cellColors[endCell] = region.colorTag;
        }
    }

    let bar = '';

    for (let i = 0; i < barLength; i++) {
        bar += cellColors[i] + cellChars[i] + '{/}';
    }
    return bar;
}

/**
 * Renders a simple summary bar with only full blocks.
 * No partial blocks are used; each region cell is either fully filled or empty.
 * Overlapping regions are handled by priority (first region in the array is shown).
 */
export function renderSummaryBar(
    regions: Array<{ start: number, end: number, colorTag: string }>,
    totalSize: number,
    barLength: number
): string {
    let bar = '';

    // Initialize all cells as blank.
    const cellColors = new Array(barLength).fill('');
    const cellChars = new Array(barLength).fill(' ');

    // Process regions in priority order:
    for (const region of regions) {
        const regionStartCell = Math.floor((region.start / totalSize) * barLength);
        const regionEndCell = Math.ceil((region.end / totalSize) * barLength) - 1;

        // Clamp to valid cell indices.
        const startCell = Math.max(0, regionStartCell);
        const endCell = Math.min(barLength - 1, regionEndCell);

        // Fill each cell within the region with a full block, unless it's already set by a higher-priority region.
        for (let i = startCell; i <= endCell; i++) {
            // If not already covered, fill with this region.
            if (cellChars[i] === ' ') {
                cellChars[i] = '█';
                cellColors[i] = region.colorTag;
            }
        }
    }

    for (let i = 0; i < barLength; i++) {
        bar += cellColors[i] + cellChars[i] + '{/}';
    }

    return bar;
}

// Extracted function for pixel-perfect ASCII art rendering
export function generatePixelPerfectAsciiArt(
    imgBuf: Buffer | Uint8Array,
    imgW: number,
    imgH: number,
): string {
    let asciiArt = '';
    for (let y = 0; y < imgH; y++) {
        let line = '';
        for (let x = 0; x < imgW; x++) {
            const idx4 = (y * imgW + x) << 2;
            const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2], a = imgBuf[idx4 + 3];
            if (a < 64) {
                // transparent pixel, render as space
                line += ' ';
            }
            else {
                line += `{#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}-bg} {/}`;
            }
        }
        asciiArt += line + '\n';
    }
    return asciiArt;
}

export function generateBrailleAsciiArt(
    imgBuf: Buffer | Uint8Array,
    imgW: number,
    imgH: number,
    maxArtWidth: number,
    opts: {
        useEdgeDetection?: boolean;   // default true
        useDithering?: boolean;       // default false
        strictBgDist?: number;        // sq-dist voor BG (default 32²)
        deltaLum?: number;            // |Ydiff| drempel (default 30)
    } = {}
): string {

    const useEdge = opts.useEdgeDetection ?? true;
    const useDith = opts.useDithering ?? true;
    const BG_DIST = opts.strictBgDist ?? 32 * 32;
    const DELTA = opts.deltaLum ?? 30; // luminantie 0-255

    const BRAILLE_BASE = 0x2800;
    const brailleMap = [[0, 1, 2, 5], [3, 4, 6, 7]];
    const outW = Math.min(maxArtWidth - 8, Math.floor(imgW / 2));
    const outH = Math.min(Math.ceil(imgH / 4), Math.floor(outW * (imgH / imgW) / 2)) + 1;

    /* ---------- gamma-correcte luminantie-buffer ---------- */
    const linY = new Float32Array(imgW * imgH);
    {
        let p = 0;
        for (let y = 0; y < imgH; ++y) {
            for (let x = 0; x < imgW; ++x, ++p) {
                const i4 = (p * 4);
                const r = imgBuf[i4], g = imgBuf[i4 + 1], b = imgBuf[i4 + 2];
                linY[p] = 255 * (0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b));
            }
        }
    }

    /* ---------- global dominant kleur ---------- */
    const hist = new Map<number, number>();
    for (let p = 0; p < imgW * imgH; ++p) {
        const i4 = (((p / imgW | 0)) * imgW) + (p % imgW) << 2;
        if (!imgBuf[i4 + 3]) continue;                       // transparant
        const key = rgbToKey(imgBuf[i4], imgBuf[i4 + 1], imgBuf[i4 + 2]);
        hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    let bgKey = 0, bgCnt = 0;
    // @ts-ignore
    for (const [k, c] of hist) if (c > bgCnt) { bgCnt = c; bgKey = k; }
    const bgR = bgKey >>> 16 & 255, bgG = bgKey >>> 8 & 255, bgB = bgKey & 255;
    const bgLum = 255 * (0.2126 * srgb2lin(bgR) + 0.7152 * srgb2lin(bgG) + 0.0722 * srgb2lin(bgB));

    /* ---------- dither buffer ---------- */
    const err = useDith ? new Float32Array(imgW * imgH) : null;

    /* ---------- render loop ---------- */
    let asciiArt = '';

    for (let cy = 0; cy < outH; ++cy) {
        let line = '';
        for (let cx = 0; cx < outW; ++cx) {

            const fgVotes = new Map<number, number>();     // stemt alleen als dot gezet
            let cellBgR = 0, cellBgG = 0, cellBgB = 0, cellBgCnt = 0;
            let bitmask = 0;

            for (let dy = 0; dy < 4; ++dy) {
                for (let dx = 0; dx < 2; ++dx) {
                    const px = Math.min(imgW - 1, cx * 2 + dx);
                    const py = Math.min(imgH - 1, cy * 4 + dy);
                    const p = py * imgW + px;
                    const idx4 = (p * 4);
                    const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2];

                    let yLin = linY[p];
                    const nearBg = colorDistSq(r, g, b, bgR, bgG, bgB) < BG_DIST;
                    const ditherThisPixel = useDith && !nearBg;   // BG nooit diffusen
                    if (ditherThisPixel && err) yLin = clamp(yLin + err[p], 0, 255);

                    /* edge-aware Δ-drempel (trekt Δ iets naar beneden op randen) */
                    let deltaThr = DELTA;
                    if (useEdge) deltaThr = Math.max(10, DELTA - 0.2 * sobelAt(linY, imgW, imgH, px, py));

                    const lumDiff = Math.abs(yLin - bgLum);
                    const dotSet = !nearBg && lumDiff >= deltaThr;

                    if (dotSet) {
                        bitmask |= 1 << brailleMap[dx][dy];
                        const key = rgbToKey(r, g, b);
                        fgVotes.set(key, (fgVotes.get(key) ?? 0) + 1);
                    }

                    if (nearBg) { cellBgR += r; cellBgG += g; cellBgB += b; ++cellBgCnt; }

                    if (ditherThisPixel && err) {
                        const target = dotSet ? 0 : 255;
                        distributeError(err, yLin - target, p, imgW, imgH);
                    }
                }
            }

            /* dominante FG-kleur o.b.v. gezette dots */
            let domKey = 0x808080, domCnt = 0;
            // @ts-ignore
            for (const [k, c] of fgVotes) if (c > domCnt) { domCnt = c; domKey = k; }

            const fgTag = `{${keyToHex(domKey)}-fg}`;
            const bgTag = cellBgCnt
                ? `{#${hex(cellBgR / cellBgCnt)}${hex(cellBgG / cellBgCnt)}${hex(cellBgB / cellBgCnt)}-bg}`
                : '';

            line += bgTag + fgTag + String.fromCharCode(BRAILLE_BASE + bitmask) + '{/}';
        }
        asciiArt += line + '\n';
    }
    return asciiArt;
}

function srgb2lin(v: number) { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function hex(v: number) { return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'); }
function clamp(x: number, l: number, h: number) { return x < l ? l : x > h ? h : x; }
function rgbToKey(r: number, g: number, b: number) { return (r << 16) | (g << 8) | b; }
function keyToHex(k: number) { return `#${(k >>> 16 & 0xff).toString(16).padStart(2, '0')}${(k >>> 8 & 0xff).toString(16).padStart(2, '0')}${(k & 0xff).toString(16).padStart(2, '0')}`; }
function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

function sobelAt(buf: Float32Array, w: number, h: number, x: number, y: number): number {
    const xm1 = Math.max(0, x - 1), xp1 = Math.min(w - 1, x + 1);
    const ym1 = Math.max(0, y - 1), yp1 = Math.min(h - 1, y + 1);
    const i = y * w + x;
    const gx = buf[ym1 * w + xp1] + 2 * buf[i + 1] + buf[yp1 * w + xp1]
        - buf[ym1 * w + xm1] - 2 * buf[i - 1] - buf[yp1 * w + xm1];
    const gy = buf[yp1 * w + xm1] + 2 * buf[yp1 * w + x] + buf[yp1 * w + xp1]
        - buf[ym1 * w + xm1] - 2 * buf[ym1 * w + x] - buf[ym1 * w + xp1];
    return Math.sqrt(gx * gx + gy * gy);
}

function distributeError(buf: Float32Array, e: number, idx: number, w: number, h: number) {
    const x = idx % w, y = Math.floor(idx / w);
    if (x + 1 < w) buf[idx + 1] += e * 7 / 16;
    if (x > 0 && y + 1 < h) buf[idx + w - 1] += e * 3 / 16;
    if (y + 1 < h) buf[idx + w] += e * 5 / 16;
    if (x + 1 < w && y + 1 < h) buf[idx + w + 1] += e * 1 / 16;
}

interface WavInfo {
    bits: 8 | 16 | 24 | 32;
    channels: 1 | 2 | 3 | 4;
    sampleRate: number;
    dataOff: number;
    dataLen: number;
}

/* Parseert de RIFF-WAVE header en retourneert metadata + offset */
export function parseWav(buf: ArrayBuffer): WavInfo {
    const dv = new DataView(buf);

    if (dv.getUint32(0, false) !== 0x52494646) throw new Error('No RIFF');
    if (dv.getUint32(8, false) !== 0x57415645) throw new Error('No WAVE');

    let ptr = 12, fmt: WavInfo | null = null, dataOff = 0, dataLen = 0;

    while (ptr + 8 <= buf.byteLength) {
        const id = dv.getUint32(ptr, false);
        const size = dv.getUint32(ptr + 4, true);
        if (id === 0x666d7420) {                    // "fmt "
            const audioFmt = dv.getUint16(ptr + 8, true);
            if (audioFmt !== 1) throw new Error('Only PCM supported');
            fmt = {
                channels: dv.getUint16(ptr + 10, true) as 1 | 2 | 3 | 4,
                sampleRate: dv.getUint32(ptr + 12, true),
                bits: dv.getUint16(ptr + 22, true) as 8 | 16 | 24 | 32,
                dataOff: 0,
                dataLen: 0,
            };
        } else if (id === 0x64617461) {             // "data"
            dataOff = ptr + 8;
            dataLen = size;
        }
        ptr += 8 + size + (size & 1);               // pad-byte
    }
    if (!fmt || !dataLen) throw new Error('Invalid WAV: missing fmt or data');
    return { ...fmt, dataOff, dataLen };
}

export function asciiWaveBraille(
    pcm: Uint8Array,
    bits: 8 | 16 | 24 | 32,
    cols: number,
    baseRows = 80,
    channels = 1,
    autoZoomFloor = .25           // 0-1   (0.25 ≅ –12 dBFS)
): string {

    const BRAILLE = 0x2800;
    const DOT = [[0, 1, 2, 6], [3, 4, 5, 7]];         // (dx,dy)→bit

    /* ---------- sample → float helper ---------- */
    const BPS = bits >> 3;
    const toF = (i: number): number => {
        if (bits === 8) return (pcm[i] - 128) / 128;
        if (bits === 16) return ((pcm[i] | pcm[i + 1] << 8) << 16 >> 16) / 32768;
        if (bits === 24) return ((pcm[i] | pcm[i + 1] << 8 | pcm[i + 2] << 16) << 8 >> 8) / 8388608;
        return (pcm[i] | pcm[i + 1] << 8 | pcm[i + 2] << 16 | pcm[i + 3] << 24) / 2147483648;
    };

    /* ---------- 1. peaks met zwevende cursor + oversampling ---------- */
    const S = pcm.length / BPS / channels;      // total #samples
    const step = S / cols;                      // fractie-stap
    const over = Math.ceil(step);               // oversample-margin
    const peaks: [number, number][] = [];

    let pos = 0;
    for (let c = 0; c < cols; ++c) {
        const s0 = pos | 0;
        pos += step;
        const s1 = Math.min(S, (pos | 0) + over); // extra “hold” samples

        let mn = 1, mx = -1;
        for (let s = s0; s < s1; ++s) {
            let v = 0;
            for (let ch = 0; ch < channels; ++ch)
                v += toF((s * channels + ch) * BPS);
            v /= channels;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        peaks.push([mn, mx]);
    }

    /* ---------- 2. globale max + auto-zoom ---------- */
    let gMax = 0;
    for (const [mn, mx] of peaks)
        gMax = Math.max(gMax, Math.abs(mn), Math.abs(mx));

    // Auto-zoom factor: if the global max is below the auto-zoom floor,
    // we scale the output to ensure visibility of the lowest peaks.
    // The autoZoomFloor is a fraction of the maximum value, e.g., 0.25 means
    // that we want to ensure that the lowest peaks are at least 25% of the maximum.
    const zoom = gMax < autoZoomFloor ? autoZoomFloor / gMax : 1;

    // Compute rows based on zoom and baseRows
    // The computation ensures that the number of rows is at least 1
    // and scales the number of rows based on the zoom factor.
    const rows = Math.max(1, Math.floor(baseRows / zoom)); // min 1 rij
    const scale = ((rows * 4 - 1) / 2) * zoom / (gMax || 1);

    /* ---------- 3. braille-grid ---------- */
    const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let x = 0; x < cols; ++x) {
        const [mn, mx] = peaks[x];
        const yMin = Math.round(rows * 4 / 2 - mx * scale);
        const yMax = Math.round(rows * 4 / 2 - mn * scale);

        for (let y = Math.max(0, yMin); y <= Math.min(rows * 4 - 1, yMax); ++y) {
            const cellY = y >> 2;
            const subY = y & 3;
            grid[cellY][x] |= 1 << DOT[x & 1][subY];
        }
    }

    /* ---------- 4. naar string ---------- */
    const art = grid
        .map((row, rowIdx) => row
            .map((code, colIdx) => {
                if (!code) return ' ';
                // Color logic: red for negative, green for positive, yellow for near zero
                const [mn, mx] = peaks[colIdx];
                let colorTag = '';
                if (mn < -0.2 || mx > 0.2) colorTag = '{red-fg}';
                else if (mn < -0.1 || mx > 0.1) colorTag = '{yellow-fg}';
                else if (mn < 0.1 && mx > -0.1) colorTag = '{blue-fg}';
                return colorTag + String.fromCharCode(BRAILLE + code) + '{/}';
            })
            .join(''))
        .join('\n');
    // Remove trailing empty lines
    return art.replace(/^\s*$/gm, '').trim();
}
