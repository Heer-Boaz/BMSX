#include "machine/devices/vdp/ingress.h"

#include <algorithm>

namespace bmsx {

void VdpStreamIngressUnit::reset() {
	fifoWordByteCount = 0;
	fifoStreamWordCount = 0u;
	dmaSubmitActive = false;
}

void VdpStreamIngressUnit::beginDmaSubmit() {
	dmaSubmitActive = true;
}

void VdpStreamIngressUnit::endDmaSubmit() {
	dmaSubmitActive = false;
}

bool VdpStreamIngressUnit::hasOpenDirectFifoIngress() const {
	return fifoWordByteCount != 0 || fifoStreamWordCount != 0u;
}

u32 VdpStreamIngressUnit::pushWord(u32 word) {
	if (fifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
		return fifoStreamWordCount + 1u;
	}
	fifoStreamWords[static_cast<size_t>(fifoStreamWordCount)] = word;
	fifoStreamWordCount += 1u;
	return 0u;
}

u32 VdpStreamIngressUnit::writeBytes(const u8* data, size_t length) {
	for (size_t index = 0; index < length; index += 1u) {
		fifoWordScratch[static_cast<size_t>(fifoWordByteCount)] = data[index];
		fifoWordByteCount += 1;
		if (fifoWordByteCount != 4) {
			continue;
		}
		const u32 word = static_cast<u32>(fifoWordScratch[0])
			| (static_cast<u32>(fifoWordScratch[1]) << 8u)
			| (static_cast<u32>(fifoWordScratch[2]) << 16u)
			| (static_cast<u32>(fifoWordScratch[3]) << 24u);
		fifoWordByteCount = 0;
		const u32 overflowDetail = pushWord(word);
		if (overflowDetail != 0u) {
			return overflowDetail;
		}
	}
	return 0u;
}

VdpStreamIngressState VdpStreamIngressUnit::captureState() const {
	VdpStreamIngressState state;
	state.dmaSubmitActive = dmaSubmitActive;
	state.fifoWordScratch = fifoWordScratch;
	state.fifoWordByteCount = fifoWordByteCount;
	state.fifoStreamWords.assign(fifoStreamWords.begin(), fifoStreamWords.begin() + fifoStreamWordCount);
	state.fifoStreamWordCount = fifoStreamWordCount;
	return state;
}

void VdpStreamIngressUnit::restoreState(const VdpStreamIngressState& state) {
	dmaSubmitActive = state.dmaSubmitActive;
	fifoWordScratch = state.fifoWordScratch;
	fifoWordByteCount = state.fifoWordByteCount;
	std::copy(state.fifoStreamWords.begin(), state.fifoStreamWords.end(), fifoStreamWords.begin());
	fifoStreamWordCount = state.fifoStreamWordCount;
}

} // namespace bmsx
