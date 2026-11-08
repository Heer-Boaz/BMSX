import { readFile } from 'node:fs/promises';
import { buildStreamingCartridge, STREAMING_CONFIGURATIONS } from '../../helpers/imgdec_streaming';

async function main() {
	const [directory, bios, name = 'direct16-128'] = process.argv.slice(2);
	const configuration = STREAMING_CONFIGURATIONS[name];
	if (!configuration) throw new Error(`Unknown streaming workload: ${name}`);
	const { manifest } = await buildStreamingCartridge(directory, new Uint8Array(await readFile(bios)), configuration);
	console.log(JSON.stringify(manifest));
}
void main();
