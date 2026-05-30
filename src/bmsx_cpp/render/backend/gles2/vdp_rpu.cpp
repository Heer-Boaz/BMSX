#include "render/backend/gles2/vdp_rpu.h"

#if BMSX_ENABLE_GLES2
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/rpu.h"
#include "render/backend/gles2/backend.h"
#include "render/gameview.h"
#include "render/vdp/slot_textures.h"
#include "render/backend/gles2/shaders/vdp_rpu_shaders.h"

#include <GLES2/gl2.h>
#include <array>
#include <bit>
#include <cstdint>
#include <stdexcept>

namespace bmsx {
namespace {

using VdpRpuDrawArraysInstancedProc = void (*)(GLenum mode, GLint first, GLsizei count, GLsizei instanceCount);
using VdpRpuDrawElementsInstancedProc = void (*)(GLenum mode, GLsizei count, GLenum type, const void* indices, GLsizei instanceCount);
using VdpRpuVertexAttribDivisorProc = void (*)(GLuint index, GLuint divisor);

struct VdpRpuGLES2Runtime {
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
	std::array<GLuint, VDP_RPU_BUFFER_CAPACITY> vertexBufferObject{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> vertexBufferRevision{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> vertexBufferByteOffset{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> vertexBufferByteLength{};
	std::array<GLuint, VDP_RPU_BUFFER_CAPACITY> instanceBufferObject{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> instanceBufferRevision{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> instanceBufferByteOffset{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> instanceBufferByteLength{};
	std::array<GLuint, VDP_RPU_BUFFER_CAPACITY> morphBufferObject{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> morphBufferRevision{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> morphBufferByteOffset{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> morphBufferByteLength{};
	std::array<GLuint, VDP_RPU_BUFFER_CAPACITY> indexBufferObject{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> indexBufferRevision{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> indexBufferByteOffset{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> indexBufferByteLength{};
	std::array<GLuint, VDP_RPU_SURFACE_CAPACITY> surfaceTexture{};
	std::array<GLuint, VDP_RPU_SURFACE_CAPACITY> surfaceDepthBuffer{};
	std::array<GLuint, VDP_RPU_SURFACE_CAPACITY> surfaceFramebuffer{};
	std::array<u32, VDP_RPU_SURFACE_CAPACITY> surfaceRevision{};
	std::array<u32, VDP_RPU_SURFACE_CAPACITY> surfaceWidth{};
	std::array<u32, VDP_RPU_SURFACE_CAPACITY> surfaceHeight{};
	std::array<u8, VDP_RPU_SURFACE_CAPACITY> surfaceFormat{};
};

VdpRpuGLES2Runtime g_vdpRpu{};

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

void deleteVdpRpuSurfaceStorage(u32 surfaceId) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	if (runtime.surfaceTexture[surfaceId] != 0u) {
		glDeleteTextures(1, &runtime.surfaceTexture[surfaceId]);
		runtime.surfaceTexture[surfaceId] = 0u;
	}
	if (runtime.surfaceDepthBuffer[surfaceId] != 0u) {
		glDeleteRenderbuffers(1, &runtime.surfaceDepthBuffer[surfaceId]);
		runtime.surfaceDepthBuffer[surfaceId] = 0u;
	}
	if (runtime.surfaceFramebuffer[surfaceId] != 0u) {
		glDeleteFramebuffers(1, &runtime.surfaceFramebuffer[surfaceId]);
		runtime.surfaceFramebuffer[surfaceId] = 0u;
	}
}

GLuint ensureVdpRpuBufferStorage(
	const VdpRpuFrameOutput& frame,
	size_t refIndex,
	GLenum target,
	std::array<GLuint, VDP_RPU_BUFFER_CAPACITY>& bufferObject,
	std::array<u32, VDP_RPU_BUFFER_CAPACITY>& bufferRevision,
	std::array<u32, VDP_RPU_BUFFER_CAPACITY>& bufferByteOffset,
	std::array<u32, VDP_RPU_BUFFER_CAPACITY>& bufferByteLength
) {
	const VdpRpuFrameBufferRefs& refs = frame.resources.bufferRefs;
	const u32 bufferId = refs.bufferId[refIndex];
	if (bufferObject[bufferId] == 0u) {
		glGenBuffers(1, &bufferObject[bufferId]);
	}
	glBindBuffer(target, bufferObject[bufferId]);
	if (bufferRevision[bufferId] != refs.revision[refIndex]
		|| bufferByteOffset[bufferId] != refs.byteOffset[refIndex]
		|| bufferByteLength[bufferId] != refs.byteLength[refIndex]) {
		glBufferData(target, refs.byteLength[refIndex], nullptr, GL_STREAM_DRAW);
		glBufferSubData(target, 0, refs.byteLength[refIndex], refs.bytes[refIndex] + refs.byteOffset[refIndex]);
		bufferRevision[bufferId] = refs.revision[refIndex];
		bufferByteOffset[bufferId] = refs.byteOffset[refIndex];
		bufferByteLength[bufferId] = refs.byteLength[refIndex];
	}
	return bufferObject[bufferId];
}

void ensureVdpRpuSurfaceStorage(OpenGLES2Backend& backend, const VdpRpuFrameOutput& frame, u16 surfaceRef) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	const VdpRpuFrameSurfaceRefs& refs = frame.resources.surfaceRefs;
	const u32 surfaceId = refs.surfaceId[surfaceRef];
	const u32 revision = refs.revision[surfaceRef];
	const u32 width = refs.width[surfaceRef];
	const u32 height = refs.height[surfaceRef];
	const u8 format = refs.format[surfaceRef];
	if (runtime.surfaceRevision[surfaceId] == revision
		&& runtime.surfaceWidth[surfaceId] == width
		&& runtime.surfaceHeight[surfaceId] == height
		&& runtime.surfaceFormat[surfaceId] == format) {
		return;
	}
	deleteVdpRpuSurfaceStorage(surfaceId);
	backend.setActiveTextureUnit(0);
	if (format == VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		glGenRenderbuffers(1, &runtime.surfaceDepthBuffer[surfaceId]);
		glBindRenderbuffer(GL_RENDERBUFFER, runtime.surfaceDepthBuffer[surfaceId]);
		glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, static_cast<GLsizei>(width), static_cast<GLsizei>(height));
	} else {
		glGenTextures(1, &runtime.surfaceTexture[surfaceId]);
		glBindTexture(GL_TEXTURE_2D, runtime.surfaceTexture[surfaceId]);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, static_cast<GLsizei>(width), static_cast<GLsizei>(height), 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	}
	backend.invalidateTextureBindingCache();
	glGenFramebuffers(1, &runtime.surfaceFramebuffer[surfaceId]);
	runtime.surfaceRevision[surfaceId] = revision;
	runtime.surfaceWidth[surfaceId] = width;
	runtime.surfaceHeight[surfaceId] = height;
	runtime.surfaceFormat[surfaceId] = format;
}

void bindVdpRpuPassFramebuffer(OpenGLES2Backend& backend, const VdpRpuFrameOutput& frame, size_t passIndex, void* framebuffer, i32 width, i32 height) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const u16 colorRef = commands.passColorSurfaceRef[passIndex];
	const u16 depthRef = commands.passDepthSurfaceRef[passIndex];
	if (colorRef == VDP_RPU_REF_NONE && depthRef == VDP_RPU_REF_NONE) {
		backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), width, height);
		return;
	}
	const u16 targetRef = colorRef != VDP_RPU_REF_NONE ? colorRef : depthRef;
	ensureVdpRpuSurfaceStorage(backend, frame, targetRef);
	const VdpRpuFrameSurfaceRefs& refs = frame.resources.surfaceRefs;
	const u32 targetSurfaceId = refs.surfaceId[targetRef];
	backend.setRenderTarget(g_vdpRpu.surfaceFramebuffer[targetSurfaceId], refs.width[targetRef], refs.height[targetRef]);
	if (colorRef != VDP_RPU_REF_NONE) {
		ensureVdpRpuSurfaceStorage(backend, frame, colorRef);
		const u32 colorSurfaceId = refs.surfaceId[colorRef];
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_vdpRpu.surfaceTexture[colorSurfaceId], 0);
	} else {
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, 0u, 0);
	}
	if (depthRef != VDP_RPU_REF_NONE) {
		ensureVdpRpuSurfaceStorage(backend, frame, depthRef);
		const u32 depthSurfaceId = refs.surfaceId[depthRef];
		glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, g_vdpRpu.surfaceDepthBuffer[depthSurfaceId]);
	} else {
		glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, 0u);
	}
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

void bindVdpRpuVertexStream(const VdpRpuFrameOutput& frame, size_t streamBindingIndex) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const u16 refIndex = commands.streamBufferRef[streamBindingIndex];
	if (refIndex == VDP_RPU_REF_NONE) {
		return;
	}
	const VdpRpuStreamLayoutSpec& layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		GL_ARRAY_BUFFER,
		g_vdpRpu.vertexBufferObject,
		g_vdpRpu.vertexBufferRevision,
		g_vdpRpu.vertexBufferByteOffset,
		g_vdpRpu.vertexBufferByteLength
	);
	const u32 byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (size_t index = 0u; index < layout.attributeCount; ++index) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, 0u);
	}
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

void bindVdpRpuInstanceStream(const VdpRpuFrameOutput& frame, size_t streamBindingIndex) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const u16 refIndex = commands.streamBufferRef[streamBindingIndex];
	const u32 stepRate = commands.streamStepRate[streamBindingIndex];
	if (refIndex == VDP_RPU_REF_NONE) {
		return;
	}
	const VdpRpuStreamLayoutSpec& layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		GL_ARRAY_BUFFER,
		g_vdpRpu.instanceBufferObject,
		g_vdpRpu.instanceBufferRevision,
		g_vdpRpu.instanceBufferByteOffset,
		g_vdpRpu.instanceBufferByteLength
	);
	const u32 byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (size_t index = 0u; index < layout.attributeCount; ++index) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, stepRate);
	}
}

