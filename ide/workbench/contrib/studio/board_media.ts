import { buildCartridgeDeviceImage } from '../../../../toolchain/ts/rompack/device_image';
import {
	STUDIO_BOARD_ID,
	STUDIO_BOARD_RAM_BYTES,
} from './protocol';

export const studioBoardMedia = buildCartridgeDeviceImage({
	title: 'BMSX Studio expansion board',
	cartridge: {
		board: 'ram_mailbox',
		board_id: STUDIO_BOARD_ID,
		ram_bytes: STUDIO_BOARD_RAM_BYTES,
	},
});
