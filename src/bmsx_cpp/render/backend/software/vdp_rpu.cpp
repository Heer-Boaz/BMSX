#include "render/backend/software/vdp_rpu.h"

#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/rpu.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/gameview.h"
#include "render/vdp/slot_textures.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <vector>

namespace bmsx {
namespace {

constexpr f64 SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH = 1.0;
constexpr i32 SOFTWARE_RPU_POINT_SIZE = 3;

struct SoftwareRpuSurface {
	std::vector<u32> pixels;
	std::vector<f64> depth;
	u32 revision = 0;
	u32 width = 0;
	u32 height = 0;
	u8 format = 0;
};

struct SoftwareRpuTarget {
	u32* pixels = nullptr;
	i32 width = 0;
	i32 height = 0;
	i32 stride = 0;
	std::vector<f64>* depth = nullptr;
};

struct SoftwareRpuContext {
	std::array<SoftwareRpuSurface, VDP_RPU_SURFACE_CAPACITY> surfaces{};
	std::vector<f64> defaultDepth;
	std::array<f64, 4> vx{};
	std::array<f64, 4> vy{};
	std::array<f64, 4> vz{};
	std::array<f64, 4> vu{};
	std::array<f64, 4> vv{};
	std::array<f64, 4> vr{};
	std::array<f64, 4> vg{};
	std::array<f64, 4> vb{};
	std::array<f64, 4> va{};
	std::array<f64, 24> attr{};
	std::array<u8, 4> joint{};
};

SoftwareRpuContext g_rpuSoftware{};

inline u16 readU16(const u8* bytes, u32 offset) {
	return static_cast<u16>(bytes[offset] | (static_cast<u16>(bytes[offset + 1u]) << 8u));
}

inline u32 readU32(const u8* bytes, u32 offset) {
	return static_cast<u32>(bytes[offset])
		| (static_cast<u32>(bytes[offset + 1u]) << 8u)
		| (static_cast<u32>(bytes[offset + 2u]) << 16u)
		| (static_cast<u32>(bytes[offset + 3u]) << 24u);
}

inline f32 wordAsF32(u32 word) {
	return std::bit_cast<f32>(word);
}

inline f32 readF32(const u8* bytes, u32 offset) {
	return wordAsF32(readU32(bytes, offset));
}

inline i32 rasterFloor(f64 value) {
	const i32 truncated = static_cast<i32>(value);
	return value < static_cast<f64>(truncated) ? truncated - 1 : truncated;
}

inline i32 rasterCeil(f64 value) {
	const i32 truncated = static_cast<i32>(value);
	return value > static_cast<f64>(truncated) ? truncated + 1 : truncated;
}

inline i32 rasterRound(f64 value) {
	return value >= 0.0 ? static_cast<i32>(value + 0.5) : static_cast<i32>(value - 0.5);
}

inline u8 clampByte(f64 value) {
	if (value <= 0.0) return 0u;
	if (value >= 255.0) return 255u;
	return static_cast<u8>(value);
}

inline u8 floatByte(f64 value) {
	return clampByte(value * 255.0 + 0.5);
}

inline u32 packArgb(u8 r, u8 g, u8 b, u8 a) {
	return (static_cast<u32>(a) << 24u) | (static_cast<u32>(r) << 16u) | (static_cast<u32>(g) << 8u) | static_cast<u32>(b);
}

inline u8 colorByteR(u32 color) { return static_cast<u8>((color >> 16u) & 0xffu); }
inline u8 colorByteG(u32 color) { return static_cast<u8>((color >> 8u) & 0xffu); }
inline u8 colorByteB(u32 color) { return static_cast<u8>(color & 0xffu); }
inline u8 colorByteA(u32 color) { return static_cast<u8>((color >> 24u) & 0xffu); }

void syncSurfaceStorage(const VdpRpuFrameOutput& frame, u16 surfaceRef) {
	const auto& refs = frame.resources.surfaceRefs;
	const u32 surfaceId = refs.surfaceId[surfaceRef];
	SoftwareRpuSurface& surface = g_rpuSoftware.surfaces[surfaceId];
	const u32 revision = refs.revision[surfaceRef];
	const u32 width = refs.width[surfaceRef];
	const u32 height = refs.height[surfaceRef];
	const u8 format = refs.format[surfaceRef];
	if (surface.revision == revision && surface.width == width && surface.height == height && surface.format == format) {
		return;
	}
	surface.revision = revision;
	surface.width = width;
	surface.height = height;
	surface.format = format;
	if (format == VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		surface.depth.assign(static_cast<size_t>(width) * static_cast<size_t>(height), SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH);
		surface.pixels.clear();
		return;
	}
	surface.pixels.assign(static_cast<size_t>(width) * static_cast<size_t>(height), 0u);
	surface.depth.clear();
}

void prepareDefaultDepth(i32 width, i32 height) {
	const size_t count = static_cast<size_t>(width) * static_cast<size_t>(height);
	if (g_rpuSoftware.defaultDepth.size() != count) {
		g_rpuSoftware.defaultDepth.assign(count, SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH);
	}
}

SoftwareRpuTarget passColorTarget(SoftwareBackend& backend, const VdpRpuFrameOutput& frame, size_t passIndex) {
	const u16 colorRef = frame.commands.passColorSurfaceRef[passIndex];
	if (colorRef == VDP_RPU_REF_NONE) {
		return SoftwareRpuTarget{backend.framebuffer(), backend.width(), backend.height(), backend.pitch() / static_cast<i32>(sizeof(u32)), &g_rpuSoftware.defaultDepth};
	}
	syncSurfaceStorage(frame, colorRef);
	const u32 surfaceId = frame.resources.surfaceRefs.surfaceId[colorRef];
	SoftwareRpuSurface& surface = g_rpuSoftware.surfaces[surfaceId];
	return SoftwareRpuTarget{surface.pixels.data(), static_cast<i32>(surface.width), static_cast<i32>(surface.height), static_cast<i32>(surface.width), &g_rpuSoftware.defaultDepth};
}

std::vector<f64>* passDepthTarget(const VdpRpuFrameOutput& frame, size_t passIndex) {
	const u16 depthRef = frame.commands.passDepthSurfaceRef[passIndex];
	if (depthRef == VDP_RPU_REF_NONE) {
		return &g_rpuSoftware.defaultDepth;
	}
	syncSurfaceStorage(frame, depthRef);
	const u32 surfaceId = frame.resources.surfaceRefs.surfaceId[depthRef];
	return &g_rpuSoftware.surfaces[surfaceId].depth;
}

void setDefaultAttribute(u32 attributeId) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	ctx.attr[0] = 0.0; ctx.attr[1] = 0.0; ctx.attr[2] = 0.0; ctx.attr[3] = 1.0;
	switch (attributeId) {
		case VDP_RPU_ATTR_COLOR:
		case VDP_RPU_ATTR_INSTANCE_COLOR:
			ctx.attr[0] = 1.0; ctx.attr[1] = 1.0; ctx.attr[2] = 1.0;
			break;
		case VDP_RPU_ATTR_JOINTS:
			ctx.attr[3] = 0.0;
			ctx.joint = {0u, 0u, 0u, 0u};
			break;
		case VDP_RPU_ATTR_NORMAL:
			ctx.attr[2] = 1.0;
			break;
		case VDP_RPU_ATTR_WEIGHTS:
			ctx.attr[0] = 1.0; ctx.attr[3] = 0.0;
			break;
		case VDP_RPU_ATTR_INSTANCE0:
			ctx.attr[0] = 1.0; ctx.attr[3] = 0.0;
			break;
		case VDP_RPU_ATTR_INSTANCE1:
			ctx.attr[1] = 1.0; ctx.attr[3] = 0.0;
			break;
		case VDP_RPU_ATTR_INSTANCE2:
			ctx.attr[2] = 1.0; ctx.attr[3] = 0.0;
			break;
		case VDP_RPU_ATTR_INSTANCE_UVRECT:
			ctx.attr[2] = 1.0;
			break;
	}
}

void fillColorTarget(SoftwareRpuTarget& target, u32 color) {
	const u32 packed = packArgb(colorByteR(color), colorByteG(color), colorByteB(color), colorByteA(color));
	for (i32 y = 0; y < target.height; ++y) {
		u32* row = target.pixels + static_cast<size_t>(y) * static_cast<size_t>(target.stride);
		for (i32 x = 0; x < target.width; ++x) {
			row[x] = packed;
		}
	}
}

void readAttribute(const VdpRpuFrameOutput& frame, size_t bindingIndex, u32 elementIndex, u32 attributeId) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const VdpRpuCommandBuffer& commands = frame.commands;
	const VdpRpuStreamLayoutSpec& layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[bindingIndex]);
	const u16 refIndex = commands.streamBufferRef[bindingIndex];
	setDefaultAttribute(attributeId);
	if (refIndex == VDP_RPU_REF_NONE) {
		return;
	}
	const VdpRpuFrameBufferRefs& refs = frame.resources.bufferRefs;
	const u8* bytes = refs.bytes[refIndex];
	const u32 elementOffset = refs.byteOffset[refIndex] + commands.streamByteOffset[bindingIndex] - refs.sourceByteOffset[refIndex] + elementIndex * layout.byteStride;
	for (size_t index = 0; index < layout.attributeCount; ++index) {
		const VdpRpuStreamAttributeSpec& spec = layout.attributes[index];
		if (spec.attribute != attributeId) continue;
		const u32 offset = elementOffset + spec.byteOffset;
		if (spec.componentType == VDP_RPU_ATTR_F32) {
			for (u32 component = 0; component < spec.componentCount; ++component) {
				ctx.attr[component] = readF32(bytes, offset + component * 4u);
			}
			return;
		}
		if (spec.componentType == VDP_RPU_ATTR_U8N) {
			for (u32 component = 0; component < spec.componentCount; ++component) {
				ctx.attr[component] = static_cast<f64>(bytes[offset + component]) * (1.0 / 255.0);
			}
			return;
		}
		if (spec.componentType == VDP_RPU_ATTR_U8) {
			for (u32 component = 0; component < spec.componentCount; ++component) {
				ctx.attr[component] = bytes[offset + component];
			}
			ctx.joint[0] = bytes[offset];
			ctx.joint[1] = bytes[offset + 1u];
			ctx.joint[2] = bytes[offset + 2u];
			ctx.joint[3] = bytes[offset + 3u];
			return;
		}
	}
}