void bindVdpRpuMorphStream(const VdpRpuFrameOutput& frame, size_t streamBindingIndex) {
	const VdpRpuCommandBuffer& commands = frame.commands;
	const u16 refIndex = commands.streamBufferRef[streamBindingIndex];
	if (refIndex == VDP_RPU_REF_NONE) {
		return;
	}
	const VdpRpuStreamLayoutSpec& layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		GL_ARRAY_BUFFER,
		g_vdpRpu.morphBufferObject,
		g_vdpRpu.morphBufferRevision,
		g_vdpRpu.morphBufferByteOffset,
		g_vdpRpu.morphBufferByteLength
	);
	const u32 byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (size_t index = 0u; index < layout.attributeCount; ++index) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, 0u);
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
		bindVdpRpuVertexStream(frame, vertexBinding);
	}
	if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE && instanceBinding != bindingEnd) {
		bindVdpRpuInstanceStream(frame, instanceBinding);
	}
	if (morphBinding != bindingEnd) {
		bindVdpRpuMorphStream(frame, morphBinding);
	}
}

void setVdpRpuC0Constants(const VdpRpuFrameOutput& frame, size_t drawIndex, u32 normalMode) {
	VdpRpuGLES2Runtime& runtime = g_vdpRpu;
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.constantBindingSlot[bindingIndex] == 0u) {
			const u16 constantBank = commands.constantBank[bindingIndex];
			if (constantBank == VDP_RPU_REF_NONE) {
				glUniformMatrix4fv(runtime.uniformC0, 1, GL_FALSE, runtime.identityC0.data());
				if (normalMode != 0u) {
					glUniformMatrix3fv(runtime.uniformNm, 1, GL_FALSE, runtime.identityNm.data());
				}
				return;
			}
			const u32 firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			for (size_t index = 0u; index < 16u; ++index) {
				runtime.c0Floats[index] = std::bit_cast<f32>(frame.resources.constantWords[firstWord + index]);
			}
			glUniformMatrix4fv(runtime.uniformC0, 1, GL_FALSE, runtime.c0Floats.data());
			if (normalMode != 0u) {
				for (size_t index = 0u; index < 9u; ++index) {
					runtime.nmFloats[index] = std::bit_cast<f32>(frame.resources.constantWords[firstWord + 16u + index]);
				}
				glUniformMatrix3fv(runtime.uniformNm, 1, GL_FALSE, runtime.nmFloats.data());
			}
			return;
		}
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
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.constantBindingSlot[bindingIndex] == constantSlot) {
			const u16 constantBank = commands.constantBank[bindingIndex];
			if (constantBank == VDP_RPU_REF_NONE) {
				glUniform4fv(runtime.uniformC1, 17, runtime.defaultC1Floats.data());
				return;
			}
			const u32 firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			for (size_t index = 0u; index < 68u; ++index) {
				runtime.c1Floats[index] = std::bit_cast<f32>(frame.resources.constantWords[firstWord + index]);
			}
			glUniform4fv(runtime.uniformC1, 17, runtime.c1Floats.data());
			return;
		}
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
	const VdpRpuCommandBuffer& commands = frame.commands;
	const size_t bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (size_t bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.constantBindingSlot[bindingIndex] == constantSlot) {
			const u16 constantBank = commands.constantBank[bindingIndex];
			if (constantBank == VDP_RPU_REF_NONE) {
				glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.defaultJointFloats.data());
				return;
			}
			const u32 firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			for (size_t index = 0u; index < 384u; ++index) {
				runtime.jointFloats[index] = std::bit_cast<f32>(frame.resources.constantWords[firstWord + index]);
			}
			glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.jointFloats.data());
			return;
		}
	}
	glUniformMatrix4fv(runtime.uniformJoint, 24, GL_FALSE, runtime.defaultJointFloats.data());
}

