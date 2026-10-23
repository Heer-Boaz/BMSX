import { createCanvas, loadImage } from 'canvas';
import type { ImageResource, Resource } from '../rompacker/rompacker.rompack';

/** Bake host punctuation and text styles once; the glyph draw datapath stays unchanged. */
export async function addHostFontResources(resources: Resource[]): Promise<void> {
	for (const dotName of ['msx_6b_font_dot', 'tiny_3b_font_code_0x2e']) {
		const dot = resources.find((resource): resource is ImageResource => resource.type === 'image' && resource.name === dotName)!;
		const canvas = createCanvas(6, dot.img!.height), context = canvas.getContext('2d');
		context.fillStyle = '#ffffff';
		for (let x = 0; x < 6; x += 2) context.fillRect(x, canvas.height - 2, 1, 1);
		resources.push({ ...dot, name: dotName.startsWith('msx_') ? 'msx_6b_font_ellipsis' : 'tiny_3b_font_ellipsis',
			img: await loadImage(canvas.toBuffer('image/png')) });
	}
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