size_t findBindingSlot(const u8* slots, size_t firstBinding, size_t bindingCount, u32 slot) {
	const size_t bindingEnd = firstBinding + bindingCount;
	for (size_t bindingIndex = firstBinding; bindingIndex < bindingEnd; ++bindingIndex) {
		if (slots[bindingIndex] == slot) {
			return bindingIndex;
		}
	}
	return bindingEnd;
}

u32 constantWord(const VdpRpuFrameOutput& frame, size_t bindingIndex, u32 wordIndex) {
	const auto& commands = frame.commands;
	const u16 bank = commands.constantBank[bindingIndex];
	if (bank == VDP_RPU_REF_NONE) return 0u;
	return frame.resources.constantWords[frame.resources.constantBanks.firstWord[bank] + commands.constantFirstWord[bindingIndex] + wordIndex];
}

f64 constantF32(const VdpRpuFrameOutput& frame, size_t bindingIndex, u32 wordIndex) {
	return wordAsF32(constantWord(frame, bindingIndex, wordIndex));
}

f64 matrixValue(const VdpRpuFrameOutput& frame, size_t bindingIndex, u32 row, u32 column) {
	return constantF32(frame, bindingIndex, column * 4u + row);
}

void transformMatrix(const VdpRpuFrameOutput& frame, size_t bindingIndex, f64 x, f64 y, f64 z) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	ctx.attr[0] = matrixValue(frame, bindingIndex, 0u, 0u) * x + matrixValue(frame, bindingIndex, 0u, 1u) * y + matrixValue(frame, bindingIndex, 0u, 2u) * z + matrixValue(frame, bindingIndex, 0u, 3u);
	ctx.attr[1] = matrixValue(frame, bindingIndex, 1u, 0u) * x + matrixValue(frame, bindingIndex, 1u, 1u) * y + matrixValue(frame, bindingIndex, 1u, 2u) * z + matrixValue(frame, bindingIndex, 1u, 3u);
	ctx.attr[2] = matrixValue(frame, bindingIndex, 2u, 0u) * x + matrixValue(frame, bindingIndex, 2u, 1u) * y + matrixValue(frame, bindingIndex, 2u, 2u) * z + matrixValue(frame, bindingIndex, 2u, 3u);
	ctx.attr[3] = matrixValue(frame, bindingIndex, 3u, 0u) * x + matrixValue(frame, bindingIndex, 3u, 1u) * y + matrixValue(frame, bindingIndex, 3u, 2u) * z + matrixValue(frame, bindingIndex, 3u, 3u);
}