void bindVdpRpuNeutralTexture(OpenGLES2Backend& backend) {
	backend.setActiveTextureUnit(0);
	glBindTexture(GL_TEXTURE_2D, g_vdpRpu.neutralTexture);
	glUniform1i(g_vdpRpu.uniformTextureFlipY, 0);
	backend.invalidateTextureBindingCache();
}

void bindVdpRpuTextureBindings(VdpRpuRuntime& runtime, const VdpRpuFrameOutput& frame, size_t drawIndex, const VdpRpuShaderVariantSpec& shaderVariant, u32 rawVariantWord) {
	const bool t1Flag = (rawVariantWord & VDP_RPU_SHADER_FLAG_T1) != 0u;
	if (shaderVariant.textureSlotCount == 0u) {
		bindVdpRpuNeutralTexture(runtime.backend);
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
			const u16 surfaceRef = commands.textureSurfaceRef[bindingIndex];
			if (surfaceRef == VDP_RPU_REF_NONE) {
				bindVdpRpuNeutralTexture(runtime.backend);
				glUniform1i(g_vdpRpu.uniformT0, 0);
			} else {
				const u32 surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
				runtime.backend.setActiveTextureUnit(0);
				if (surfaceId < VDP_RD_SURFACE_COUNT) {
					runtime.backend.bindTexture2D(runtime.context.vdpSlotTextures().readSurfaceTextureHandle(surfaceId));
					glUniform1i(g_vdpRpu.uniformTextureFlipY, 0);
				} else {
					ensureVdpRpuSurfaceStorage(runtime.backend, frame, surfaceRef);
					runtime.backend.invalidateTextureBindingCache();
					glBindTexture(GL_TEXTURE_2D, g_vdpRpu.surfaceTexture[surfaceId]);
					glUniform1i(g_vdpRpu.uniformTextureFlipY, 1);
				}
				glUniform1i(g_vdpRpu.uniformT0, 0);
			}
		} else if (slot == 1u && t1Flag && !foundT1) {
			foundT1 = true;
			const u16 surfaceRef = commands.textureSurfaceRef[bindingIndex];
			if (surfaceRef != VDP_RPU_REF_NONE) {
				const u32 surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
				runtime.backend.setActiveTextureUnit(1);
				if (surfaceId < VDP_RD_SURFACE_COUNT) {
					runtime.backend.bindTexture2D(runtime.context.vdpSlotTextures().readSurfaceTextureHandle(surfaceId));
				} else {
					ensureVdpRpuSurfaceStorage(runtime.backend, frame, surfaceRef);
					runtime.backend.invalidateTextureBindingCache();
					glBindTexture(GL_TEXTURE_2D, g_vdpRpu.surfaceTexture[surfaceId]);
				}
				glUniform1i(g_vdpRpu.uniformT1, 1);
				glUniform1i(g_vdpRpu.uniformT1Mode, 1);
			}
		}
	}
	if (!foundT0) {
		bindVdpRpuNeutralTexture(runtime.backend);
		glUniform1i(g_vdpRpu.uniformTextureEnabled, 0);
	}
	if (!foundT1 || !t1Flag) {
		glUniform1i(g_vdpRpu.uniformT1Mode, 0);
	}
}

