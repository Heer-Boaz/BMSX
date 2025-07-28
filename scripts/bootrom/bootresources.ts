import type { Area, AudioMeta, ImgMeta, Polygon, RomAsset, RomImgAsset, RomMeta, RomPack } from '../../src/bmsx/rompack/rompack';
import { decodeBinary } from '../../src/bmsx/serializer/binencoder';

export async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(`Failed to load image's URL: ${url}`);
        img.src = url;
    });
}

export function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
    const bytearray = new Uint8Array(to_parse);
    const footerOffset = bytearray.length - 16;
    if (footerOffset < 0) throw new Error('ROM file too small for footer');
    let metaOffset = -1;
    let metaLength = -1;
    if (footerOffset < 16) {
        throw new Error('ROM file too small for metadata footer');
    }
    try {
        const dv = new DataView(to_parse, footerOffset, 16);
        metaOffset = Number(dv.getBigUint64(0, true));
        metaLength = Number(dv.getBigUint64(8, true));
        if (metaOffset < 0 || metaLength <= 0 || metaOffset + metaLength > bytearray.length)
            throw new Error('Invalid ROM metadata footer');
        return { start: metaOffset, end: metaOffset + metaLength };
    } catch (error: any) {
        throw new Error(`Failed to parse ROM metadata: ${error.message}\n${to_parse.byteLength} bytes, footerOffset: ${footerOffset}, metaOffset: ${metaOffset === -1 ? '<unknown>' : metaOffset}, metaLength: ${metaLength === -1 ? '<unknown>' : metaLength}.`);
    }
}

function getSubBufferAsPerMeta(buffer: ArrayBuffer, meta: RomMeta): ArrayBuffer {
    return buffer.slice(meta.start, meta.end);
}

export function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
    const buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
    return getSubBufferAsPerMeta(buffer, buffer_meta);
}

export async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
    const u8 = new Uint8Array(blob_buffer);
    if (
        u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47 &&
        u8[4] === 0x0D && u8[5] === 0x0A && u8[6] === 0x1A && u8[7] === 0x0A
    ) {
        const IEND = [0x49, 0x45, 0x4E, 0x44];
        let idx = 8;
        while (idx < u8.length - 12) {
            if (
                u8[idx + 4] === IEND[0] &&
                u8[idx + 5] === IEND[1] &&
                u8[idx + 6] === IEND[2] &&
                u8[idx + 7] === IEND[3]
            ) {
                const chunkLen = (u8[idx] << 24) | (u8[idx + 1] << 16) | (u8[idx + 2] << 8) | u8[idx + 3];
                idx += 8 + chunkLen + 4;
                return {
                    zipped_rom: blob_buffer.slice(idx),
                    romlabel: getImageURL(blob_buffer.slice(0, idx))
                };
            }
            idx++;
        }
        throw new Error('Could not find end of PNG header!');
    }
    return { zipped_rom: blob_buffer, romlabel: undefined };
}