void applySkin(const VdpRpuFrameOutput& frame, size_t bindingIndex, f64 x, f64 y, f64 z, f64 nx, f64 ny, f64 nz) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	f64 px = 0.0;
	f64 py = 0.0;
	f64 pz = 0.0;
	f64 pw = 0.0;
	f64 snx = 0.0;
	f64 sny = 0.0;
	f64 snz = 0.0;
	for (u32 joint = 0; joint < 4u; ++joint) {
		const f64 weight = ctx.attr[16u + joint];
		const u32 base = static_cast<u32>(ctx.joint[joint]) * 16u;
		px += (constantF32(frame, bindingIndex, base + 0u) * x + constantF32(frame, bindingIndex, base + 4u) * y + constantF32(frame, bindingIndex, base + 8u) * z + constantF32(frame, bindingIndex, base + 12u)) * weight;
		py += (constantF32(frame, bindingIndex, base + 1u) * x + constantF32(frame, bindingIndex, base + 5u) * y + constantF32(frame, bindingIndex, base + 9u) * z + constantF32(frame, bindingIndex, base + 13u)) * weight;
		pz += (constantF32(frame, bindingIndex, base + 2u) * x + constantF32(frame, bindingIndex, base + 6u) * y + constantF32(frame, bindingIndex, base + 10u) * z + constantF32(frame, bindingIndex, base + 14u)) * weight;
		pw += (constantF32(frame, bindingIndex, base + 3u) * x + constantF32(frame, bindingIndex, base + 7u) * y + constantF32(frame, bindingIndex, base + 11u) * z + constantF32(frame, bindingIndex, base + 15u)) * weight;
		snx += (constantF32(frame, bindingIndex, base + 0u) * nx + constantF32(frame, bindingIndex, base + 4u) * ny + constantF32(frame, bindingIndex, base + 8u) * nz) * weight;
		sny += (constantF32(frame, bindingIndex, base + 1u) * nx + constantF32(frame, bindingIndex, base + 5u) * ny + constantF32(frame, bindingIndex, base + 9u) * nz) * weight;
		snz += (constantF32(frame, bindingIndex, base + 2u) * nx + constantF32(frame, bindingIndex, base + 6u) * ny + constantF32(frame, bindingIndex, base + 10u) * nz) * weight;
	}
	ctx.attr[0] = px;
	ctx.attr[1] = py;
	ctx.attr[2] = pz;
	ctx.attr[3] = pw;
	ctx.attr[4] = snx;
	ctx.attr[5] = sny;
	ctx.attr[6] = snz;
}

void applyDefaultSkin(f64 x, f64 y, f64 z, f64 nx, f64 ny, f64 nz) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const f64 weightSum = ctx.attr[16] + ctx.attr[17] + ctx.attr[18] + ctx.attr[19];
	ctx.attr[0] = x * weightSum;
	ctx.attr[1] = y * weightSum;
	ctx.attr[2] = z * weightSum;
	ctx.attr[3] = weightSum;
	ctx.attr[4] = nx * weightSum;
	ctx.attr[5] = ny * weightSum;
	ctx.attr[6] = nz * weightSum;
}

