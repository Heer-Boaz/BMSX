// export const IMAGE_EXTERNAL_BRAND = Symbol('TextureExternalImage');

// export type ExternalImageFlavor = 'web-imagebitmap' | 'native-decoder';

// export interface ExternalImage {
// 	readonly [IMAGE_EXTERNAL_BRAND]: ExternalImageFlavor;
// 	readonly width: number;
// 	readonly height: number;
// 	close(): void;
// 	getNativeHandle(): unknown;
// }

// export interface CompressedTextureLevel {
// 	readonly width: number;
// 	readonly height: number;
// 	readonly data: Uint8Array;
// }

export type TextureSource = any;
	// | { kind: 'raw-rgba8'; width: number; height: number; data: Uint8Array }
	// | { kind: 'compressed'; format: string; levels: ReadonlyArray<CompressedTextureLevel> }
	// | { kind: 'external'; image: ExternalImage };

export type TextureColor = [number, number, number, number];

export interface TextureSourceLoader {
	fromUri(uri: string): Promise<TextureSource>;
	fromBytes(bytes: ArrayBuffer): Promise<TextureSource>;
	solid(size: number, color: TextureColor): TextureSource;
}

// export function isExternalImage(source: TextureSource): source is { kind: 'external'; image: ExternalImage } {
// 	return source.kind === 'external';
// }
