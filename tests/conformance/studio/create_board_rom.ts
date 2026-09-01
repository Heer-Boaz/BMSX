import { writeFile } from 'node:fs/promises';

import { buildCartridgeDeviceImage } from '../../../toolchain/ts/rompack/device_image';
import {
	STUDIO_BOARD_ID,
	STUDIO_BOARD_RAM_BYTES,
} from '../../../ide/workbench/contrib/studio/protocol';

async function main(): Promise<void> {
	const outputPath = process.argv[2];
	if (!outputPath) {
		throw new Error('Usage: create_board_rom.ts OUTPUT_ROM');
	}
	await writeFile(outputPath, buildCartridgeDeviceImage({
		title: 'BMSX Studio expansion board',
		cartridge: {
			board: 'ram_mailbox',
			board_id: STUDIO_BOARD_ID,
			ram_bytes: STUDIO_BOARD_RAM_BYTES,
		},
	}));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
