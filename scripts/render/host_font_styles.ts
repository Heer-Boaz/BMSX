import { createCanvas, loadImage } from 'canvas';
import type { Resource } from '../rompacker/rompacker.rompack';

/** Bake host text styles once. Guest atlases and the glyph draw datapath stay unchanged. */
export async function addHostFontStyles(resources: Resource[]): Promise<void> {
	const count = resources.length;
	for (let index = 0; index < count; index++) {
		const resource = resources[index];
		if (resource.type !== 'image' || !(resource.name.startsWith('msx_6b_font_') || resource.name.startsWith('tiny_3b_font_'))) continue;
		const image = resource.img!;
		const source = createCanvas(image.width, image.height);
		source.getContext('2d').drawImage(image, 0, 0);
		const canvas = createCanvas(image.width + ((image.height - 1) >> 2), image.height);
		const context = canvas.getContext('2d');
		for (let y = 0; y < image.height; y++) {
			const x = (image.height - 1 - y) >> 2;
			context.drawImage(source, 0, y, image.width, 1, x, y, image.width, 1);
		}
		resources.push({ ...resource, name: `${resource.name}_italic`, img: await loadImage(canvas.toBuffer('image/png')) });
	}
}
