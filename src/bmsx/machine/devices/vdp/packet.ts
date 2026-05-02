import { vdpStreamFault } from './fault';

const VDP_UNIT_PACKET_WORD_COUNT_MASK = 0x00ff0000;
const VDP_UNIT_PACKET_FLAGS_MASK = 0x0000ffff;

export function decodeVdpUnitPacketHeader(packetName: string, word: number, expectedPayloadWords: number): void {
	const payloadWords = (word & VDP_UNIT_PACKET_WORD_COUNT_MASK) >>> 16;
	if (payloadWords !== expectedPayloadWords) {
		throw vdpStreamFault(`${packetName} word count ${payloadWords} is invalid.`);
	}
	if ((word & VDP_UNIT_PACKET_FLAGS_MASK) !== 0) {
		throw vdpStreamFault(`${packetName} reserved flags are set (${word}).`);
	}
}
