#include "render/backend/gles2/vdp_rpu.h"

#if BMSX_ENABLE_GLES2
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/rpu_desc.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gles2/backend.h"
#include "render/gameview.h"
#include "render/backend/gles2/shaders/vdp_rpu_shaders.h"

#include <GLES2/gl2.h>
#include <array>
#include <bit>
#include <cstdint>
#include <stdexcept>
#include <unordered_map>

namespace bmsx {
namespace {

using VdpRpuDrawArraysInstancedProc = void (*)(GLenum mode, GLint first, GLsizei count, GLsizei instanceCount);
using VdpRpuDrawElementsInstancedProc = void (*)(GLenum mode, GLsizei count, GLenum type, const void* indices, GLsizei instanceCount);
using VdpRpuVertexAttribDivisorProc = void (*)(GLuint index, GLuint divisor);

struct VdpRpuGLES2Runtime {
	OpenGLES2Backend* backend = nullptr;
	GLuint program = 0;
	GLuint neutralTexture = 0;
	GLint attribPosition = -1;
	GLint attribUv0 = -1;
	GLint attribColor = -1;
	GLint attribNormal = -1;
	GLint attribJoints = -1;
	GLint attribWeights = -1;
	GLint attribMorphPos = -1;
	GLint attribMorphNrm = -1;
	GLint attribInstance0 = -1;
	GLint attribInstance1 = -1;
	GLint attribInstance2 = -1;
	GLint attribInstance3 = -1;
	GLint attribInstanceColor = -1;
	GLint attribInstanceUvRect = -1;
	GLint uniformC0 = -1;
	GLint uniformNm = -1;
	GLint uniformC1 = -1;
	GLint uniformJoint = -1;
	GLint uniformT0 = -1;
	GLint uniformT1 = -1;
	GLint uniformTextureEnabled = -1;
	GLint uniformTextureFlipY = -1;
	GLint uniformT1Mode = -1;
	GLint uniformInstanceMode = -1;
	GLint uniformSkinningMode = -1;
	GLint uniformMorphMode = -1;
	GLint uniformNormalMode = -1;
	GLint uniformLightingMode = -1;
	VdpRpuDrawArraysInstancedProc drawArraysInstanced = nullptr;
	VdpRpuDrawElementsInstancedProc drawElementsInstanced = nullptr;
	VdpRpuVertexAttribDivisorProc vertexAttribDivisor = nullptr;
	std::array<u8, 4u> neutralTexturePixel{};
	std::array<f32, 16u> identityC0{};
	std::array<f32, 9u> identityNm{};
	std::array<f32, 16u> c0Floats{};
	std::array<f32, 9u> nmFloats{};
	std::array<f32, 68u> c1Floats{};
	std::array<f32, 384u> jointFloats{};
	std::array<f32, 68u> defaultC1Floats{};
	std::array<f32, 384u> defaultJointFloats{};
	u32 frameSerial = 0u;
};

struct VdpRpuGLESBuffer {
	GLuint buffer = 0u;
	u32 revision = 0u;
};

struct VdpRpuGLESSurface {
	u32 baseAddr = 0u;
	u32 pitchBytes = 0u;
	u32 width = 0u;
	u32 height = 0u;
	u8 format = 0u;
	u32 renderedFrame = 0u;
	u32 uploadedFrame = 0u;
	u32 sourceRevision = 0u;
	bool sourceUploaded = false;
	GLuint texture = 0u;
	GLuint depthBuffer = 0u;
	GLuint framebuffer = 0u;
};

VdpRpuGLES2Runtime g_vdpRpu{};
std::unordered_map<uint64_t, VdpRpuGLESBuffer> g_vdpRpuArrayBuffers{};
std::unordered_map<uint64_t, VdpRpuGLESBuffer> g_vdpRpuIndexBuffers{};
std::unordered_map<u32, VdpRpuGLESSurface> g_vdpRpuSurfaces{};

GLenum vdpRpuPrimitive(u32 primitive) {
	switch (primitive) {
		case VDP_RPU_PRIM_TRIANGLE_STRIP:
			return GL_TRIANGLE_STRIP;
		case VDP_RPU_PRIM_LINES:
			return GL_LINES;
		case VDP_RPU_PRIM_POINTS:
			return GL_POINTS;
		case VDP_RPU_PRIM_TRIANGLES:
		default:
			return GL_TRIANGLES;
	}
}

GLenum vdpRpuIndexType(u32 indexType) {
	return indexType == VDP_RPU_INDEX_U16 ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
}

void deleteVdpRpuSurfaceStorage(VdpRpuGLESSurface& surface) {
	if (surface.texture != 0u) {
		glDeleteTextures(1, &surface.texture);
		surface.texture = 0u;
	}
	if (surface.depthBuffer != 0u) {
		glDeleteRenderbuffers(1, &surface.depthBuffer);
		surface.depthBuffer = 0u;
	}
	if (surface.framebuffer != 0u) {
		glDeleteFramebuffers(1, &surface.framebuffer);
		surface.framebuffer = 0u;
	}
}

GLuint uploadVdpRpuBuffer(const VdpRpuFrameOutput& frame, GLenum target, u32 vramAddr, u32 byteLength) {
	auto& buffers = target == GL_ARRAY_BUFFER ? g_vdpRpuArrayBuffers : g_vdpRpuIndexBuffers;
	const uint64_t key = (static_cast<uint64_t>(vramAddr) << 32u) | static_cast<uint64_t>(byteLength);
	VdpRpuGLESBuffer& storage = buffers[key];
	const u32 revision = vdpRpuVramRangeRevision(frame, vramAddr, byteLength);
	if (storage.buffer == 0u) {
		glGenBuffers(1, &storage.buffer);
		glBindBuffer(target, storage.buffer);
		glBufferData(target, static_cast<GLsizeiptr>(byteLength), nullptr, GL_DYNAMIC_DRAW);
		glBufferSubData(target, 0, static_cast<GLsizeiptr>(byteLength), frame.vdpVram.get().data() + vramAddr);
		storage.revision = revision;
		return storage.buffer;
	}
	glBindBuffer(target, storage.buffer);
	if (storage.revision != revision) {
		glBufferSubData(target, 0, static_cast<GLsizeiptr>(byteLength), frame.vdpVram.get().data() + vramAddr);
		storage.revision = revision;
	}
	return storage.buffer;
}

void configureNearestClampTexture2D() {
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

VdpRpuGLESSurface& loadVdpRpuSurfaceStorage(const VdpRpuFrameOutput& frame, u32 surfaceDescAddr) {
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	VdpRpuGLESSurface& surface = g_vdpRpuSurfaces[surfaceDescAddr];
	const u8* vram = frame.vdpVram.get().data();
	const u32 baseAddr = readRpuDescU32(vram, surfaceDescAddr + RPU_SURFACE_DESC_BASE_ADDR_OFFSET);
	const u32 pitchBytes = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_PITCH_BYTES_OFFSET);
	const u32 width = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_WIDTH_OFFSET);
	const u32 height = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_HEIGHT_OFFSET);
	const u8 format = vram[surfaceDescAddr + RPU_SURFACE_DESC_FORMAT_OFFSET];
	if ((surface.texture != 0u || surface.depthBuffer != 0u)
		&& surface.baseAddr == baseAddr
		&& surface.pitchBytes == pitchBytes
		&& surface.width == width
		&& surface.height == height
		&& surface.format == format) {
		return surface;
	}
	deleteVdpRpuSurfaceStorage(surface);
	backend.setActiveTextureUnit(0);
	if (format == VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		glGenRenderbuffers(1, &surface.depthBuffer);
		glBindRenderbuffer(GL_RENDERBUFFER, surface.depthBuffer);
		glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, static_cast<GLsizei>(width), static_cast<GLsizei>(height));
	} else {
		glGenTextures(1, &surface.texture);
		glBindTexture(GL_TEXTURE_2D, surface.texture);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, static_cast<GLsizei>(width), static_cast<GLsizei>(height), 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
		configureNearestClampTexture2D();
	}
	backend.invalidateTextureBindingCache();
	glGenFramebuffers(1, &surface.framebuffer);
	surface.baseAddr = baseAddr;
	surface.pitchBytes = pitchBytes;
	surface.width = width;
	surface.height = height;
	surface.format = format;
	surface.renderedFrame = 0u;
	surface.uploadedFrame = 0u;
	surface.sourceRevision = 0u;
	surface.sourceUploaded = false;
	return surface;
}