void writeVertex(const VdpRpuFrameOutput& frame, size_t drawIndex, const VdpRpuShaderVariantSpec& shaderVariant, u16 rawVariantWord, u32 vertexIndex, u32 instanceIndex, size_t outIndex, i32 width, i32 height) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t streamFirstBinding = commands.drawFirstStreamBinding[drawIndex];
	const size_t streamBindingCount = commands.drawStreamBindingCount[drawIndex];
	const size_t bindingEnd = streamFirstBinding + streamBindingCount;
	const size_t constantFirstBinding = commands.drawFirstConstantBinding[drawIndex];
	const size_t constantBindingCount = commands.drawConstantBindingCount[drawIndex];
	const size_t constantBindingEnd = constantFirstBinding + constantBindingCount;
	const u8* constantBindingSlot = commands.constantBindingSlot.data();
	const size_t vertexBinding = findBindingSlot(commands.streamSlot.data(), streamFirstBinding, streamBindingCount, 0u);
	const size_t instanceBinding = findBindingSlot(commands.streamSlot.data(), streamFirstBinding, streamBindingCount, 1u);
	f64 px = 0.0;
	f64 py = 0.0;
	f64 pz = 0.0;
	f64 pw = 1.0;
	f64 u = 0.0;
	f64 v = 0.0;
	f64 r = 1.0;
	f64 g = 1.0;
	f64 b = 1.0;
	f64 a = 1.0;
	f64 nx = 0.0;
	f64 ny = 0.0;
	f64 nz = 1.0;
	ctx.attr[16] = 1.0;
	ctx.attr[17] = 0.0;
	ctx.attr[18] = 0.0;
	ctx.attr[19] = 0.0;
	ctx.joint = {0u, 0u, 0u, 0u};
	if (vertexBinding != bindingEnd) {
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_POS);
		px = ctx.attr[0]; py = ctx.attr[1]; pz = ctx.attr[2];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_UV0);
		u = ctx.attr[0]; v = ctx.attr[1];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_COLOR);
		r = ctx.attr[0]; g = ctx.attr[1]; b = ctx.attr[2]; a = ctx.attr[3];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_NORMAL);
		nx = ctx.attr[0]; ny = ctx.attr[1]; nz = ctx.attr[2];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_JOINTS);
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_WEIGHTS);
		ctx.attr[16] = ctx.attr[0]; ctx.attr[17] = ctx.attr[1]; ctx.attr[18] = ctx.attr[2]; ctx.attr[19] = ctx.attr[3];
	}
	if ((rawVariantWord & VDP_RPU_SHADER_FLAG_MORPH) != 0u) {
		const size_t morphBinding = findBindingSlot(commands.streamSlot.data(), streamFirstBinding, streamBindingCount, 2u);
		if (morphBinding != bindingEnd) {
			readAttribute(frame, morphBinding, vertexIndex, VDP_RPU_ATTR_MORPH_POS);
			px += ctx.attr[0]; py += ctx.attr[1]; pz += ctx.attr[2];
			readAttribute(frame, morphBinding, vertexIndex, VDP_RPU_ATTR_MORPH_NRM);
			nx += ctx.attr[0]; ny += ctx.attr[1]; nz += ctx.attr[2];
		}
	}
	if (shaderVariant.jointConstantSlot != VDP_RPU_RESOURCE_NONE) {
		const size_t jointBinding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, shaderVariant.jointConstantSlot);
		if (jointBinding == constantBindingEnd || commands.constantBank[jointBinding] == VDP_RPU_REF_NONE) {
			applyDefaultSkin(px, py, pz, nx, ny, nz);
		} else {
			applySkin(frame, jointBinding, px, py, pz, nx, ny, nz);
		}
		px = ctx.attr[0]; py = ctx.attr[1]; pz = ctx.attr[2]; pw = ctx.attr[3];
		nx = ctx.attr[4]; ny = ctx.attr[5]; nz = ctx.attr[6];
	}
	bool applyInstanceColor = false;
	if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_AFFINE2 && instanceBinding != bindingEnd) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE0);
		const f64 i0x = ctx.attr[0]; const f64 i0y = ctx.attr[1]; const f64 i0z = ctx.attr[2]; const f64 i0w = ctx.attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE1);
		const f64 i1x = ctx.attr[0]; const f64 i1y = ctx.attr[1]; const f64 i1z = ctx.attr[2];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_UVRECT);
		const f64 uvx = ctx.attr[0]; const f64 uvy = ctx.attr[1]; const f64 uvz = ctx.attr[2]; const f64 uvw = ctx.attr[3];
		const f64 oldX = px;
		const f64 oldY = py;
		px = i0x * oldX + i0y * oldY + i0z;
		py = i1x * oldX + i1y * oldY + i1z;
		pz = i0w;
		pw = 1.0;
		u = uvx + u * uvz;
		v = uvy + v * uvw;
		applyInstanceColor = true;
	} else if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_MAT4 && instanceBinding != bindingEnd) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE0);
		const f64 m00 = ctx.attr[0]; const f64 m10 = ctx.attr[1]; const f64 m20 = ctx.attr[2]; const f64 m30 = ctx.attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE1);
		const f64 m01 = ctx.attr[0]; const f64 m11 = ctx.attr[1]; const f64 m21 = ctx.attr[2]; const f64 m31 = ctx.attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE2);
		const f64 m02 = ctx.attr[0]; const f64 m12 = ctx.attr[1]; const f64 m22 = ctx.attr[2]; const f64 m32 = ctx.attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE3);
		const f64 m03 = ctx.attr[0]; const f64 m13 = ctx.attr[1]; const f64 m23 = ctx.attr[2]; const f64 m33 = ctx.attr[3];
		const f64 oldX = px; const f64 oldY = py; const f64 oldZ = pz; const f64 oldW = pw;
		px = m00 * oldX + m01 * oldY + m02 * oldZ + m03 * oldW;
		py = m10 * oldX + m11 * oldY + m12 * oldZ + m13 * oldW;
		pz = m20 * oldX + m21 * oldY + m22 * oldZ + m23 * oldW;
		pw = m30 * oldX + m31 * oldY + m32 * oldZ + m33 * oldW;
		applyInstanceColor = true;
	}
	if (applyInstanceColor) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_COLOR);
		r *= ctx.attr[0]; g *= ctx.attr[1]; b *= ctx.attr[2]; a *= ctx.attr[3];
	}
	// Save model-space position (pre-MVP) for point light attenuation
	const f64 modelX = px; const f64 modelY = py; const f64 modelZ = pz;
	if (shaderVariant.usesC0 != 0u) {
		const size_t c0Binding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, 0u);
		if (c0Binding != constantBindingEnd && commands.constantBank[c0Binding] != VDP_RPU_REF_NONE) {
			transformMatrix(frame, c0Binding, px, py, pz);
			px = ctx.attr[0]; py = ctx.attr[1]; pz = ctx.attr[2]; pw = ctx.attr[3];
		}
	}
	if (shaderVariant.lightingConstantSlot != VDP_RPU_RESOURCE_NONE) {
		const size_t c1Binding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, shaderVariant.lightingConstantSlot);
		if (c1Binding != constantBindingEnd && commands.constantBank[c1Binding] != VDP_RPU_REF_NONE) {
			// Apply normal matrix from C0 if available
			f64 lnx = nx; f64 lny = ny; f64 lnz = nz;
			const size_t c0BindingNm = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, 0u);
			if (c0BindingNm != constantBindingEnd && commands.constantBank[c0BindingNm] != VDP_RPU_REF_NONE
				&& commands.constantWordCount[c0BindingNm] >= 25u) {
				lnx = constantF32(frame, c0BindingNm, 16u) * nx + constantF32(frame, c0BindingNm, 19u) * ny + constantF32(frame, c0BindingNm, 22u) * nz;
				lny = constantF32(frame, c0BindingNm, 17u) * nx + constantF32(frame, c0BindingNm, 20u) * ny + constantF32(frame, c0BindingNm, 23u) * nz;
				lnz = constantF32(frame, c0BindingNm, 18u) * nx + constantF32(frame, c0BindingNm, 21u) * ny + constantF32(frame, c0BindingNm, 24u) * nz;
			}
			const f64 nl = std::sqrt(lnx * lnx + lny * lny + lnz * lnz);
			const f64 invNl = nl > 0.0 ? 1.0 / nl : 0.0;
			const f64 fnx = lnx * invNl; const f64 fny = lny * invNl; const f64 fnz = lnz * invNl;
			// Ambient: words 0-3 (r,g,b,intensity)
			const f64 ambR = constantF32(frame, c1Binding, 0u);
			const f64 ambG = constantF32(frame, c1Binding, 1u);
			const f64 ambB = constantF32(frame, c1Binding, 2u);
			const f64 ambI = constantF32(frame, c1Binding, 3u);
			f64 totalR = ambR * ambI;
			f64 totalG = ambG * ambI;
			f64 totalB = ambB * ambI;
			// 4 directional lights: words 4-35 (each 8 words: dir.xyz+pad, color.rgb+intensity)
			for (u32 li = 0u; li < 4u; ++li) {
				const u32 base = 4u + li * 8u;
				const f64 dlx = constantF32(frame, c1Binding, base);
				const f64 dly = constantF32(frame, c1Binding, base + 1u);
				const f64 dlz = constantF32(frame, c1Binding, base + 2u);
				const f64 dlr = constantF32(frame, c1Binding, base + 4u);
				const f64 dlg = constantF32(frame, c1Binding, base + 5u);
				const f64 dlb = constantF32(frame, c1Binding, base + 6u);
				const f64 dli = constantF32(frame, c1Binding, base + 7u);
				if (dli <= 0.0) continue;
				const f64 ll = std::sqrt(dlx * dlx + dly * dly + dlz * dlz);
				if (ll <= 0.0) continue;
				const f64 ndl = std::max(0.0, fnx * (dlx / ll) + fny * (dly / ll) + fnz * (dlz / ll));
				totalR += dlr * dli * ndl;
				totalG += dlg * dli * ndl;
				totalB += dlb * dli * ndl;
			}
			// 4 point lights: words 36-67 (each 8 words: pos.xyz+range, color.rgb+intensity)
			for (u32 li = 0u; li < 4u; ++li) {
				const u32 base = 36u + li * 8u;
				const f64 plx = constantF32(frame, c1Binding, base);
				const f64 ply = constantF32(frame, c1Binding, base + 1u);
				const f64 plz = constantF32(frame, c1Binding, base + 2u);
				const f64 plRange = constantF32(frame, c1Binding, base + 3u);
				const f64 plr = constantF32(frame, c1Binding, base + 4u);
				const f64 plg = constantF32(frame, c1Binding, base + 5u);
				const f64 plb = constantF32(frame, c1Binding, base + 6u);
				const f64 pli = constantF32(frame, c1Binding, base + 7u);
				if (pli <= 0.0 || plRange <= 0.0) continue;
				const f64 ddx = modelX - plx; const f64 ddy = modelY - ply; const f64 ddz = modelZ - plz;
				const f64 dist = std::sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
				const f64 atten = std::max(0.0, 1.0 - dist / plRange);
				totalR += plr * pli * atten;
				totalG += plg * pli * atten;
				totalB += plb * pli * atten;
			}
			// Emissive: words 68-70; alpha cutoff: word 71
			const f64 emR = constantF32(frame, c1Binding, 68u);
			const f64 emG = constantF32(frame, c1Binding, 69u);
			const f64 emB = constantF32(frame, c1Binding, 70u);
			const f64 alphaCutoff = constantF32(frame, c1Binding, 71u);
			r = r * totalR + emR;
			g = g * totalG + emG;
			b = b * totalB + emB;
			if (a <= 0.0 || (alphaCutoff > 0.0 && a <= alphaCutoff)) a = 0.0;
		}
	}
	const f64 invW = 1.0 / pw;
	const f64 ndcX = px * invW;
	const f64 ndcY = py * invW;
	const f64 ndcZ = pz * invW;
	ctx.vx[outIndex] = (ndcX * 0.5 + 0.5) * static_cast<f64>(width);
	ctx.vy[outIndex] = (0.5 - ndcY * 0.5) * static_cast<f64>(height);
	ctx.vz[outIndex] = ndcZ * 0.5 + 0.5;
	ctx.vu[outIndex] = u;
	ctx.vv[outIndex] = v;
	ctx.vr[outIndex] = r;
	ctx.vg[outIndex] = g;
	ctx.vb[outIndex] = b;
	ctx.va[outIndex] = a;
}

