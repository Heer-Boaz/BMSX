import type { RgbaImage } from '../../../../machine/ts/render/image';
import type { ClipboardImage } from '../../../../hosts/common/clipboard';

export type DraftImage = { state: 'loading' | 'ready' | 'error'; url?: string; preview?: RgbaImage; error?: string };

/** The draft owns pending clipboard reads. Removed images can never reappear after a read. */
export class AssistantAttachments {
	public readonly images: DraftImage[] = [];
	public revision = 0;
	public get ready(): boolean { return this.images.every(image => image.state === 'ready'); }
	public get urls(): readonly string[] { return this.images.map(image => image.url!); }
	public add(sources: readonly ClipboardImage[]): void {
		for (const source of sources) {
			const image: DraftImage = { state: 'loading' };
			this.images.push(image); this.revision++;
			void source.read().then(({ url, preview }) => {
				if (!this.images.includes(image)) return;
				image.url = url; image.preview = preview; image.state = 'ready'; this.revision++;
			}, error => {
				if (!this.images.includes(image)) return;
				image.error = String(error); image.state = 'error'; this.revision++;
			});
		}
	}
	public remove(index: number): void { this.images.splice(index, 1); this.revision++; }
	public clear(): void { this.images.length = 0; this.revision++; }
	public set(urls: readonly string[]): void {
		this.clear();
		for (const url of urls) this.images.push({ state: 'ready', url });
	}
}
