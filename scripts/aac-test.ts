import { promises as fs } from 'fs';
import { encodeWavToAacLc } from './formater/audioencoder'

(async () => {
	const path = '../src/carts/2025/res/m16@m@l=0.wav';
	const wav = await fs.readFile(path);
	const aac = await encodeWavToAacLc(wav, path, {
		bitrate: 16,
		autoTune: true,          // default true
		silenceGateDb: -55,      // sterk aanbevolen bij lage bitrates
		// gainBiasSteps: 2,      // optioneel: override
	});

	await fs.writeFile("../output.aac", aac);
})();