void uploadVdpRpuTextureSurface(const VdpRpuFrameOutput& frame, VdpRpuGLESSurface& surface) {
	if (surface.renderedFrame == g_vdpRpu.frameSerial || surface.uploadedFrame == g_vdpRpu.frameSerial || surface.format == VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		return;
	}
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	const u32 sourceByteLength = (surface.height - 1u) * surface.pitchBytes + surface.width * 4u;
	const u32 sourceRevision = vdpRpuVramRangeRevision(frame, surface.baseAddr, sourceByteLength);
	if (surface.sourceUploaded && surface.sourceRevision == sourceRevision) {
		return;
	}
	backend.setActiveTextureUnit(0);
	glBindTexture(GL_TEXTURE_2D, surface.texture);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
	const u8* base = frame.vdpVram.get().data() + surface.baseAddr;
	const u32 rowBytes = surface.width * 4u;
	if (surface.pitchBytes == rowBytes) {
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, static_cast<GLsizei>(surface.width), static_cast<GLsizei>(surface.height), GL_RGBA, GL_UNSIGNED_BYTE, base);
	} else {
		for (u32 y = 0u; y < surface.height; ++y) {
			glTexSubImage2D(GL_TEXTURE_2D, 0, 0, static_cast<GLint>(y), static_cast<GLsizei>(surface.width), 1, GL_RGBA, GL_UNSIGNED_BYTE, base + y * surface.pitchBytes);
		}
	}
	backend.invalidateTextureBindingCache();
	surface.uploadedFrame = g_vdpRpu.frameSerial;
	surface.sourceRevision = sourceRevision;
	surface.sourceUploaded = true;
}

