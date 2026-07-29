#include "render/backend/software/gx_gpu_scanout.h"

#include "machine/devices/gx/gpu_pcrtc.h"
#include "spec/gx/vram.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <algorithm>

namespace bmsx {
namespace {

enum class GenericCircuitOperation : u32 {
	WriteRgba,
	WriteRgb,
	WriteAlpha,
	BlendSourceRgb,
	BlendSourceRgba,
	BlendConstantRgb,
	BlendConstantRgba,
};

enum class Gx16CircuitOperation : u32 {
	WriteRgb,
	WriteRgba,
	WriteAlpha,
	BlendSourceRgb,
	BlendSourceRgba,
	BlendConstantRgb,
	BlendConstantRgba,
};

inline u32 rawWordAtAddress(
	const GxGpuSoftwareState& software,
	u32 address) {
	return software.vram[static_cast<size_t>(address) & software.vramWordMask];
}

inline u32 rgb555Color(u32 word) {
	return static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8(word & 0x1fu))
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u);
}

template<u32 StoragePath>
inline u32 circuitPixel(
	const GxGpuSoftwareState& software,
	const GxGpuPcrtcCircuit& circuit,
	u32 sourceX,
	u32 sourceY) {
	if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_CT32) {
		const u32 address = gxGpuLocalMemoryAddress32(
			circuit.framebufferBaseWord,
			circuit.framebufferPagesPerRow,
			sourceX,
			sourceY);
		const u32 low = rawWordAtAddress(software, address);
		const u32 high = rawWordAtAddress(software, address + 1u);
		return low | ((high & 0xffu) << 16u) | ((high >> 8u) << 24u);
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_CT24) {
		const u32 address = gxGpuLocalMemoryAddress32(
			circuit.framebufferBaseWord,
			circuit.framebufferPagesPerRow,
			sourceX,
			sourceY);
		const u32 low = rawWordAtAddress(software, address);
		return low | ((rawWordAtAddress(software, address + 1u) & 0xffu) << 16u) | 0x80000000u;
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_CT16) {
		const u32 address = gxGpuLocalMemoryAddress16(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY);
		const u32 word = rawWordAtAddress(software, address);
		return rgb555Color(word) | ((word & 0x8000u) << 16u);
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_CT16S) {
		const u32 address = gxGpuLocalMemoryAddress16S(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY);
		const u32 word = rawWordAtAddress(software, address);
		return rgb555Color(word) | ((word & 0x8000u) << 16u);
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_GPU24) {
		const u32 first = rawWordAtAddress(software, gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0u));
		const u32 second = rawWordAtAddress(software, gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1u));
		const u32 rgb = (sourceX & 1u) == 0u
			? first | ((second & 0xffu) << 16u)
			: (first >> 8u) | (second << 8u);
		return rgb | 0x80000000u;
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_GX16) {
		const u32 word = rawWordAtAddress(software, gxGpuLocalMemoryAddressGx16(
			circuit.framebufferBaseWord,
			circuit.framebufferWidth,
			sourceX,
			sourceY));
		return rgb555Color(word) | ((word & 0x8000u) << 16u);
	} else if constexpr (StoragePath == GX_GPU_PCRTC_STORAGE_ZERO) {
		return 0u;
	}
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
	const GxGpuPcrtcScanout& scanout,
	i32 firstRow,
	i32 rowStep) {
	const u32 background = outputArgb(scanout.backgroundColor);
	for (i32 outputY = firstRow; outputY < state.height; outputY += rowStep) {
		u32* row = pixels + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		std::fill(row, row + state.width, background);
	}
}