u32 readIndex(const VdpRpuFrameOutput& frame, size_t drawIndex, u32 index) {
	const auto& commands = frame.commands;
	const u16 refIndex = commands.drawIndexBufferRef[drawIndex];
	if (refIndex == VDP_RPU_REF_NONE) {
		return index;
	}
	const auto& refs = frame.resources.bufferRefs;
	const u8* bytes = refs.bytes[refIndex];
	const u32 offset = refs.byteOffset[refIndex] + commands.drawIndexByteOffset[drawIndex] - refs.sourceByteOffset[refIndex] + index * (commands.drawIndexType[drawIndex] == VDP_RPU_INDEX_U16 ? 2u : 4u);
	return commands.drawIndexType[drawIndex] == VDP_RPU_INDEX_U16 ? readU16(bytes, offset) : readU32(bytes, offset);
}

size_t textureBinding(const VdpRpuFrameOutput& frame, size_t drawIndex) {
	const auto& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.textureSlot[bindingIndex] == 0u) return bindingIndex;
	}
	return bindingEnd;
}

size_t textureBinding1(const VdpRpuFrameOutput& frame, size_t drawIndex) {
	const auto& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.textureSlot[bindingIndex] == 1u) return bindingIndex;
	}
	return bindingEnd;
}

void sampleTexture(GameView& view, const VdpRpuFrameOutput& frame, size_t drawIndex, size_t bindingIndex, f64 u, f64 v) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const size_t bindingEnd = frame.commands.drawFirstTextureBinding[drawIndex] + frame.commands.drawTextureBindingCount[drawIndex];
	if (bindingIndex == bindingEnd) {
		ctx.attr[0] = 0.0; ctx.attr[1] = 0.0; ctx.attr[2] = 0.0; ctx.attr[3] = 0.0;
		return;
	}
	const u16 surfaceRef = frame.commands.textureSurfaceRef[bindingIndex];
	if (surfaceRef == VDP_RPU_REF_NONE) {
		ctx.attr[0] = 0.0; ctx.attr[1] = 0.0; ctx.attr[2] = 0.0; ctx.attr[3] = 0.0;
		return;
	}
	const u32 surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
	i32 width = 0;
	i32 height = 0;
	if (surfaceId < VDP_RD_SURFACE_COUNT) {
		const VdpSlotTexturePixels slot = view.vdpSlotTextures().readSurfaceTexturePixels(surfaceId);
		width = static_cast<i32>(slot.width);
		height = static_cast<i32>(slot.height);
		i32 sx = static_cast<i32>(u * static_cast<f64>(width));
		i32 sy = static_cast<i32>(v * static_cast<f64>(height));
		if (sx < 0) sx = 0;
		if (sy < 0) sy = 0;
		if (sx >= width) sx = width - 1;
		if (sy >= height) sy = height - 1;
		const size_t offset = static_cast<size_t>(sy) * slot.stride + static_cast<size_t>(sx) * 4u;
		const auto& srgbToLinear = srgbToLinearLut();
		ctx.attr[0] = static_cast<f64>(srgbToLinear[slot.pixels[offset]]) * (1.0 / 255.0);
		ctx.attr[1] = static_cast<f64>(srgbToLinear[slot.pixels[offset + 1u]]) * (1.0 / 255.0);
		ctx.attr[2] = static_cast<f64>(srgbToLinear[slot.pixels[offset + 2u]]) * (1.0 / 255.0);
		ctx.attr[3] = static_cast<f64>(slot.pixels[offset + 3u]) * (1.0 / 255.0);
		return;
	}
	syncSurfaceStorage(frame, surfaceRef);
	SoftwareRpuSurface& surface = g_rpuSoftware.surfaces[surfaceId];
	width = static_cast<i32>(surface.width);
	height = static_cast<i32>(surface.height);
	i32 sx = static_cast<i32>(u * static_cast<f64>(width));
	i32 sy = static_cast<i32>(v * static_cast<f64>(height));
	if (sx < 0) sx = 0;
	if (sy < 0) sy = 0;
	if (sx >= width) sx = width - 1;
	if (sy >= height) sy = height - 1;
	const u32 color = surface.pixels[static_cast<size_t>(sy) * static_cast<size_t>(width) + static_cast<size_t>(sx)];
	ctx.attr[0] = static_cast<f64>(colorByteR(color)) * (1.0 / 255.0);
	ctx.attr[1] = static_cast<f64>(colorByteG(color)) * (1.0 / 255.0);
	ctx.attr[2] = static_cast<f64>(colorByteB(color)) * (1.0 / 255.0);
	ctx.attr[3] = static_cast<f64>(colorByteA(color)) * (1.0 / 255.0);
}

