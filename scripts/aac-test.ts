import { promises as fs } from 'fs';
import { encodeWavToAacLc } from './rompacker/audioencoder'

(async () => {
	const path = '../src/carts/2025/res/m02@m@l=0.wav';
	const wav = await fs.readFile(path);
	const aac = await encodeWavToAacLc(wav, path, { bitrate: 128 });
	await fs.writeFile("../output.aac", aac);
})();