void drawVdpRpuCommand(VdpRpuRuntime& runtime, const VdpRpuFrameOutput& frame, size_t drawIndex, u32 vertexCount, u32 instanceCount, u32 indexCount) {
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
	bindVdpRpuTextureBindings(runtime, frame, drawIndex, shaderVariant, rawVariantWord);
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
	const u16 indexRef = commands.drawIndexBufferRef[drawIndex];
	if (indexType == VDP_RPU_INDEX_NONE || indexRef == VDP_RPU_REF_NONE) {
		if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE) {
			g_vdpRpu.drawArraysInstanced(primitive, 0, static_cast<GLsizei>(vertexCount), static_cast<GLsizei>(instanceCount));
			return;
		}
		glDrawArrays(primitive, 0, static_cast<GLsizei>(vertexCount));
		return;
	}
	ensureVdpRpuBufferStorage(
		frame,
		indexRef,
		GL_ELEMENT_ARRAY_BUFFER,
		g_vdpRpu.indexBufferObject,
		g_vdpRpu.indexBufferRevision,
		g_vdpRpu.indexBufferByteOffset,
		g_vdpRpu.indexBufferByteLength
	);
	const void* indexByteOffset = reinterpret_cast<const void*>(static_cast<uintptr_t>(commands.drawIndexByteOffset[drawIndex] - frame.resources.bufferRefs.sourceByteOffset[indexRef]));
	if (instanceMode != VDP_RPU_INSTANCE_MODE_NONE) {
		g_vdpRpu.drawElementsInstanced(primitive, static_cast<GLsizei>(indexCount), vdpRpuIndexType(indexType), indexByteOffset, static_cast<GLsizei>(instanceCount));
		return;
	}
	glDrawElements(primitive, static_cast<GLsizei>(indexCount), vdpRpuIndexType(indexType), indexByteOffset);
}

} // namespace