i32 bindVdpRpuPassFramebuffer(const VdpRpuFrameOutput& frame, size_t passIndex, void* framebuffer, i32 width, i32 height) {
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	const VdpRpuCommandBuffer& commands = frame.commands;
	const u32 colorSurfaceDescAddr = commands.passColorSurfaceDescAddr[passIndex];
	const u32 depthSurfaceDescAddr = commands.passDepthSurfaceDescAddr[passIndex];
	if (colorSurfaceDescAddr == 0u && depthSurfaceDescAddr == 0u) {
		backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), width, height);
		return height;
	}
	VdpRpuGLESSurface& targetSurface = colorSurfaceDescAddr != 0u
		? loadVdpRpuSurfaceStorage(frame, colorSurfaceDescAddr)
		: loadVdpRpuSurfaceStorage(frame, depthSurfaceDescAddr);
	backend.setRenderTarget(targetSurface.framebuffer, static_cast<i32>(targetSurface.width), static_cast<i32>(targetSurface.height));
	if (colorSurfaceDescAddr != 0u) {
		VdpRpuGLESSurface& colorSurface = loadVdpRpuSurfaceStorage(frame, colorSurfaceDescAddr);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorSurface.texture, 0);
		colorSurface.renderedFrame = g_vdpRpu.frameSerial;
		colorSurface.sourceUploaded = false;
	} else {
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, 0u, 0);
	}
	if (depthSurfaceDescAddr != 0u) {
		VdpRpuGLESSurface& depthSurface = loadVdpRpuSurfaceStorage(frame, depthSurfaceDescAddr);
		glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depthSurface.depthBuffer);
		depthSurface.renderedFrame = g_vdpRpu.frameSerial;
		depthSurface.sourceUploaded = false;
	} else {
		glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, 0u);
	}
	return static_cast<i32>(targetSurface.height);
}

void setVdpRpuPipelineState(u32 pipelineWord) {
	const u32 blend = pipelineWord & VDP_RPU_PIPE_BLEND_MASK;
	if (blend == VDP_RPU_BLEND_NONE) {
		glDisable(GL_BLEND);
	} else {
		glEnable(GL_BLEND);
		if (blend == VDP_RPU_BLEND_ADD) {
			glBlendFunc(GL_SRC_ALPHA, GL_ONE);
		} else if (blend == VDP_RPU_BLEND_ALPHA) {
			glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		} else {
			glBlendFunc(GL_ONE, GL_ZERO);
		}
	}

	const u32 depth = (pipelineWord & VDP_RPU_PIPE_DEPTH_MASK) >> 4u;
	if (depth == VDP_RPU_DEPTH_NONE) {
		glDisable(GL_DEPTH_TEST);
	} else {
		glEnable(GL_DEPTH_TEST);
		glDepthFunc(depth == VDP_RPU_DEPTH_LESS ? GL_LESS : GL_LEQUAL);
	}
	glDepthMask((pipelineWord & VDP_RPU_PIPE_DEPTH_WRITE) != 0u ? GL_TRUE : GL_FALSE);

	const u32 cull = (pipelineWord & VDP_RPU_PIPE_CULL_MASK) >> 8u;
	if (cull == VDP_RPU_CULL_NONE) {
		glDisable(GL_CULL_FACE);
	} else {
		glEnable(GL_CULL_FACE);
		glCullFace(cull == VDP_RPU_CULL_FRONT ? GL_FRONT : GL_BACK);
	}

	const u32 colorMask = (pipelineWord & VDP_RPU_PIPE_COLOR_WRITE_MASK) >> 16u;
	glColorMask((colorMask & 1u) != 0u ? GL_TRUE : GL_FALSE,
		(colorMask & 2u) != 0u ? GL_TRUE : GL_FALSE,
		(colorMask & 4u) != 0u ? GL_TRUE : GL_FALSE,
		(colorMask & 8u) != 0u ? GL_TRUE : GL_FALSE);
}

GLint vdpRpuAttributeLocation(u32 attribute) {
	const auto& runtime = g_vdpRpu;
	switch (attribute) {
		case VDP_RPU_ATTR_UV0:
			return runtime.attribUv0;
		case VDP_RPU_ATTR_COLOR:
			return runtime.attribColor;
		case VDP_RPU_ATTR_NORMAL:
			return runtime.attribNormal;
		case VDP_RPU_ATTR_JOINTS:
			return runtime.attribJoints;
		case VDP_RPU_ATTR_WEIGHTS:
			return runtime.attribWeights;
		case VDP_RPU_ATTR_MORPH_POS:
			return runtime.attribMorphPos;
		case VDP_RPU_ATTR_MORPH_NRM:
			return runtime.attribMorphNrm;
		case VDP_RPU_ATTR_INSTANCE0:
			return runtime.attribInstance0;
		case VDP_RPU_ATTR_INSTANCE1:
			return runtime.attribInstance1;
		case VDP_RPU_ATTR_INSTANCE2:
			return runtime.attribInstance2;
		case VDP_RPU_ATTR_INSTANCE3:
			return runtime.attribInstance3;
		case VDP_RPU_ATTR_INSTANCE_COLOR:
			return runtime.attribInstanceColor;
		case VDP_RPU_ATTR_INSTANCE_UVRECT:
			return runtime.attribInstanceUvRect;
		case VDP_RPU_ATTR_POS:
		default:
			return runtime.attribPosition;
	}
}

