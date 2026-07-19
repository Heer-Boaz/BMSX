#include "render/backend/software/gx_gpu_scanout.h"

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
	bool valid = false;
	u64 vramReplacementSerial = 0u;
};

InterlacedScanoutState g_interlacedScanout;

enum class GenericCircuitOperation : u32 {
	WriteRgba,
	WriteRgb,
	WriteAlpha,
	BlendSourceAlpha,
	BlendConstantAlpha,
};

inline u32 rawWordAtAddress(u32 address) {
	return g_gxGpuSoftwareVram[static_cast<size_t>(address) & (GX_GPU_VRAM_WORD_COUNT - 1u)];
}

inline u32 rgb555Color(u32 word) {
	return static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8(word & 0x1fu))
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u);
}

u32 circuitPixel(
	const GxGpuPcrtcCircuit& circuit,
	u32 sourceX,
	u32 sourceY) {
	if (circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT32
		|| circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT24) {
		const u32 address = gxGpuLocalMemoryAddress32(
			circuit.framebufferBaseWord,
			circuit.framebufferPagesPerRow,
			sourceX,
			sourceY);
		const u32 low = rawWordAtAddress(address);
		const u32 high = rawWordAtAddress(address + 1u);
		const u32 alpha = circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT32 ? high >> 8u : 0x80u;
		return low | ((high & 0xffu) << 16u) | (alpha << 24u);
	}
	if (circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT16
		|| circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT16S) {
		const u32 address = circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_CT16
			? gxGpuLocalMemoryAddress16(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY)
			: gxGpuLocalMemoryAddress16S(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY);
		const u32 word = rawWordAtAddress(address);
		return rgb555Color(word) | ((word & 0x8000u) != 0u ? 0x80000000u : 0u);
	}
	if (circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_GPU24) {
		const u32 first = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0u));
		const u32 second = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1u));
		const u32 rgb = (sourceX & 1u) == 0u
			? first | ((second & 0xffu) << 16u)
			: (first >> 8u) | (second << 8u);
		return rgb | 0x80000000u;
	}
	if (circuit.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_GX16) {
		const u32 word = rawWordAtAddress(gxGpuLocalMemoryAddressGx16(
			circuit.framebufferBaseWord,
			circuit.framebufferWidth,
			sourceX,
			sourceY));
		return rgb555Color(word) | ((word & 0x8000u) != 0u ? 0x80000000u : 0u);
	}
	return 0u;
}

inline u32 outputArgb(u32 pixel) {
	return (pixel & 0xff000000u) | ((pixel & 0xffu) << 16u) | (pixel & 0x0000ff00u) | ((pixel >> 16u) & 0xffu);
}

inline u32 blendOutputArgb(u32 destination, u32 source, u32 blendAlpha, u32 outputAlpha) {
	const u32 inverseAlpha = 255u - blendAlpha;
	const u32 red = ((source & 0xffu) * blendAlpha + ((destination >> 16u) & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 green = (((source >> 8u) & 0xffu) * blendAlpha + ((destination >> 8u) & 0xffu) * inverseAlpha + 127u) / 255u;
	const u32 blue = (((source >> 16u) & 0xffu) * blendAlpha + (destination & 0xffu) * inverseAlpha + 127u) / 255u;
	return outputAlpha | (red << 16u) | (green << 8u) | blue;
}

void fillBackgroundRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep) {
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	const u32 background = outputArgb(scanout.backgroundColor);
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		u32* row = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		std::fill(row, row + state.width, background);
	}
}

inline u32 gx16SourceY(
	const GxGpuPcrtcCircuit& circuit,
	const GxGpuPcrtcScanout& scanout,
	u32 outputY) {
	const u32 relativeY = outputY - circuit.displayY;
	return circuit.framebufferY + (scanout.interlaced
		? (relativeY >> 1u) * circuit.fieldSourceStride + circuit.fieldSourcePhase
		: relativeY);
}

