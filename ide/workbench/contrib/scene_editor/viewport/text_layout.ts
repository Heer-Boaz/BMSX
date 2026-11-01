import { luaFloorDivide } from '../../../../../machine/ts/spec/blua32/numeric';
import type { WorkspaceImageAsset, WorkspaceImageAssets } from '../../../../workspace/image_assets';
import type { SceneTextInputs } from '../text_source';

export type SceneTextLayout = {
	readonly glyphs: readonly { readonly image: WorkspaceImageAsset; readonly x: number; readonly y: number }[];
};

/** Admit only the glyphs and line-height dependency selected by this source. */
export function collectSceneTextImages(source: SceneTextInputs, used: Set<string>): void {
	const font = source.font, fallback = font.glyphs.get(0x3f), space = font.glyphs.get(0x20);
	if (source.lineHeight === undefined && font.lineHeight === undefined) {
		const line = font.glyphs.get(0x41) ?? font.glyphs.get(0x61) ?? fallback;
		if (line !== undefined) used.add(line);
	}
	for (const row of source.rows) for (const codepoint of row.text) {
		const image = font.glyphs.get(codepoint) ?? (codepoint === 0x09 ? space : undefined) ?? fallback;
		if (image !== undefined) used.add(image);
	}
}

/** Source/asset-generation work only. Camera and placement changes reuse these local glyphs. */
export function layoutSceneText(source: SceneTextInputs, assets: Pick<WorkspaceImageAssets, 'get'>): SceneTextLayout | undefined {
	const font = source.font, fallback = font.glyphs.get(0x3f), space = font.glyphs.get(0x20);
	const autoTab = !font.glyphs.has(0x09) && space !== undefined;
	let lineHeight = source.lineHeight ?? font.lineHeight;
	if (lineHeight === undefined) {
		const line = font.glyphs.get(0x41) ?? font.glyphs.get(0x61) ?? fallback;
		if (line === undefined) return;
		const image = assets.get(line);
		if (image === undefined) return;
		lineHeight = image.height;
	}
	const glyphs: { image: WorkspaceImageAsset; x: number; y: number }[] = [];
	for (let index = 0; index < source.rows.length; index++) {
		const row = source.rows[index], first = glyphs.length, y = row.y ?? index * lineHeight;
		let width = 0;
		for (const codepoint of row.text) {
			const id = font.glyphs.get(codepoint) ?? (codepoint === 0x09 ? space : undefined) ?? fallback;
			if (id === undefined) return;
			const image = assets.get(id);
			if (image === undefined) return;
			glyphs.push({ image, x: width, y });
			width += (image.width + font.advancePadding) * (codepoint === 0x09 && autoTab ? 4 : 1);
		}
		const x = row.x ?? (source.centerBlockWidth === undefined ? 0 : luaFloorDivide(source.centerBlockWidth - (row.width ?? width), 2));
		if (x !== 0) for (let glyph = first; glyph < glyphs.length; glyph++) glyphs[glyph].x += x;
	}
	return { glyphs };
}