GLenum vdpRpuAttributeType(u32 componentType) {
	switch (componentType) {
		case VDP_RPU_ATTR_U8:
		case VDP_RPU_ATTR_U8N:
			return GL_UNSIGNED_BYTE;
		case VDP_RPU_ATTR_S16N:
			return GL_SHORT;
		case VDP_RPU_ATTR_F32:
		default:
			return GL_FLOAT;
	}
}

void bindVdpRpuStreamAttribute(const VdpRpuStreamAttributeSpec& attribute, u32 byteStride, u32 byteOffsetBase, u32 divisor) {
	const auto& runtime = g_vdpRpu;
	const GLint location = vdpRpuAttributeLocation(attribute.attribute);
	glEnableVertexAttribArray(static_cast<GLuint>(location));
	glVertexAttribPointer(
		location,
		static_cast<GLint>(attribute.componentCount),
		vdpRpuAttributeType(attribute.componentType),
		attribute.normalized != 0u ? GL_TRUE : GL_FALSE,
		static_cast<GLsizei>(byteStride),
		reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffsetBase + attribute.byteOffset))
	);
	runtime.vertexAttribDivisor(static_cast<GLuint>(location), divisor);
}

void setVdpRpuDefaultVertexAttributes() {
	const auto& runtime = g_vdpRpu;
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribPosition));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribPosition), 0.0f, 0.0f, 0.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribPosition), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribUv0));
	glVertexAttrib2f(static_cast<GLuint>(runtime.attribUv0), 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribUv0), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribColor));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribColor), 1.0f, 1.0f, 1.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribColor), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribNormal));
	glVertexAttrib3f(static_cast<GLuint>(runtime.attribNormal), 0.0f, 0.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribNormal), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribJoints));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribJoints), 0.0f, 0.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribJoints), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribWeights));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribWeights), 1.0f, 0.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribWeights), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribMorphPos));
	glVertexAttrib3f(static_cast<GLuint>(runtime.attribMorphPos), 0.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribMorphPos), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribMorphNrm));
	glVertexAttrib3f(static_cast<GLuint>(runtime.attribMorphNrm), 0.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribMorphNrm), 0u);
}

void setVdpRpuDefaultInstanceAttributes() {
	const auto& runtime = g_vdpRpu;
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstance0));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstance0), 1.0f, 0.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstance0), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstance1));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstance1), 0.0f, 1.0f, 0.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstance1), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstance2));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstance2), 0.0f, 0.0f, 1.0f, 0.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstance2), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstance3));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstance3), 0.0f, 0.0f, 0.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstance3), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstanceColor));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstanceColor), 1.0f, 1.0f, 1.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstanceColor), 0u);
	glDisableVertexAttribArray(static_cast<GLuint>(runtime.attribInstanceUvRect));
	glVertexAttrib4f(static_cast<GLuint>(runtime.attribInstanceUvRect), 0.0f, 0.0f, 1.0f, 1.0f);
	runtime.vertexAttribDivisor(static_cast<GLuint>(runtime.attribInstanceUvRect), 0u);
}

void bindVdpRpuStreamBinding(const VdpRpuFrameOutput& frame, size_t streamBindingIndex, u32 divisor) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const VdpRpuStreamLayoutSpec& layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	uploadVdpRpuBuffer(frame, GL_ARRAY_BUFFER, commands.streamVramAddr[streamBindingIndex], commands.streamByteLength[streamBindingIndex]);
	for (size_t index = 0u; index < layout.attributeCount; ++index) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, 0u, divisor);
	}
}

bool findVdpRpuConstantBindingAddress(const VdpRpuCommandBuffer& commands, size_t drawIndex, u32 constantSlot, u32& constantByteAddr) {
	const size_t bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.constantBindingSlot[bindingIndex] == constantSlot) {
			constantByteAddr = commands.constantVramAddr[bindingIndex];
			return true;
		}
	}
	return false;
}

void readVdpRpuFloatWords(const u8* vram, u32 byteAddr, f32* out, size_t wordOffset, size_t count) {
	for (size_t index = 0u; index < count; ++index) {
		out[index] = std::bit_cast<f32>(readRpuDescU32(vram, byteAddr + static_cast<u32>((wordOffset + index) * 4u)));
	}
}

void bindVdpRpuDrawStreams(const VdpRpuFrameOutput& frame, size_t drawIndex, u32 instanceMode) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstStreamBinding[drawIndex] + commands.drawStreamBindingCount[drawIndex];
	size_t vertexBinding = bindingEnd;
	size_t instanceBinding = bindingEnd;
	size_t morphBinding = bindingEnd;
	for (size_t bindingIndex = commands.drawFirstStreamBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		const u32 streamSlot = commands.streamSlot[bindingIndex];
		if (streamSlot == 0u) {
			vertexBinding = bindingIndex;
		} else if (streamSlot == 1u) {
			instanceBinding = bindingIndex;
		} else if (streamSlot == 2u) {
			morphBinding = bindingIndex;
		}
	}
	if (vertexBinding != bindingEnd) {
		bindVdpRpuStreamBinding(frame, vertexBinding, 0u);
	}
	if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE && instanceBinding != bindingEnd) {
		bindVdpRpuStreamBinding(frame, instanceBinding, commands.streamStepRate[instanceBinding]);
	}
	if (morphBinding != bindingEnd) {
		bindVdpRpuStreamBinding(frame, morphBinding, 0u);
	}
}