void writePixel(SoftwareRpuTarget& target, i32 x, i32 y, f64 z, u32 pipelineWord, f64 r, f64 g, f64 b, f64 a) {
	if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
	const u8 srcR = floatByte(r);
	const u8 srcG = floatByte(g);
	const u8 srcB = floatByte(b);
	const u8 srcA = floatByte(a);
	if (srcA == 0u) return;
	const size_t pixelIndex = static_cast<size_t>(y) * static_cast<size_t>(target.width) + static_cast<size_t>(x);
	const u32 depthMode = (pipelineWord & VDP_RPU_PIPE_DEPTH_MASK) >> 4u;
	if (depthMode != VDP_RPU_DEPTH_NONE) {
		const f64 currentDepth = (*target.depth)[pixelIndex];
		if (depthMode == VDP_RPU_DEPTH_LESS) {
			if (z >= currentDepth) return;
		} else if (z > currentDepth) {
			return;
		}
		if ((pipelineWord & VDP_RPU_PIPE_DEPTH_WRITE) != 0u) {
			(*target.depth)[pixelIndex] = z;
		}
	}
	const u32 colorMask = (pipelineWord & VDP_RPU_PIPE_COLOR_WRITE_MASK) >> 16u;
	if (colorMask == 0u) return;
	const size_t targetIndex = static_cast<size_t>(y) * static_cast<size_t>(target.stride) + static_cast<size_t>(x);
	u32 dst = target.pixels[targetIndex];
	const u32 blend = pipelineWord & VDP_RPU_PIPE_BLEND_MASK;
	if (blend == VDP_RPU_BLEND_ALPHA) {
		const u32 invA = 255u - srcA;
		u8 outR = colorByteR(dst);
		u8 outG = colorByteG(dst);
		u8 outB = colorByteB(dst);
		u8 outA = colorByteA(dst);
		if ((colorMask & 1u) != 0u) outR = clampByte((static_cast<f64>(srcR) * srcA + static_cast<f64>(outR) * invA + 127.0) / 255.0);
		if ((colorMask & 2u) != 0u) outG = clampByte((static_cast<f64>(srcG) * srcA + static_cast<f64>(outG) * invA + 127.0) / 255.0);
		if ((colorMask & 4u) != 0u) outB = clampByte((static_cast<f64>(srcB) * srcA + static_cast<f64>(outB) * invA + 127.0) / 255.0);
		if ((colorMask & 8u) != 0u) outA = clampByte(static_cast<f64>(srcA) + (static_cast<f64>(outA) * invA + 127.0) / 255.0);
		target.pixels[targetIndex] = packArgb(outR, outG, outB, outA);
		return;
	}
	if (blend == VDP_RPU_BLEND_ADD) {
		u8 outR = colorByteR(dst);
		u8 outG = colorByteG(dst);
		u8 outB = colorByteB(dst);
		u8 outA = colorByteA(dst);
		if ((colorMask & 1u) != 0u) outR = clampByte(outR + (static_cast<f64>(srcR) * srcA + 127.0) / 255.0);
		if ((colorMask & 2u) != 0u) outG = clampByte(outG + (static_cast<f64>(srcG) * srcA + 127.0) / 255.0);
		if ((colorMask & 4u) != 0u) outB = clampByte(outB + (static_cast<f64>(srcB) * srcA + 127.0) / 255.0);
		if ((colorMask & 8u) != 0u) outA = clampByte(outA + srcA);
		target.pixels[targetIndex] = packArgb(outR, outG, outB, outA);
		return;
	}
	u8 outR = colorByteR(dst);
	u8 outG = colorByteG(dst);
	u8 outB = colorByteB(dst);
	u8 outA = colorByteA(dst);
	if ((colorMask & 1u) != 0u) outR = srcR;
	if ((colorMask & 2u) != 0u) outG = srcG;
	if ((colorMask & 4u) != 0u) outB = srcB;
	if ((colorMask & 8u) != 0u) outA = srcA;
	target.pixels[targetIndex] = packArgb(outR, outG, outB, outA);
}