template<Gx16CircuitOperation Operation>
void writeGx16CircuitRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPcrtcScanout& scanout,
	const GxGpuPcrtcCircuit& circuit) {
	const u32 left = circuit.displayX;
	const u32 right = circuit.displayRight;
	u32 sourceY = circuit.linearFieldSourceY;
	u32 y = circuit.fieldDisplayY;
	for (u32 line = 0u; line < circuit.fieldDisplayLineCount; line += 1u) {
		u32 address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		u32* output = pixels + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 word = rawWordAtAddress(software, address);
			if constexpr (Operation == Gx16CircuitOperation::WriteAlpha) {
				*output = (*output & 0x00ffffffu) | ((word & 0x8000u) << 16u);
			} else if constexpr (Operation == Gx16CircuitOperation::BlendConstantRgb
				|| Operation == Gx16CircuitOperation::BlendConstantRgba) {
				if constexpr (Operation == Gx16CircuitOperation::BlendConstantRgba) {
					*output = blendOutputArgb(
						*output, rgb555Color(word), scanout.blendAlpha, (word & 0x8000u) << 16u);
				} else {
					*output = blendOutputArgb(
						*output, rgb555Color(word), scanout.blendAlpha, *output & 0xff000000u);
				}
			} else {
				const u32 sourceRgb = outputArgb(rgb555Color(word));
				if constexpr (Operation == Gx16CircuitOperation::WriteRgb) {
					*output = sourceRgb | (*output & 0xff000000u);
				} else if constexpr (Operation == Gx16CircuitOperation::WriteRgba) {
					*output = sourceRgb | ((word & 0x8000u) << 16u);
				} else if constexpr (Operation == Gx16CircuitOperation::BlendSourceRgb
					|| Operation == Gx16CircuitOperation::BlendSourceRgba) {
					const u32 sourceMask = 0u - (word >> 15u);
					const u32 destination = *output;
					const u32 rgb = (sourceRgb & sourceMask)
						| (destination & ~sourceMask & 0x00ffffffu);
					if constexpr (Operation == Gx16CircuitOperation::BlendSourceRgba) {
						*output = rgb | ((word & 0x8000u) << 16u);
					} else {
						*output = rgb | (destination & 0xff000000u);
					}
				}
			}
			address += 1u;
			output += 1;
		}
		y += scanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}

void writeGx16OutputRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	i32 firstRow,
	i32 rowStep) {
	const GxGpuPcrtcCircuit& circuit1 = scanout.circuits[0u];
	const GxGpuPcrtcCircuit& circuit2 = scanout.circuits[1u];
	if (scanout.backgroundRequired != 0u) {
		fillBackgroundRows(pixels, pixelsPerRow, state, scanout, firstRow, rowStep);
	}
	if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteRgb>(software, pixels, pixelsPerRow, scanout, circuit2);
	} else if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteRgba>(software, pixels, pixelsPerRow, scanout, circuit2);
	} else if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteAlpha>(software, pixels, pixelsPerRow, scanout, circuit2);
	}
	if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteAlpha>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		writeGx16CircuitRows<Gx16CircuitOperation::BlendSourceRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) {
		writeGx16CircuitRows<Gx16CircuitOperation::BlendSourceRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		writeGx16CircuitRows<Gx16CircuitOperation::BlendConstantRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		writeGx16CircuitRows<Gx16CircuitOperation::BlendConstantRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	}
}

template<u32 StoragePath, GenericCircuitOperation Operation>
void writeGenericCircuitRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPcrtcScanout& scanout,
	const GxGpuPcrtcCircuit& circuit) {
	const u32 left = circuit.displayX;
	const u32 right = circuit.displayRight;
	const u32 sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const u32 sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	u32 sourceYNumerator = circuit.fieldSourceNumeratorY;
	u32 y = circuit.fieldDisplayY;
	for (u32 line = 0u; line < circuit.fieldDisplayLineCount; line += 1u) {
		const u32 sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		u32 sourceX = sourceXStart;
		u32 sourceRemainder = sourceRemainderStart;
		u32* output = pixels + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow) + left;
		for (u32 outputX = left; outputX < right; outputX += 1u) {
			const u32 source = circuitPixel<StoragePath>(software, circuit, sourceX, sourceY);
			if constexpr (Operation == GenericCircuitOperation::WriteRgba) {
				*output = outputArgb(source);
			} else if constexpr (Operation == GenericCircuitOperation::WriteRgb) {
				*output = (outputArgb(source) & 0x00ffffffu) | (*output & 0xff000000u);
			} else if constexpr (Operation == GenericCircuitOperation::WriteAlpha) {
				*output = (*output & 0x00ffffffu) | (source & 0xff000000u);
			} else if constexpr (Operation == GenericCircuitOperation::BlendSourceRgb
				|| Operation == GenericCircuitOperation::BlendSourceRgba) {
				const u32 doubledAlpha = (source >> 23u) & 0x1feu;
				const u32 blendAlpha = (doubledAlpha | (0u - (doubledAlpha >> 8u))) & 0xffu;
				if constexpr (Operation == GenericCircuitOperation::BlendSourceRgba) {
					*output = blendOutputArgb(*output, source, blendAlpha, source & 0xff000000u);
				} else {
					*output = blendOutputArgb(*output, source, blendAlpha, *output & 0xff000000u);
				}
			} else {
				if constexpr (Operation == GenericCircuitOperation::BlendConstantRgba) {
					*output = blendOutputArgb(*output, source, scanout.blendAlpha, source & 0xff000000u);
				} else {
					*output = blendOutputArgb(*output, source, scanout.blendAlpha, *output & 0xff000000u);
				}
			}
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1u;
			}
			output += 1;
		}
		y += scanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