void setVdpRpuC0Constants(const VdpRpuFrameOutput& frame, size_t drawIndex, u32 normalMode) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	u32 constantByteAddr;
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, 0u, constantByteAddr)) {
		const u8* vram = frame.vdpVram.get().data();
		readVdpRpuFloatWords(vram, constantByteAddr, runtime.c0Floats.data(), 0u, 16u);
		glUniformMatrix4fv(runtime.uniformC0, 1, GL_FALSE, runtime.c0Floats.data());
		if (normalMode != 0u) {
			readVdpRpuFloatWords(vram, constantByteAddr, runtime.nmFloats.data(), 16u, 9u);
			glUniformMatrix3fv(runtime.uniformNm, 1, GL_FALSE, runtime.nmFloats.data());
		}
		return;
	}
	glUniformMatrix4fv(runtime.uniformC0, 1, GL_FALSE, runtime.identityC0.data());
	if (normalMode != 0u) {
		glUniformMatrix3fv(runtime.uniformNm, 1, GL_FALSE, runtime.identityNm.data());
	}
}

void setVdpRpuC1Constants(const VdpRpuFrameOutput& frame, size_t drawIndex, const VdpRpuShaderVariantSpec& shaderVariant) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	const u32 constantSlot = shaderVariant.lightingConstantSlot;
	if (constantSlot == VDP_RPU_RESOURCE_NONE) {
		glUniform1i(runtime.uniformLightingMode, 0);
		glUniform4fv(runtime.uniformC1, 17, runtime.defaultC1Floats.data());
		return;
	}
	glUniform1i(runtime.uniformLightingMode, 1);
	u32 constantByteAddr;
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, constantSlot, constantByteAddr)) {
		readVdpRpuFloatWords(frame.vdpVram.get().data(), constantByteAddr, runtime.c1Floats.data(), 0u, 68u);
		glUniform4fv(runtime.uniformC1, 17, runtime.c1Floats.data());
		return;
	}
	glUniform4fv(runtime.uniformC1, 17, runtime.defaultC1Floats.data());
}

void setVdpRpuJointConstants(const VdpRpuFrameOutput& frame, size_t drawIndex, const VdpRpuShaderVariantSpec& shaderVariant) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	const u32 constantSlot = shaderVariant.jointConstantSlot;
	if (constantSlot == VDP_RPU_RESOURCE_NONE) {
		glUniform1i(runtime.uniformSkinningMode, 0);
		glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.defaultJointFloats.data());
		return;
	}
	glUniform1i(runtime.uniformSkinningMode, 1);
	u32 constantByteAddr;
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, constantSlot, constantByteAddr)) {
		readVdpRpuFloatWords(frame.vdpVram.get().data(), constantByteAddr, runtime.jointFloats.data(), 0u, 384u);
		glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.jointFloats.data());
		return;
	}
	glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.defaultJointFloats.data());
}

void bindVdpRpuNeutralTexture() {
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	backend.setActiveTextureUnit(0);
	glBindTexture(GL_TEXTURE_2D, g_vdpRpu.neutralTexture);
	glUniform1i(g_vdpRpu.uniformTextureFlipY, 0);
	backend.invalidateTextureBindingCache();
}

void bindVdpRpuTextureBindings(const VdpRpuFrameOutput& frame, size_t drawIndex, const VdpRpuShaderVariantSpec& shaderVariant, u32 rawVariantWord) {
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	const bool t1Flag = (rawVariantWord & VDP_RPU_SHADER_FLAG_T1) != 0u;
	if (shaderVariant.textureSlotCount == 0u) {
		bindVdpRpuNeutralTexture();
		glUniform1i(g_vdpRpu.uniformTextureEnabled, 0);
		glUniform1i(g_vdpRpu.uniformT1Mode, 0);
		return;
	}
	glUniform1i(g_vdpRpu.uniformTextureEnabled, 1);
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	bool foundT0 = false;
	bool foundT1 = false;
	for (size_t bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		const u32 slot = commands.textureSlot[bindingIndex];
		if (slot == 0u && !foundT0) {
			foundT0 = true;
			const u32 surfaceDescAddr = commands.textureSurfaceDescAddr[bindingIndex];
			if (surfaceDescAddr == 0u) {
				bindVdpRpuNeutralTexture();
				glUniform1i(g_vdpRpu.uniformT0, 0);
			} else {
				VdpRpuGLESSurface& surface = loadVdpRpuSurfaceStorage(frame, surfaceDescAddr);
				uploadVdpRpuTextureSurface(frame, surface);
				backend.setActiveTextureUnit(0);
				glBindTexture(GL_TEXTURE_2D, surface.texture);
				glUniform1i(g_vdpRpu.uniformTextureFlipY, surface.renderedFrame == g_vdpRpu.frameSerial ? 1 : 0);
				glUniform1i(g_vdpRpu.uniformT0, 0);
			}
		} else if (slot == 1u && t1Flag && !foundT1) {
			foundT1 = true;
			const u32 surfaceDescAddr = commands.textureSurfaceDescAddr[bindingIndex];
			if (surfaceDescAddr != 0u) {
				VdpRpuGLESSurface& surface = loadVdpRpuSurfaceStorage(frame, surfaceDescAddr);
				uploadVdpRpuTextureSurface(frame, surface);
				backend.setActiveTextureUnit(1);
				glBindTexture(GL_TEXTURE_2D, surface.texture);
				glUniform1i(g_vdpRpu.uniformT1, 1);
				glUniform1i(g_vdpRpu.uniformT1Mode, 1);
			}
		}
	}
	if (!foundT0) {
		bindVdpRpuNeutralTexture();
		glUniform1i(g_vdpRpu.uniformTextureEnabled, 0);
	}
	if (!foundT1 || !t1Flag) {
		glUniform1i(g_vdpRpu.uniformT1Mode, 0);
	}
}

