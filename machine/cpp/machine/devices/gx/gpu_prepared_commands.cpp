#include "machine/devices/gx/gpu_prepared_commands.h"

#include "machine/devices/gx/gp0_stream.h"
#include "machine/devices/word_fifo.h"

namespace bmsx {

void GxGpuPreparedCommands::prepare(const WordFifo<GX_GPU_COMMAND_FIFO_WORD_CAPACITY>& fifo,
	const WordFifo<GX_GPU_DMA_INGRESS_WORD_CAPACITY>& ingress, i64 startCycle, GxGpuDrawState& state) {
	const size_t fifoWords = fifo.count();
	const size_t sourceWords = fifoWords + ingress.count();
	while (count < GX_GPU_PREPARED_COMMAND_CAPACITY && sourceWordCount < sourceWords) {
		const size_t source = sourceWordCount;
		const u32 header = source < fifoWords ? fifo.peek(source) : ingress.peek(source - fifoWords);
		const size_t packetIndex = index(count);
		auto& packet = packets[packetIndex];
		u32 consumedWords;
		if (polylineOpcode != 0u) {
			if (polylinePayloadPhase == 0u && (header & 0xf000f000u) == 0x50005000u) {
				++sourceWordCount;
				polylineOpcode = 0u;
				continue;
			}
			const bool gouraud = (polylineOpcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u;
			consumedWords = gouraud ? 2u - polylinePayloadPhase : 1u;
			if (consumedWords > sourceWords - source) break;
			packet.words[0] = polylineColorWord;
			packet.words[1] = polylinePositionWord;
			if (gouraud) {
				packet.words[2] = polylinePayloadPhase == 0u ? header : polylineNextColorWord;
				const size_t positionSource = source + consumedWords - 1u;
				packet.words[3] = positionSource < fifoWords ? fifo.peek(positionSource) : ingress.peek(positionSource - fifoWords);
			} else {
				packet.words[2] = header;
			}
			prepareGpuPacket(packet, gouraud ? 4u : 3u, state, GX_GPU_COMMAND_DRAW_LINE, static_cast<u8>(polylineOpcode));
			if (gouraud) polylineColorWord = packet.words[2];
			polylinePositionWord = packet.words[gouraud ? 3u : 2u];
			polylineNextColorWord = 0u;
			polylinePayloadPhase = 0u;
		} else {
			const u32 opcode = header >> GX_GPU_GP0_OPCODE_SHIFT;
			if (gxGpuGp0OpcodeIsNop(opcode)) {
				++sourceWordCount;
				continue;
			}
			// Upload payloads retain their counted streaming datapath.
			if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) break;
			consumedWords = gp0CommandWordCountForOpcode(opcode);
			if (consumedWords > sourceWords - source) break;
			packet.words[0] = header;
			for (u32 word = 1u; word < consumedWords; ++word) {
				const size_t sourceIndex = source + word;
				packet.words[word] = sourceIndex < fifoWords ? fifo.peek(sourceIndex) : ingress.peek(sourceIndex - fifoWords);
			}
			prepareGpuPacket(packet, consumedWords, state);
			if (packet.kind == GX_GPU_COMMAND_DRAW_POLYLINE) {
				polylineOpcode = opcode;
				const bool gouraud = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u;
				polylineColorWord = packet.words[gouraud ? 2u : 0u];
				polylinePositionWord = packet.words[gouraud ? 3u : 2u];
				polylineNextColorWord = 0u;
				polylinePayloadPhase = 0u;
			}
		}
		sourceWordCounts[packetIndex] = consumedWords;
		startCycles[packetIndex] = startCycle;
		startCycle += (packet.ticks + 1) >> 1u;
		completionCycles[packetIndex] = startCycle;
		sourceWordCount += consumedWords;
		++count;
		if (packet.kind == GX_GPU_COMMAND_READ_VRAM_TO_CPU) break;
	}
}

} // namespace bmsx
