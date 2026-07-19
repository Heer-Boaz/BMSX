#include "render/backend/software/gx_gpu_scanout.h"

#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/gx/vram_address.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <algorithm>
#include <vector>

namespace bmsx {
namespace {

struct InterlacedScanoutState {
	std::vector<u32> pixels;
	i32 width = 0;
	i32 height = 0;
	u64 vramSnapshotSerial = 0u;
	u32 pcrtcRevision = 0u;
	u32 sourceRowShift = 0u;
	bool valid = false;
};

InterlacedScanoutState g_interlacedScanout;

inline u32 rawWordAtAddress(u32 address) {
	return g_gxGpuSoftwareVram[static_cast<size_t>(address) & (GX_GPU_VRAM_WORD_COUNT - 1u)];
}

inline u32 rawByteAtAddress(u32 address) {
	const u32 word = rawWordAtAddress(address >> 1u);
	return (address & 1u) == 0u ? word & 0xffu : word >> 8u;
}

inline u32 rgb555Color(u32 word) {
	return static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8(word & 0x1fu))
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u);
}

bool circuitContainsOutput(
	const GxGpuPcrtcCircuit& circuit,
	u32 outputX,
	u32 outputY) {
	return outputX >= circuit.displayX
		&& outputY >= circuit.displayY
		&& outputX < circuit.displayRight
		&& outputY < circuit.displayBottom;
}

u32 circuitPixel(
	const GxGpuPcrtcCircuit& circuit,
	u32 outputX,
	u32 outputY,
	u32 sourceRowShift) {
	const u32 sourceX = circuit.framebufferX
		+ (outputX - circuit.displayX) / circuit.magnificationX;
	const u32 sourceY = circuit.framebufferY
		+ ((outputY - circuit.displayY) >> sourceRowShift) / circuit.magnificationY;
	if (circuit.framebufferPsm == GX_GPU_PCRTC_PSMCT32 || circuit.framebufferPsm == GX_GPU_PCRTC_PSMCT24) {
		const u32 address = circuit.framebufferBaseWord + (sourceY * circuit.framebufferWidth + sourceX) * 2u;
		const u32 low = rawWordAtAddress(address);
		const u32 high = rawWordAtAddress(address + 1u);
		const u32 alpha = circuit.framebufferPsm == GX_GPU_PCRTC_PSMCT32 ? high >> 8u : 0x80u;
		return low | ((high & 0xffu) << 16u) | (alpha << 24u);
	}
	if (circuit.framebufferPsm == GX_GPU_PCRTC_PSGPU24) {
		const u32 address = (circuit.framebufferBaseWord << 1u) + (sourceY * circuit.framebufferWidth + sourceX) * 3u;
		return rawByteAtAddress(address)
			| (rawByteAtAddress(address + 1u) << 8u)
			| (rawByteAtAddress(address + 2u) << 16u)
			| 0x80000000u;
	}
	const u32 word = rawWordAtAddress(circuit.framebufferBaseWord + sourceY * circuit.framebufferWidth + sourceX);
	return rgb555Color(word) | ((word & 0x8000u) != 0u ? 0x80000000u : 0u);
}