void drawVdpRpuCommand(const VdpRpuFrameOutput& frame, size_t drawIndex, u32 vertexCount, u32 instanceCount, u32 indexCount) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	setVdpRpuPipelineState(commands.drawPipelineWord[drawIndex]);
	const u32 rawVariantWord = commands.drawShaderVariant[drawIndex];
	const VdpRpuShaderVariantSpec& shaderVariant = resolveVdpRpuShaderVariantSpec(rawVariantWord);
	const u32 instanceMode = shaderVariant.instanceMode;
	const u32 morphMode = (rawVariantWord & VDP_RPU_SHADER_FLAG_MORPH) != 0u ? 1u : 0u;
	const u32 normalMode = shaderVariant.lightingConstantSlot != VDP_RPU_RESOURCE_NONE ? 1u : 0u;
	glUniform1i(g_vdpRpu.uniformInstanceMode, static_cast<GLint>(instanceMode));
	glUniform1i(g_vdpRpu.uniformMorphMode, static_cast<GLint>(morphMode));
	glUniform1i(g_vdpRpu.uniformNormalMode, static_cast<GLint>(normalMode));
	setVdpRpuDefaultVertexAttributes();
	setVdpRpuDefaultInstanceAttributes();
	bindVdpRpuTextureBindings(frame, drawIndex, shaderVariant, rawVariantWord);
	if (shaderVariant.usesC0 != 0u) {
		setVdpRpuC0Constants(frame, drawIndex, normalMode);
	} else {
		glUniformMatrix4fv(g_vdpRpu.uniformC0, 1, GL_FALSE, g_vdpRpu.identityC0.data());
		if (normalMode != 0u) {
			glUniformMatrix3fv(g_vdpRpu.uniformNm, 1, GL_FALSE, g_vdpRpu.identityNm.data());
		}
	}
	setVdpRpuC1Constants(frame, drawIndex, shaderVariant);
	setVdpRpuJointConstants(frame, drawIndex, shaderVariant);
	bindVdpRpuDrawStreams(frame, drawIndex, instanceMode);
	const GLenum primitive = vdpRpuPrimitive(commands.drawPrimitive[drawIndex]);
	const u32 indexType = commands.drawIndexType[drawIndex];
	const u32 indexVramAddr = commands.drawIndexVramAddr[drawIndex];
	if (indexType == VDP_RPU_INDEX_NONE || indexVramAddr == 0u) {
		if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE) {
			g_vdpRpu.drawArraysInstanced(primitive, 0, static_cast<GLsizei>(vertexCount), static_cast<GLsizei>(instanceCount));
			return;
		}
		glDrawArrays(primitive, 0, static_cast<GLsizei>(vertexCount));
		return;
	}
	const u32 indexByteLength = indexCount * (indexType == VDP_RPU_INDEX_U16 ? 2u : 4u);
	uploadVdpRpuBuffer(frame, GL_ELEMENT_ARRAY_BUFFER, indexVramAddr, indexByteLength);
	const void* indexByteOffset = reinterpret_cast<const void*>(static_cast<uintptr_t>(0u));
	if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE) {
		g_vdpRpu.drawElementsInstanced(primitive, static_cast<GLsizei>(indexCount), vdpRpuIndexType(indexType), indexByteOffset, static_cast<GLsizei>(instanceCount));
		return;
	}
	glDrawElements(primitive, static_cast<GLsizei>(indexCount), vdpRpuIndexType(indexType), indexByteOffset);
}

void setupVdpRpuLocations();

void initVdpRpuPipeline(OpenGLES2Backend& backend) {
	g_vdpRpu.backend = &backend;
	g_vdpRpu.program = backend.buildProgram(kVdpRpuVertexShader, kVdpRpuFragmentShader, "vdp_rpu");
	glGenTextures(1, &g_vdpRpu.neutralTexture);
	glBindTexture(GL_TEXTURE_2D, g_vdpRpu.neutralTexture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_vdpRpu.neutralTexturePixel.data());
	configureNearestClampTexture2D();
	glBindTexture(GL_TEXTURE_2D, 0u);
	backend.invalidateTextureBindingCache();
	setupVdpRpuLocations();
}