template<GenericCircuitOperation Operation>
void dispatchGenericCircuitRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPcrtcScanout& scanout,
	const GxGpuPcrtcCircuit& circuit) {
	switch (circuit.framebufferStoragePath) {
		case GX_GPU_PCRTC_STORAGE_CT32:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_CT32, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_CT24:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_CT24, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_CT16:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_CT16, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_CT16S:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_CT16S, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_GPU24:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_GPU24, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_GX16:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_GX16, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
		case GX_GPU_PCRTC_STORAGE_ZERO:
			writeGenericCircuitRows<GX_GPU_PCRTC_STORAGE_ZERO, Operation>(software, pixels, pixelsPerRow, scanout, circuit);
			return;
	}
}

void writeGenericOutputRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	i32 firstRow,
	i32 rowStep) {
	if (scanout.backgroundRequired != 0u) {
		fillBackgroundRows(pixels, pixelsPerRow, state, scanout, firstRow, rowStep);
	}
	const GxGpuPcrtcCircuit& circuit2 = scanout.circuits[1u];
	if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteRgb>(software, pixels, pixelsPerRow, scanout, circuit2);
	} else if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteRgba>(software, pixels, pixelsPerRow, scanout, circuit2);
	} else if (scanout.circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteAlpha>(software, pixels, pixelsPerRow, scanout, circuit2);
	}
	const GxGpuPcrtcCircuit& circuit1 = scanout.circuits[0u];
	if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::WriteAlpha>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		dispatchGenericCircuitRows<GenericCircuitOperation::BlendSourceRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::BlendSourceRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		dispatchGenericCircuitRows<GenericCircuitOperation::BlendConstantRgb>(software, pixels, pixelsPerRow, scanout, circuit1);
	} else if (scanout.circuit1OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		dispatchGenericCircuitRows<GenericCircuitOperation::BlendConstantRgba>(software, pixels, pixelsPerRow, scanout, circuit1);
	}
}

void writeOutputRows(
	const GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	i32 firstRow,
	i32 rowStep) {
	if (scanout.compositionPath == GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16CircuitRows<Gx16CircuitOperation::WriteRgba>(
			software,
			pixels,
			pixelsPerRow,
			scanout,
			scanout.circuits[0u]);
		return;
	}
	if (scanout.compositionPath == GX_GPU_PCRTC_COMPOSE_GX16) {
		writeGx16OutputRows(software, pixels, pixelsPerRow, state, scanout, firstRow, rowStep);
		return;
	}
	writeGenericOutputRows(software, pixels, pixelsPerRow, state, scanout, firstRow, rowStep);
}

void scanoutInterlacedVram(
	GxGpuSoftwareState& software,
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	u64 vramReplacementSerial
) {
	const bool geometryChanged = !software.interlacedValid
		|| software.interlacedVramReplacementSerial != vramReplacementSerial;
	const size_t pixelCount = static_cast<size_t>(state.width) * static_cast<size_t>(state.height);
	if (geometryChanged) {
		std::fill(
			software.interlacedPixels.begin(),
			software.interlacedPixels.begin() + pixelCount,
			outputArgb(scanout.backgroundColor));
		software.interlacedValid = true;
		software.interlacedVramReplacementSerial = vramReplacementSerial;
	}
	writeOutputRows(
		software,
		software.interlacedPixels.data(),
		state.width,
		state,
		scanout,
		static_cast<i32>(scanout.field),
		2);
	const i32 targetPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < state.height; y += 1) {
		u32* target = backend.framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(targetPixelsPerRow);
		const u32* source = software.interlacedPixels.data()
			+ static_cast<size_t>(y) * static_cast<size_t>(state.width);
		std::copy(source, source + state.width, target);
	}
}

} // namespace

void scanoutGxGpuSoftwareVram(
	GxGpuSoftwareState& software,
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	u64 vramReplacementSerial
) {
	if (scanout.interlaced) {
		scanoutInterlacedVram(software, backend, state, scanout, vramReplacementSerial);
		return;
	}
	software.interlacedValid = false;
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	writeOutputRows(software, backend.framebuffer(), pixelsPerRow, state, scanout, 0, 1);
}

} // namespace bmsx