u32 mergedPixel(const GxGpuPcrtcScanout& scanout, u32 outputX, u32 outputY, u32 sourceRowShift) {
	u32 under = scanout.backgroundColor;
	if (scanout.circuit2UnderlayEnabled && circuitContainsOutput(scanout.circuits[1u], outputX, outputY)) {
		under = circuitPixel(scanout.circuits[1u], outputX, outputY, sourceRowShift);
	}
	if (!scanout.circuits[0u].enabled || !circuitContainsOutput(scanout.circuits[0u], outputX, outputY)) {
		return under;
	}
	const u32 circuit1 = circuitPixel(scanout.circuits[0u], outputX, outputY, sourceRowShift);
	u32 alpha = scanout.constantAlphaEnabled
		? scanout.constantAlpha
		: (circuit1 >> 24u) << 1u;
	if (alpha > 255u) {
		alpha = 255u;
	}
	const u32 inverseAlpha = 255u - alpha;
	const u32 red = ((circuit1 & 0xffu) * alpha + (under & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 green = (((circuit1 >> 8u) & 0xffu) * alpha + ((under >> 8u) & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 blue = (((circuit1 >> 16u) & 0xffu) * alpha + ((under >> 16u) & 0xffu) * inverseAlpha + 127u) / 255u;
	return red | (green << 8u) | (blue << 16u);
}

inline u32 outputArgb(u32 pixel) {
	return 0xff000000u | ((pixel & 0xffu) << 16u) | (pixel & 0x0000ff00u) | ((pixel >> 16u) & 0xffu);
}

inline u32 blendOutputArgb(u32 destination, u32 source, u32 alpha) {
	const u32 inverseAlpha = 255u - alpha;
	const u32 red = ((source & 0xffu) * alpha + ((destination >> 16u) & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 green = (((source >> 8u) & 0xffu) * alpha + ((destination >> 8u) & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 blue = (((source >> 16u) & 0xffu) * alpha + (destination & 0xffu) * inverseAlpha + 127u) / 255u;
	return 0xff000000u | (red << 16u) | (green << 8u) | blue;
}

bool circuitUsesRgb555(const GxGpuPcrtcCircuit& circuit) {
	return circuit.framebufferPsm != GX_GPU_PCRTC_PSMCT32
		&& circuit.framebufferPsm != GX_GPU_PCRTC_PSMCT24
		&& circuit.framebufferPsm != GX_GPU_PCRTC_PSGPU24;
}

bool canComposeRgb555(const GxGpuPcrtcScanout& scanout) {
	const GxGpuPcrtcCircuit& circuit1 = scanout.circuits[0u];
	const GxGpuPcrtcCircuit& circuit2 = scanout.circuits[1u];
	return (!circuit1.enabled || (circuitUsesRgb555(circuit1) && circuit1.magnificationX == 1u && circuit1.magnificationY == 1u))
		&& (!scanout.circuit2UnderlayEnabled || (circuitUsesRgb555(circuit2) && circuit2.magnificationX == 1u && circuit2.magnificationY == 1u));
}

bool circuitCoversOutput(const GxGpuPipelineState& state, const GxGpuPcrtcCircuit& circuit) {
	return circuit.displayX == 0u
		&& circuit.displayY == 0u
		&& circuit.displayRight >= static_cast<u32>(state.width)
		&& circuit.displayBottom >= static_cast<u32>(state.height);
}

void fillBackgroundRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep) {
	const u32 background = outputArgb(state.pcrtcScanout->backgroundColor);
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		u32* row = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		std::fill(row, row + state.width, background);
	}
}

void writeRgb555OpaqueRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((y - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			*output = outputArgb(rgb555Color(rawWordAtAddress(address)));
			address += 1u;
			output += 1;
		}
	}
}

void writeRgb555MaskedRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((y - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 word = rawWordAtAddress(address);
			const u32 sourceMask = 0u - (word >> 15u);
			const u32 source = outputArgb(rgb555Color(word));
			*output = (source & sourceMask) | (*output & ~sourceMask);
			address += 1u;
			output += 1;
		}
	}
}

void writeRgb555BlendedRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	u32 alpha,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((y - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			*output = blendOutputArgb(*output, rgb555Color(rawWordAtAddress(address)), alpha);
			address += 1u;
			output += 1;
		}
	}
}

void writeRgb555OutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	const GxGpuPcrtcCircuit& circuit1 = scanout.circuits[0u];
	if (circuit1.enabled
		&& scanout.constantAlphaEnabled
		&& scanout.constantAlpha == 255u
		&& circuitCoversOutput(state, circuit1)) {
		writeRgb555OpaqueRows(pixels, pixelsPerRow, state, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	const GxGpuPcrtcCircuit& circuit2 = scanout.circuits[1u];
	if (scanout.circuit2UnderlayEnabled && circuitCoversOutput(state, circuit2)) {
		writeRgb555OpaqueRows(pixels, pixelsPerRow, state, circuit2, firstRow, rowStep, sourceRowShift);
	} else {
		fillBackgroundRows(pixels, pixelsPerRow, state, firstRow, rowStep);
		if (scanout.circuit2UnderlayEnabled) {
			writeRgb555OpaqueRows(pixels, pixelsPerRow, state, circuit2, firstRow, rowStep, sourceRowShift);
		}
	}
	if (!circuit1.enabled) return;
	if (!scanout.constantAlphaEnabled) {
		writeRgb555MaskedRows(pixels, pixelsPerRow, state, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	if (scanout.constantAlpha == 0u) return;
	if (scanout.constantAlpha == 255u) {
		writeRgb555OpaqueRows(pixels, pixelsPerRow, state, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	writeRgb555BlendedRows(pixels, pixelsPerRow, state, circuit1, scanout.constantAlpha, firstRow, rowStep, sourceRowShift);
}

void writeGenericOutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		u32* row = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		for (i32 outputX = 0; outputX < state.width; outputX += 1) {
			row[outputX] = outputArgb(mergedPixel(scanout, static_cast<u32>(outputX), static_cast<u32>(outputY), sourceRowShift));
		}
	}
}

void writeOutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep,
	u32 sourceRowShift) {
	if (canComposeRgb555(*state.pcrtcScanout)) {
		writeRgb555OutputRows(pixels, pixelsPerRow, state, firstRow, rowStep, sourceRowShift);
		return;
	}
	writeGenericOutputRows(pixels, pixelsPerRow, state, firstRow, rowStep, sourceRowShift);
}

void scanoutInterlacedVram(SoftwareBackend& backend, const GxGpuPipelineState& state, u32 sourceRowShift) {
	const bool invalid = !g_interlacedScanout.valid
		|| g_interlacedScanout.width != state.width
		|| g_interlacedScanout.height != state.height
		|| g_interlacedScanout.vramSnapshotSerial != state.vramSnapshotSerial
		|| g_interlacedScanout.pcrtcRevision != state.pcrtcScanout->revision
		|| g_interlacedScanout.sourceRowShift != sourceRowShift;
	const size_t pixelCount = static_cast<size_t>(state.width) * static_cast<size_t>(state.height);
	if (g_interlacedScanout.pixels.size() != pixelCount) {
		g_interlacedScanout.pixels.resize(pixelCount);
	}
	if (invalid) {
		writeOutputRows(g_interlacedScanout.pixels.data(), state.width, state, 0, 1, sourceRowShift);
		g_interlacedScanout.width = state.width;
		g_interlacedScanout.height = state.height;
		g_interlacedScanout.vramSnapshotSerial = state.vramSnapshotSerial;
		g_interlacedScanout.pcrtcRevision = state.pcrtcScanout->revision;
		g_interlacedScanout.sourceRowShift = sourceRowShift;
		g_interlacedScanout.valid = true;
	} else {
		writeOutputRows(
			g_interlacedScanout.pixels.data(),
			state.width,
			state,
			static_cast<i32>(gxGpuScanoutField(state.statusWord)),
			2,
			sourceRowShift);
	}
	const i32 targetPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < state.height; y += 1) {
		u32* target = backend.framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(targetPixelsPerRow);
		const u32* source = g_interlacedScanout.pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(state.width);
		std::copy(source, source + state.width, target);
	}
}

} // namespace

void scanoutGxGpuSoftwareVram(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	const u32 sourceLineStep = gxGpuScanoutSourceLineStep(state.displayModeWord);
	if (sourceLineStep != 0u) {
		scanoutInterlacedVram(backend, state, sourceLineStep == 1u ? 1u : 0u);
		return;
	}
	g_interlacedScanout.valid = false;
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	writeOutputRows(backend.framebuffer(), pixelsPerRow, state, 0, 1, 0u);
}

} // namespace bmsx