export async function loadAssetList(rom: ArrayBuffer): Promise<RomAsset[]> {
    const sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));
    let assetList: RomAsset[];
    try {
        assetList = decodeBinary(sliced) as RomAsset[];
    } catch (e: any) {
        console.error('[loadAssetList] decodeBinary error:', e);
        throw e;
    }

    function flipPolygons(polys: Polygon[], flipH: boolean, flipV: boolean, imgW: number, imgH: number): Polygon[] {
        return polys.map(poly => {
            const res: number[] = [];
            for (let i = 0; i < poly.length; i += 2) {
                const x = poly[i];
                const y = poly[i + 1];
                res.push(flipH ? imgW - 1 - x : x, flipV ? imgH - 1 - y : y);
            }
            return res;
        });
    }

    function flipBoundingBoxHorizontally(box: Area, width: number): Area {
        return {
            start: { x: width - box.end.x, y: box.start.y },
            end: { x: width - box.start.x, y: box.end.y }
        };
    }

    function flipBoundingBoxVertically(box: Area, height: number): Area {
        return {
            start: { x: box.start.x, y: height - box.end.y },
            end: { x: box.end.x, y: height - box.start.y }
        };
    }

    function generateFlippedBoundingBox(extractedBoundingBox: Area, imgW: number, imgH: number) {
        const originalBoundingBox = extractedBoundingBox;
        const horizontalFlipped = flipBoundingBoxHorizontally(originalBoundingBox, imgW);
        const verticalFlipped = flipBoundingBoxVertically(originalBoundingBox, imgH);
        const bothFlipped = flipBoundingBoxHorizontally(flipBoundingBoxVertically(originalBoundingBox, imgH), imgW);
        return {
            original: originalBoundingBox,
            fliph: horizontalFlipped,
            flipv: verticalFlipped,
            fliphv: bothFlipped
        };
    }

    function generateFlippedTexCoords(texcoords: number[]): { original: number[]; fliph: number[]; flipv: number[]; fliphv: number[] } {
        const result = {
            original: [...texcoords],
            fliph: [],
            flipv: [],
            fliphv: []
        } as { original: number[]; fliph: number[]; flipv: number[]; fliphv: number[] };

        // Texcoords are stored in the same order as the quad vertices generated
        // by bvec.set: top-left, bottom-left, top-right, top-right, bottom-left,
        // bottom-right.
        const left = texcoords[0];
        const top = texcoords[1];
        const bottom = texcoords[3];
        const right = texcoords[4];

        // Horizontal flip swaps the left and right coordinates
        result.fliph.push(
            right, top,
            right, bottom,
            left, top,
            left, top,
            right, bottom,
            left, bottom
        );
        // Vertical flip swaps the top and bottom coordinates
        result.flipv.push(
            left, bottom,
            left, top,
            right, bottom,
            right, bottom,
            left, top,
            right, top
        );
        // Flip both horizontally and vertically
        result.fliphv.push(
            right, bottom,
            right, top,
            left, bottom,
            left, bottom,
            right, top,
            left, top
        );

        return result;
    }

    for (const asset of assetList) {
        if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
            const metaSlice = rom.slice(asset.metabuffer_start, asset.metabuffer_end);
            const decodedMeta = decodeBinary(new Uint8Array(metaSlice));
            switch (asset.type) {
                case 'image':
                case 'atlas':
                    asset.imgmeta = decodedMeta as ImgMeta;
                    if (asset.imgmeta.atlassed) {
                        if (asset.imgmeta.width && asset.imgmeta.height) {
                            if (asset.imgmeta.hitpolygons?.original) {
                                const extracted_hitpolygon = asset.imgmeta.hitpolygons.original;
                                asset.imgmeta.hitpolygons = {
                                    original: extracted_hitpolygon,
                                    fliph: flipPolygons(extracted_hitpolygon, true, false, asset.imgmeta.width, asset.imgmeta.height),
                                    flipv: flipPolygons(extracted_hitpolygon, false, true, asset.imgmeta.width, asset.imgmeta.height),
                                    fliphv: flipPolygons(extracted_hitpolygon, true, true, asset.imgmeta.width, asset.imgmeta.height)
                                };
                            }
                            if (asset.imgmeta.boundingbox) {
                                asset.imgmeta.boundingbox = generateFlippedBoundingBox(asset.imgmeta.boundingbox.original, asset.imgmeta.width, asset.imgmeta.height);
                            }
                            if (asset.imgmeta.texcoords) {
                                const { original, fliph, flipv, fliphv } = generateFlippedTexCoords(asset.imgmeta.texcoords);
                                asset.imgmeta.texcoords = original;
                                asset.imgmeta.texcoords_fliph = fliph;
                                asset.imgmeta.texcoords_flipv = flipv;
                                asset.imgmeta.texcoords_fliphv = fliphv;
                            }
                        }
                    }
                    break;
                case 'audio':
                    asset.audiometa = decodedMeta as AudioMeta;
                    break;
                case 'code':
                    break;
                case 'data':
                    break;
                case 'model':
                    break;
                default:
                    break;
            }
        }
    }
    return Promise.resolve<RomAsset[]>(assetList);
}