void setupVdpRpuLocations() {
	auto& runtime = g_vdpRpu;
	OpenGLES2Backend& backend = *runtime.backend;
	runtime.attribPosition = glGetAttribLocation(runtime.program, "a_position");
	runtime.attribUv0 = glGetAttribLocation(runtime.program, "a_uv0");
	runtime.attribColor = glGetAttribLocation(runtime.program, "a_color");
	runtime.attribNormal = glGetAttribLocation(runtime.program, "a_normal");
	runtime.attribJoints = glGetAttribLocation(runtime.program, "a_joints");
	runtime.attribWeights = glGetAttribLocation(runtime.program, "a_weights");
	runtime.attribMorphPos = glGetAttribLocation(runtime.program, "a_morph_pos");
	runtime.attribMorphNrm = glGetAttribLocation(runtime.program, "a_morph_nrm");
	runtime.attribInstance0 = glGetAttribLocation(runtime.program, "a_instance0");
	runtime.attribInstance1 = glGetAttribLocation(runtime.program, "a_instance1");
	runtime.attribInstance2 = glGetAttribLocation(runtime.program, "a_instance2");
	runtime.attribInstance3 = glGetAttribLocation(runtime.program, "a_instance3");
	runtime.attribInstanceColor = glGetAttribLocation(runtime.program, "a_instance_color");
	runtime.attribInstanceUvRect = glGetAttribLocation(runtime.program, "a_instance_uvrect");
	runtime.uniformC0 = glGetUniformLocation(runtime.program, "u_c0");
	runtime.uniformNm = glGetUniformLocation(runtime.program, "u_nm");
	runtime.uniformC1 = glGetUniformLocation(runtime.program, "u_c1[0]");
	runtime.uniformJoint = glGetUniformLocation(runtime.program, "u_joint[0]");
	runtime.uniformT0 = glGetUniformLocation(runtime.program, "u_t0");
	runtime.uniformT1 = glGetUniformLocation(runtime.program, "u_t1");
	runtime.uniformTextureEnabled = glGetUniformLocation(runtime.program, "u_textureEnabled");
	runtime.uniformTextureFlipY = glGetUniformLocation(runtime.program, "u_textureFlipY");
	runtime.uniformT1Mode = glGetUniformLocation(runtime.program, "u_t1Mode");
	runtime.uniformInstanceMode = glGetUniformLocation(runtime.program, "u_instanceMode");
	runtime.uniformSkinningMode = glGetUniformLocation(runtime.program, "u_skinningMode");
	runtime.uniformMorphMode = glGetUniformLocation(runtime.program, "u_morphMode");
	runtime.uniformNormalMode = glGetUniformLocation(runtime.program, "u_normalMode");
	runtime.uniformLightingMode = glGetUniformLocation(runtime.program, "u_lightingMode");
	void* drawArraysInstancedProc = backend.resolveProcAddress("glDrawArraysInstanced", "glDrawArraysInstancedANGLE", "glDrawArraysInstancedEXT");
	void* drawElementsInstancedProc = backend.resolveProcAddress("glDrawElementsInstanced", "glDrawElementsInstancedANGLE", "glDrawElementsInstancedEXT");
	void* vertexAttribDivisorProc = backend.resolveProcAddress("glVertexAttribDivisor", "glVertexAttribDivisorANGLE", "glVertexAttribDivisorEXT");
	runtime.drawArraysInstanced = reinterpret_cast<VdpRpuDrawArraysInstancedProc>(drawArraysInstancedProc);
	runtime.drawElementsInstanced = reinterpret_cast<VdpRpuDrawElementsInstancedProc>(drawElementsInstancedProc);
	runtime.vertexAttribDivisor = reinterpret_cast<VdpRpuVertexAttribDivisorProc>(vertexAttribDivisorProc);
	if (!runtime.drawArraysInstanced || !runtime.drawElementsInstanced || !runtime.vertexAttribDivisor) {
		throw std::runtime_error("[VDPRPU] GLES2 instanced arrays entrypoints are unavailable.");
	}
	if (!backend.supportsUintIndices()) {
		throw std::runtime_error("[VDPRPU] GLES2 uint index support is unavailable.");
	}
	runtime.identityC0[0] = 1.0f;
	runtime.identityC0[5] = 1.0f;
	runtime.identityC0[10] = 1.0f;
	runtime.identityC0[15] = 1.0f;
	runtime.identityNm[0] = 1.0f;
	runtime.identityNm[4] = 1.0f;
	runtime.identityNm[8] = 1.0f;
	// Default C1: white ambient (intensity 1.0), all lights disabled
	runtime.defaultC1Floats[0] = 1.0f; // ambient.r
	runtime.defaultC1Floats[1] = 1.0f; // ambient.g
	runtime.defaultC1Floats[2] = 1.0f; // ambient.b
	runtime.defaultC1Floats[3] = 1.0f; // ambient.intensity
	for (size_t jointIndex = 0u; jointIndex < 24u; ++jointIndex) {
		const size_t base = jointIndex * 16u;
		runtime.defaultJointFloats[base] = 1.0f;
		runtime.defaultJointFloats[base + 5u] = 1.0f;
		runtime.defaultJointFloats[base + 10u] = 1.0f;
		runtime.defaultJointFloats[base + 15u] = 1.0f;
	}
	glUseProgram(runtime.program);
	glUniformMatrix4fv(runtime.uniformC0, 1, GL_FALSE, runtime.identityC0.data());
	glUniformMatrix3fv(runtime.uniformNm, 1, GL_FALSE, runtime.identityNm.data());
	glUniform4fv(runtime.uniformC1, 17, runtime.defaultC1Floats.data());
	glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.defaultJointFloats.data());
	glUniform1i(runtime.uniformT0, 0);
	glUniform1i(runtime.uniformT1, 1);
	glUniform1i(runtime.uniformTextureEnabled, 0);
	glUniform1i(runtime.uniformTextureFlipY, 0);
	glUniform1i(runtime.uniformT1Mode, 0);
	glUniform1i(runtime.uniformInstanceMode, static_cast<GLint>(VDP_RPU_INSTANCE_MODE_NONE));
	glUniform1i(runtime.uniformSkinningMode, 0);
	glUniform1i(runtime.uniformMorphMode, 0);
	glUniform1i(runtime.uniformNormalMode, 0);
	glUniform1i(runtime.uniformLightingMode, 0);
}