void drawTriangle(GameView& view, const VdpRpuFrameOutput& frame, size_t drawIndex, SoftwareRpuTarget& target, size_t texture, size_t t1Texture) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const f64 x0 = ctx.vx[0]; const f64 y0 = ctx.vy[0];
	const f64 x1 = ctx.vx[1]; const f64 y1 = ctx.vy[1];
	const f64 x2 = ctx.vx[2]; const f64 y2 = ctx.vy[2];
	const f64 area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
	if (area == 0.0) return;
	i32 minX = rasterFloor(x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2));
	i32 maxX = rasterCeil(x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2));
	i32 minY = rasterFloor(y0 < y1 ? (y0 < y2 ? y0 : y2) : (y1 < y2 ? y1 : y2));
	i32 maxY = rasterCeil(y0 > y1 ? (y0 > y2 ? y0 : y2) : (y1 > y2 ? y1 : y2));
	if (minX < 0) minX = 0;
	if (minY < 0) minY = 0;
	if (maxX > target.width) maxX = target.width;
	if (maxY > target.height) maxY = target.height;
	const f64 invArea = 1.0 / area;
	const u32 pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	const size_t textureEnd = frame.commands.drawFirstTextureBinding[drawIndex] + frame.commands.drawTextureBindingCount[drawIndex];
	for (i32 y = minY; y < maxY; ++y) {
		const f64 py = static_cast<f64>(y) + 0.5;
		for (i32 x = minX; x < maxX; ++x) {
			const f64 px = static_cast<f64>(x) + 0.5;
			const f64 w0 = ((x1 - px) * (y2 - py) - (y1 - py) * (x2 - px)) * invArea;
			const f64 w1 = ((x2 - px) * (y0 - py) - (y2 - py) * (x0 - px)) * invArea;
			const f64 w2 = 1.0 - w0 - w1;
			if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) continue;
			f64 r = ctx.vr[0] * w0 + ctx.vr[1] * w1 + ctx.vr[2] * w2;
			f64 g = ctx.vg[0] * w0 + ctx.vg[1] * w1 + ctx.vg[2] * w2;
			f64 b = ctx.vb[0] * w0 + ctx.vb[1] * w1 + ctx.vb[2] * w2;
			f64 a = ctx.va[0] * w0 + ctx.va[1] * w1 + ctx.va[2] * w2;
			if (texture != textureEnd) {
				const f64 u = ctx.vu[0] * w0 + ctx.vu[1] * w1 + ctx.vu[2] * w2;
				const f64 v = ctx.vv[0] * w0 + ctx.vv[1] * w1 + ctx.vv[2] * w2;
				sampleTexture(view, frame, drawIndex, texture, u, v);
				r *= ctx.attr[0]; g *= ctx.attr[1]; b *= ctx.attr[2]; a *= ctx.attr[3];
			}
			if (t1Texture != textureEnd) {
				const f64 u = ctx.vu[0] * w0 + ctx.vu[1] * w1 + ctx.vu[2] * w2;
				const f64 v = ctx.vv[0] * w0 + ctx.vv[1] * w1 + ctx.vv[2] * w2;
				sampleTexture(view, frame, drawIndex, t1Texture, u, v);
				r *= ctx.attr[0]; g *= ctx.attr[1]; b *= ctx.attr[2]; a *= ctx.attr[3];
			}
			const f64 z = ctx.vz[0] * w0 + ctx.vz[1] * w1 + ctx.vz[2] * w2;
			writePixel(target, x, y, z, pipelineWord, r, g, b, a);
		}
	}
}

void drawLine(const VdpRpuFrameOutput& frame, size_t drawIndex, SoftwareRpuTarget& target) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	i32 x0 = rasterRound(ctx.vx[0]);
	i32 y0 = rasterRound(ctx.vy[0]);
	const i32 x1 = rasterRound(ctx.vx[1]);
	const i32 y1 = rasterRound(ctx.vy[1]);
	const i32 dx = x1 >= x0 ? x1 - x0 : x0 - x1;
	const i32 dy = y1 >= y0 ? y1 - y0 : y0 - y1;
	const i32 sx = x0 < x1 ? 1 : -1;
	const i32 sy = y0 < y1 ? 1 : -1;
	i32 err = dx - dy;
	const u32 pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	while (true) {
		writePixel(target, x0, y0, ctx.vz[0], pipelineWord, ctx.vr[0], ctx.vg[0], ctx.vb[0], ctx.va[0]);
		if (x0 == x1 && y0 == y1) return;
		const i32 e2 = err << 1;
		if (e2 > -dy) { err -= dy; x0 += sx; }
		if (e2 < dx) { err += dx; y0 += sy; }
	}
}

void drawPoint(const VdpRpuFrameOutput& frame, size_t drawIndex, SoftwareRpuTarget& target) {
	SoftwareRpuContext& ctx = g_rpuSoftware;
	const i32 cx = rasterRound(ctx.vx[0]);
	const i32 cy = rasterRound(ctx.vy[0]);
	const i32 half = SOFTWARE_RPU_POINT_SIZE >> 1;
	const u32 pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	for (i32 y = cy - half; y <= cy + half; ++y) {
		for (i32 x = cx - half; x <= cx + half; ++x) {
			writePixel(target, x, y, ctx.vz[0], pipelineWord, ctx.vr[0], ctx.vg[0], ctx.vb[0], ctx.va[0]);
		}
	}
}