void writeGx16RgbRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	i32 firstRow,
	i32 rowStep,
	u32 destinationAlphaMask,
	u32 sourceAlphaMask) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, *state.pcrtcScanout, y) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 word = rawWordAtAddress(address);
			const u32 alpha = (*output & destinationAlphaMask)
				| (((word & 0x8000u) << 16u) & sourceAlphaMask);
			*output = outputArgb(rgb555Color(word)) | alpha;
			address += 1u;
			output += 1;
		}
	}
}

void writeGx16AlphaRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	i32 firstRow,
	i32 rowStep) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, *state.pcrtcScanout, y) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			*output = (*output & 0x00ffffffu) | ((rawWordAtAddress(address) & 0x8000u) << 16u);
			address += 1u;
			output += 1;
		}
	}
}

void writeGx16SourceAlphaRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	u32 destinationAlphaMask,
	u32 sourceAlphaMask,
	i32 firstRow,
	i32 rowStep) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, *state.pcrtcScanout, y) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 word = rawWordAtAddress(address);
			const u32 sourceMask = 0u - (word >> 15u);
			const u32 destination = *output;
			const u32 rgb = (outputArgb(rgb555Color(word)) & sourceMask)
				| (destination & ~sourceMask & 0x00ffffffu);
			const u32 outputAlpha = (destination & destinationAlphaMask)
				| (((word & 0x8000u) << 16u) & sourceAlphaMask);
			*output = rgb | outputAlpha;
			address += 1u;
			output += 1;
		}
	}
}

void writeGx16BlendedRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	u32 alpha,
	u32 destinationAlphaMask,
	u32 sourceAlphaMask,
	i32 firstRow,
	i32 rowStep) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		u32 address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, *state.pcrtcScanout, y) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 word = rawWordAtAddress(address);
			const u32 outputAlpha = (*output & destinationAlphaMask)
				| (((word & 0x8000u) << 16u) & sourceAlphaMask);
			*output = blendOutputArgb(*output, rgb555Color(word), alpha, outputAlpha);
			address += 1u;
			output += 1;
		}
	}
}

void writeGx16OutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep) {
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	const GxGpuPcrtcCircuit& circuit1 = scanout.circuits[0u];
	const GxGpuPcrtcCircuit& circuit2 = scanout.circuits[1u];
	if (scanout.rgbUnderlayFromCircuit2 && scanout.circuit2CoversOutput) {
		writeGx16RgbRows(
			pixels, pixelsPerRow, state, circuit2, firstRow, rowStep, 0u,
			scanout.outputCircuit2AlphaMask);
	} else {
		fillBackgroundRows(pixels, pixelsPerRow, state, firstRow, rowStep);
		if (scanout.rgbUnderlayFromCircuit2) {
			writeGx16RgbRows(
				pixels, pixelsPerRow, state, circuit2, firstRow, rowStep, 0u,
				scanout.outputCircuit2AlphaMask);
		} else if (scanout.outputAlphaFromCircuit2 && circuit2.enabled) {
			writeGx16AlphaRows(pixels, pixelsPerRow, state, circuit2, firstRow, rowStep);
		}
	}
	if (!circuit1.enabled) return;
	if (!scanout.blendAlphaFromRegister) {
		writeGx16SourceAlphaRows(
			pixels, pixelsPerRow, state, circuit1,
			scanout.outputCircuit2AlphaMask, scanout.outputCircuit1AlphaMask,
			firstRow, rowStep);
		return;
	}
	if (scanout.blendAlpha == 0u) {
		if (!scanout.outputAlphaFromCircuit2) {
			writeGx16AlphaRows(pixels, pixelsPerRow, state, circuit1, firstRow, rowStep);
		}
		return;
	}
	if (scanout.blendAlpha == 255u) {
		writeGx16RgbRows(
			pixels,
			pixelsPerRow,
			state,
			circuit1,
			firstRow,
			rowStep,
			scanout.outputCircuit2AlphaMask,
			scanout.outputCircuit1AlphaMask);
		return;
	}
	writeGx16BlendedRows(
		pixels, pixelsPerRow, state, circuit1, scanout.blendAlpha,
		scanout.outputCircuit2AlphaMask, scanout.outputCircuit1AlphaMask,
		firstRow, rowStep);
}

void writeGenericCircuitRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcCircuit& circuit,
	GenericCircuitOperation operation,
	i32 firstRow,
	i32 rowStep) {
	const u32 outputWidth = static_cast<u32>(state.width);
	const u32 left = circuit.displayX < outputWidth ? circuit.displayX : outputWidth;
	const u32 right = circuit.displayRight < outputWidth ? circuit.displayRight : outputWidth;
	if (left >= right) return;
	const u32 firstSourceNumerator = circuit.sourcePhaseX + (left - circuit.displayX) * circuit.sourceStepX;
	const u32 sourceXStart = circuit.framebufferX
		+ (firstSourceNumerator * circuit.sourceDivisionMultiplierX >> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const u32 sourceRemainderStart = firstSourceNumerator % circuit.magnificationX;
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	const u32 sourceDivisionMultiplierY = scanout.interlaced
		? circuit.interlacedSourceDivisionMultiplierY
		: circuit.sourceDivisionMultiplierY;
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const u32 y = static_cast<u32>(outputY);
		if (y < circuit.displayY || y >= circuit.displayBottom) continue;
		const u32 sourceYNumerator = circuit.sourcePhaseY + (y - circuit.displayY) * circuit.sourceStepY;
		const u32 sourceY = circuit.framebufferY
			+ (sourceYNumerator * sourceDivisionMultiplierY >> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		u32 sourceX = sourceXStart;
		u32 sourceRemainder = sourceRemainderStart;
		u32* output = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow) + left;
		if (operation == GenericCircuitOperation::BlendSourceAlpha) {
			for (u32 outputX = left; outputX < right; outputX += 1u) {
				const u32 source = circuitPixel(circuit, sourceX, sourceY);
				u32 blendAlpha = (source >> 23u) & 0x1feu;
				if (blendAlpha > 255u) blendAlpha = 255u;
				const u32 outputAlpha = (*output & scanout.outputCircuit2AlphaMask)
					| (source & scanout.outputCircuit1AlphaMask);
				*output = blendOutputArgb(*output, source, blendAlpha, outputAlpha);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1u;
				}
				output += 1;
			}
		} else if (operation == GenericCircuitOperation::BlendConstantAlpha) {
			for (u32 outputX = left; outputX < right; outputX += 1u) {
				const u32 source = circuitPixel(circuit, sourceX, sourceY);
				const u32 outputAlpha = (*output & scanout.outputCircuit2AlphaMask)
					| (source & scanout.outputCircuit1AlphaMask);
				*output = blendOutputArgb(*output, source, scanout.blendAlpha, outputAlpha);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1u;
				}
				output += 1;
			}
		} else if (operation == GenericCircuitOperation::WriteRgba) {
			for (u32 outputX = left; outputX < right; outputX += 1u) {
				*output = outputArgb(circuitPixel(circuit, sourceX, sourceY));
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1u;
				}
				output += 1;
			}
		} else if (operation == GenericCircuitOperation::WriteRgb) {
			for (u32 outputX = left; outputX < right; outputX += 1u) {
				const u32 source = circuitPixel(circuit, sourceX, sourceY);
				*output = (outputArgb(source) & 0x00ffffffu) | (*output & 0xff000000u);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1u;
				}
				output += 1;
			}
		} else {
			for (u32 outputX = left; outputX < right; outputX += 1u) {
				const u32 source = circuitPixel(circuit, sourceX, sourceY);
				*output = (*output & 0x00ffffffu) | (source & 0xff000000u);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1u;
				}
				output += 1;
			}
		}
	}
}

void writeGenericOutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep) {
	const GxGpuPcrtcScanout& scanout = *state.pcrtcScanout;
	fillBackgroundRows(pixels, pixelsPerRow, state, firstRow, rowStep);
	if (scanout.rgbUnderlayFromCircuit2) {
		if (scanout.outputAlphaFromCircuit2) {
			writeGenericCircuitRows(
				pixels, pixelsPerRow, state, scanout.circuits[1u],
				GenericCircuitOperation::WriteRgba, firstRow, rowStep);
		} else {
			writeGenericCircuitRows(
				pixels, pixelsPerRow, state, scanout.circuits[1u],
				GenericCircuitOperation::WriteRgb, firstRow, rowStep);
		}
	} else if (scanout.outputAlphaFromCircuit2 && scanout.circuits[1u].enabled) {
		writeGenericCircuitRows(
			pixels,
			pixelsPerRow,
			state,
			scanout.circuits[1u],
			GenericCircuitOperation::WriteAlpha,
			firstRow,
			rowStep);
	}
	if (scanout.circuits[0u].enabled) {
		if (scanout.blendAlphaFromRegister) {
			writeGenericCircuitRows(
				pixels, pixelsPerRow, state, scanout.circuits[0u],
				GenericCircuitOperation::BlendConstantAlpha, firstRow, rowStep);
		} else {
			writeGenericCircuitRows(
				pixels, pixelsPerRow, state, scanout.circuits[0u],
				GenericCircuitOperation::BlendSourceAlpha, firstRow, rowStep);
		}
	}
}

void writeOutputRows(
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	i32 firstRow,
	i32 rowStep) {
	if (state.pcrtcScanout->compositionPath == GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16RgbRows(
			pixels,
			pixelsPerRow,
			state,
			state.pcrtcScanout->circuits[0u],
			firstRow,
			rowStep,
			0u,
			0xff000000u);
		return;
	}
	if (state.pcrtcScanout->compositionPath == GX_GPU_PCRTC_COMPOSE_GX16) {
		writeGx16OutputRows(pixels, pixelsPerRow, state, firstRow, rowStep);
		return;
	}
	writeGenericOutputRows(pixels, pixelsPerRow, state, firstRow, rowStep);
}

void scanoutInterlacedVram(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	const bool geometryChanged = !g_interlacedScanout.valid
		|| g_interlacedScanout.width != state.width
		|| g_interlacedScanout.height != state.height
		|| g_interlacedScanout.vramReplacementSerial != state.vramReplacementSerial;
	const size_t pixelCount = static_cast<size_t>(state.width) * static_cast<size_t>(state.height);
	if (g_interlacedScanout.pixels.size() != pixelCount) {
		g_interlacedScanout.pixels.resize(pixelCount);
	}
	if (geometryChanged) {
		std::fill(
			g_interlacedScanout.pixels.begin(),
			g_interlacedScanout.pixels.end(),
			outputArgb(state.pcrtcScanout->backgroundColor));
		g_interlacedScanout.width = state.width;
		g_interlacedScanout.height = state.height;
		g_interlacedScanout.valid = true;
		g_interlacedScanout.vramReplacementSerial = state.vramReplacementSerial;
	}
	writeOutputRows(
		g_interlacedScanout.pixels.data(),
		state.width,
		state,
		static_cast<i32>(state.pcrtcScanout->field),
		2);
	const i32 targetPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < state.height; y += 1) {
		u32* target = backend.framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(targetPixelsPerRow);
		const u32* source = g_interlacedScanout.pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(state.width);
		std::copy(source, source + state.width, target);
	}
}

} // namespace

void scanoutGxGpuSoftwareVram(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	if (state.pcrtcScanout->interlaced) {
		scanoutInterlacedVram(backend, state);
		return;
	}
	g_interlacedScanout.valid = false;
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	writeOutputRows(backend.framebuffer(), pixelsPerRow, state, 0, 1);
}

} // namespace bmsx