void initVdpRpuPipeline(OpenGLES2Backend& backend) {
	g_vdpRpu.program = backend.buildProgram(kVdpRpuVertexShader, kVdpRpuFragmentShader, "vdp_rpu");
	glGenTextures(1, &g_vdpRpu.neutralTexture);
	glBindTexture(GL_TEXTURE_2D, g_vdpRpu.neutralTexture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_vdpRpu.neutralTexturePixel.data());
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glBindTexture(GL_TEXTURE_2D, 0u);
	backend.invalidateTextureBindingCache();
	setupVdpRpuLocations(backend);
}

void setupVdpRpuLocations(OpenGLES2Backend& backend) {
	auto& runtime = g_vdpRpu;
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

void renderVdpRpuFrame(VdpRpuRuntime& runtime, void* framebuffer, const VdpRpuPipelineState& state) {
	OpenGLES2Backend& backend = runtime.backend;
	glUseProgram(g_vdpRpu.program);
	const VdpRpuFrameOutput& frame = *state.frame;
	const VdpRpuCommandBuffer& commands = frame.commands;
	for (size_t passIndex = 0u; passIndex < commands.passCount; ++passIndex) {
		bindVdpRpuPassFramebuffer(backend, frame, passIndex, framebuffer, state.width, state.height);
		const u32 viewportXY = commands.passViewportXY[passIndex];
		const u32 viewportWH = commands.passViewportWH[passIndex];
		glViewport(
			static_cast<GLint>(viewportXY & 0xffffu),
			static_cast<GLint>(viewportXY >> 16u),
			static_cast<GLsizei>(viewportWH & 0xffffu),
			static_cast<GLsizei>(viewportWH >> 16u)
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
		const size_t firstBatch = commands.passFirstBatch[passIndex];
		const size_t batchEnd = firstBatch + commands.passBatchCount[passIndex];
		for (size_t batchIndex = firstBatch; batchIndex < batchEnd; ++batchIndex) {
			drawVdpRpuCommand(
				runtime,
				frame,
				commands.batchFirstDraw[batchIndex],
				commands.batchVertexCount[batchIndex],
				commands.batchInstanceCount[batchIndex],
				commands.batchIndexCount[batchIndex]
			);
		}
	}
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glDepthMask(GL_TRUE);
	backend.invalidateTextureBindingCache();
}

void registerVdpRpuPass(RenderPassLibrary& registry) {
	GameView* const view = registry.view();
	RenderPassDef desc;
	desc.id = "vdp_rpu";
	desc.name = "VDPRPU";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor, RenderPassDef::RenderGraphSlot::FrameDepth };
	desc.writesDepth = true;
	desc.bootstrap = [](GPUBackend* backend) {
		initVdpRpuPipeline(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.shouldExecute = [view]() {
		return view->vdpRpuFrame->commands.passCount != 0u;
	};
	desc.exec = [view](GPUBackend* backend, void* framebuffer, std::any&) {
		VdpRpuRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *view};
		VdpRpuPipelineState state;
		state.width = static_cast<i32>(view->offscreenCanvasSize.x);
		state.height = static_cast<i32>(view->offscreenCanvasSize.y);
		state.frame = view->vdpRpuFrame;
		renderVdpRpuFrame(runtime, framebuffer, state);
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