void drawCommand(GameView& view, const VdpRpuFrameOutput& frame, size_t drawIndex, u32 vertexCount, u32 instanceCount, u32 indexCount, SoftwareRpuTarget& target) {
	const auto& commands = frame.commands;
	const u16 rawVariantWord = commands.drawShaderVariant[drawIndex];
	const VdpRpuShaderVariantSpec& shaderVariant = resolveVdpRpuShaderVariantSpec(rawVariantWord);
	const size_t textureEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	const size_t texture = shaderVariant.textureSlotCount == 0u ? textureEnd : textureBinding(frame, drawIndex);
	const size_t t1Texture = (rawVariantWord & VDP_RPU_SHADER_FLAG_T1) != 0u ? textureBinding1(frame, drawIndex) : textureEnd;
	const u32 primitive = commands.drawPrimitive[drawIndex];
	const u32 drawnInstanceCount = shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE ? 1u : instanceCount;
	const bool drawIndexed = commands.drawIndexType[drawIndex] != VDP_RPU_INDEX_NONE && commands.drawIndexBufferRef[drawIndex] != VDP_RPU_REF_NONE;
	for (u32 instanceIndex = 0; instanceIndex < drawnInstanceCount; ++instanceIndex) {
		if (primitive == VDP_RPU_PRIM_LINES) {
			const u32 count = drawIndexed ? indexCount : vertexCount;
			for (u32 vertex = 0; vertex + 1u < count; vertex += 2u) {
				const u32 v0 = drawIndexed ? readIndex(frame, drawIndex, vertex) : vertex;
				const u32 v1 = drawIndexed ? readIndex(frame, drawIndex, vertex + 1u) : vertex + 1u;
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0u, target.width, target.height);
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v1, instanceIndex, 1u, target.width, target.height);
				drawLine(frame, drawIndex, target);
			}
			continue;
		}
		if (primitive == VDP_RPU_PRIM_POINTS) {
			const u32 count = drawIndexed ? indexCount : vertexCount;
			for (u32 vertex = 0; vertex < count; ++vertex) {
				const u32 v0 = drawIndexed ? readIndex(frame, drawIndex, vertex) : vertex;
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0u, target.width, target.height);
				drawPoint(frame, drawIndex, target);
			}
			continue;
		}
		const u32 count = drawIndexed ? indexCount : vertexCount;
		const u32 triangleStep = primitive == VDP_RPU_PRIM_TRIANGLE_STRIP ? 1u : 3u;
		const u32 triangleLimit = primitive == VDP_RPU_PRIM_TRIANGLE_STRIP ? count - 2u : count;
		for (u32 vertex = 0; vertex < triangleLimit; vertex += triangleStep) {
			const u32 i0 = vertex;
			const u32 i1 = primitive == VDP_RPU_PRIM_TRIANGLE_STRIP && (vertex & 1u) != 0u ? vertex + 2u : vertex + 1u;
			const u32 i2 = primitive == VDP_RPU_PRIM_TRIANGLE_STRIP && (vertex & 1u) != 0u ? vertex + 1u : vertex + 2u;
			const u32 v0 = drawIndexed ? readIndex(frame, drawIndex, i0) : i0;
			const u32 v1 = drawIndexed ? readIndex(frame, drawIndex, i1) : i1;
			const u32 v2 = drawIndexed ? readIndex(frame, drawIndex, i2) : i2;
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0u, target.width, target.height);
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v1, instanceIndex, 1u, target.width, target.height);
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v2, instanceIndex, 2u, target.width, target.height);
			drawTriangle(view, frame, drawIndex, target, texture, t1Texture);
		}
	}
}

} // namespace

void renderVdpRpuSoftwareFrame(SoftwareBackend& backend, GameView& view, const VdpRpuFrameOutput& frame) {
	prepareDefaultDepth(backend.width(), backend.height());
	const auto& commands = frame.commands;
	for (size_t passIndex = 0; passIndex < commands.passCount; ++passIndex) {
		SoftwareRpuTarget target = passColorTarget(backend, frame, passIndex);
		target.depth = passDepthTarget(frame, passIndex);
		const u32 passOps = commands.passOps[passIndex];
		if ((passOps & VDP_RPU_PASS_COLOR_CLEAR) != 0u) {
			fillColorTarget(target, commands.passClearColor[passIndex]);
		}
		if ((passOps & VDP_RPU_PASS_DEPTH_CLEAR) != 0u) {
			std::fill(target.depth->begin(), target.depth->end(), static_cast<f64>(commands.passClearDepthWord[passIndex]) * (1.0 / 4294967295.0));
		} else if (passIndex == 0u) {
			std::fill(target.depth->begin(), target.depth->end(), SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH);
		}
		const size_t firstBatch = commands.passFirstBatch[passIndex];
		const size_t batchEnd = firstBatch + commands.passBatchCount[passIndex];
		for (size_t batchIndex = firstBatch; batchIndex < batchEnd; ++batchIndex) {
			drawCommand(
				view,
				frame,
				commands.batchFirstDraw[batchIndex],
				commands.batchVertexCount[batchIndex],
				commands.batchInstanceCount[batchIndex],
				commands.batchIndexCount[batchIndex],
				target
			);
		}
	}
}

void registerVdpRpuPassSoftware(RenderPassLibrary& registry) {
	GameView* const view = registry.view();
	RenderPassDef desc;
	desc.id = "vdp_rpu";
	desc.name = "VDPRPU";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor, RenderPassDef::RenderGraphSlot::FrameDepth };
	desc.writesDepth = true;
	desc.shouldExecute = [view]() {
		return view->vdpRpuFrame->commands.passCount != 0u;
	};
	desc.exec = [view](GPUBackend* backend, void*, std::any&) {
		renderVdpRpuSoftwareFrame(*static_cast<SoftwareBackend*>(backend), *view, *view->vdpRpuFrame);
	};
	registry.registerPass(desc);
}

} // namespace bmsx
