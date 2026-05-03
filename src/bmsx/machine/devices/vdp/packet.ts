const VDP_UNIT_PACKET_WORD_COUNT_MASK = 0x00ff0000;
const VDP_UNIT_PACKET_FLAGS_MASK = 0x0000ffff;

export function isVdpUnitPacketHeaderValid(word: number, expectedPayloadWords: number): boolean {
	const payloadWords = (word & VDP_UNIT_PACKET_WORD_COUNT_MASK) >>> 16;
	return payloadWords === expectedPayloadWords && (word & VDP_UNIT_PACKET_FLAGS_MASK) === 0;
}