void renderVdpRpuFrame(void* framebuffer, const VdpRpuPipelineState& state) {
	OpenGLES2Backend& backend = *g_vdpRpu.backend;
	glUseProgram(g_vdpRpu.program);
	const VdpRpuFrameOutput& frame = *state.frame;
	const VdpRpuCommandBuffer& commands = frame.commands;
	g_vdpRpu.frameSerial += 1u;
	for (size_t passIndex = 0u; passIndex < commands.passCount; ++passIndex) {
		const i32 targetHeight = bindVdpRpuPassFramebuffer(frame, passIndex, framebuffer, state.width, state.height);
		const u32 viewportXY = commands.passViewportXY[passIndex];
		const u32 viewportWH = commands.passViewportWH[passIndex];
		const i32 viewportY = static_cast<i32>(viewportXY >> 16u);
		const i32 viewportHeight = static_cast<i32>(viewportWH >> 16u);
		glViewport(
			static_cast<GLint>(viewportXY & 0xffffu),
			static_cast<GLint>(targetHeight - viewportY - viewportHeight),
			static_cast<GLsizei>(viewportWH & 0xffffu),
			static_cast<GLsizei>(viewportHeight)
		);
		GLbitfield clearMask = 0u;
		const u32 passOps = commands.passOps[passIndex];
		if ((passOps & VDP_RPU_PASS_COLOR_CLEAR) != 0u) {
			const u32 color = commands.passClearColor[passIndex];
			glClearColor(
				static_cast<f32>((color >> 16u) & 0xffu) / 255.0f,
				static_cast<f32>((color >> 8u) & 0xffu) / 255.0f,
				static_cast<f32>(color & 0xffu) / 255.0f,
				static_cast<f32>((color >> 24u) & 0xffu) / 255.0f
			);
			clearMask |= GL_COLOR_BUFFER_BIT;
		}
		if ((passOps & VDP_RPU_PASS_DEPTH_CLEAR) != 0u) {
			glClearDepthf(static_cast<f32>(commands.passClearDepthWord[passIndex]) * (1.0f / 4294967295.0f));
			clearMask |= GL_DEPTH_BUFFER_BIT;
		}
		if (clearMask != 0u) {
			glClear(clearMask);
		}
		const size_t firstDraw = commands.passFirstDraw[passIndex];
		const size_t drawEnd = firstDraw + commands.passDrawCount[passIndex];
		for (size_t drawIndex = firstDraw; drawIndex < drawEnd; ++drawIndex) {
			drawVdpRpuCommand(
				frame,
				drawIndex,
				commands.drawVertexCount[drawIndex],
				commands.drawInstanceCount[drawIndex],
				commands.drawIndexCount[drawIndex]
			);
		}
	}
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glDepthMask(GL_TRUE);
	backend.invalidateTextureBindingCache();
}

constexpr auto bootstrapVdpRpuPass = [](GPUBackend* backend, void*) {
	initVdpRpuPipeline(*static_cast<OpenGLES2Backend*>(backend));
};

constexpr auto shouldExecuteVdpRpuPass = [](GameView* view, void*) {
	return view->vdpRpuFrame->commands.passCount != 0u && (view->gxGpuStatusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u;
};

constexpr auto renderVdpRpuPass = [](GPUBackend* backend, GameView* view, void* framebuffer, RenderPassStateStorage&, void*) {
	(void)backend;
	VdpRpuPipelineState state;
	state.width = static_cast<i32>(view->offscreenCanvasSize.x);
	state.height = static_cast<i32>(view->offscreenCanvasSize.y);
	state.frame = view->vdpRpuFrame;
	renderVdpRpuFrame(framebuffer, state);
};

} // namespace

void registerVdpRpuPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "vdp_rpu";
	desc.name = "VDPRPU";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor, RenderPassDef::RenderGraphSlot::FrameDepth };
	desc.writesDepth = true;
	desc.bootstrap = bootstrapVdpRpuPass;
	desc.shouldExecute = shouldExecuteVdpRpuPass;
	desc.exec = renderVdpRpuPass;
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