export async function loadResources(rom: ArrayBuffer, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadModelFromBuffer?: (buffer: ArrayBuffer) => Promise<any> }): Promise<RomPack> {
    const result: RomPack = {
        rom: rom,
        img: {},
        audio: {},
        model: {},
        data: {},
        code: null
    };

    const assetList = await loadAssetList(rom);
    await Promise.all(assetList.map(a => load(rom, a, result, opts)));
    return Promise.resolve<RomPack>(result);
}

function getImageURL(buffer: ArrayBuffer): string {
    return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

async function getImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
    return loadImage(getImageURL(buffer));
}

async function loadDataFromBuffer(buffer: ArrayBuffer): Promise<any> {
    return decodeBinary(new Uint8Array(buffer));
}

async function loadModelFromBuffer(buffer: ArrayBuffer): Promise<{ positions: Float32Array; texcoords: Float32Array; normals: Float32Array | null; }> {
    const obj = decodeBinary(new Uint8Array(buffer)) as { positions: number[]; texcoords: number[]; normals: number[] | null };
    return {
        positions: new Float32Array(obj.positions),
        texcoords: new Float32Array(obj.texcoords),
        normals: obj.normals ? new Float32Array(obj.normals) : null
    };
}

async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadModelFromBuffer?: (buffer: ArrayBuffer) => Promise<any> }): Promise<void> {
    switch (res.type) {
        case 'image':
        case 'atlas':
            let img: HTMLImageElement = undefined;
            if (!res.imgmeta?.atlassed) {
                if (opts && opts.loadImageFromBuffer) {
                    img = await opts.loadImageFromBuffer(rom.slice(res.start, res.end));
                } else {
                    img = await getImageFromBuffer(rom.slice(res.start, res.end));
                }
            }
            const imgAsset: RomImgAsset = {
                ...res,
                imgbin: img
            };
            romResult.img[res.resid] = imgAsset;
            romResult.img[res.resname] = imgAsset;
            break;
        case 'audio':
            try {
                if (opts && opts.loadAudioFromBuffer) {
                    romResult.audio[res.resid] = await opts.loadAudioFromBuffer(rom.slice(res.start, res.end));
                } else {
                    romResult.audio[res.resid] = res;
                    romResult.audio[res.resname] = res;
                }
            } catch (err: any) {
                throw new Error(`Failed to load 'audio' from rom: ${err.message}.`);
            }
            break;
        case 'code':
            try {
                if (opts && opts.loadSourceFromBuffer) {
                    romResult.code = await opts.loadSourceFromBuffer(rom.slice(res.start, res.end));
                } else {
                    const sliced = new Uint8Array(rom, res.start, res.end - res.start);
                    romResult.code = decodeuint8arr(sliced);
                }
            } catch (err: any) {
                throw new Error(`Failed to load 'source' from rom: ${err.message}.`);
            }
            break;
        case 'model':
            try {
                let model;
                if (opts && opts.loadModelFromBuffer) {
                    model = await opts.loadModelFromBuffer(rom.slice(res.start, res.end));
                } else {
                    model = await loadModelFromBuffer(rom.slice(res.start, res.end));
                }
                romResult.model[res.resid] = model;
                romResult.model[res.resname] = model;
            } catch (err: any) {
                throw new Error(`Failed to load 'model' from rom: ${err.message}.`);
            }
            break;
        case 'data':
            try {
                if (opts && opts.loadDataFromBuffer) {
                    romResult.data[res.resid] = await opts.loadDataFromBuffer(rom.slice(res.start, res.end));
                } else {
                    const data = await loadDataFromBuffer(rom.slice(res.start, res.end));
                    romResult.data[res.resid] = data;
                    romResult.data[res.resname] = data;
                }
            } catch (err: any) {
                throw new Error(`Failed to load 'data' from rom: ${err.message}.`);
            }
            break;
        default:
            throw new Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack!`);
    }
}

export function decodeuint8arr(to_decode: Uint8Array): string {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
        return decoder.decode(to_decode);
    } catch (err) {
        throw err;
    }
}
