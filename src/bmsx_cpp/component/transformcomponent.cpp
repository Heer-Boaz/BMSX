/*
 * transformcomponent.cpp - Transform component implementation
 */

#include "transformcomponent.h"
#include "../core/world.h"
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Mat4 operations
 * ============================================================================ */

namespace M4 {

void setIdentity(Mat4& m) {
	std::fill(m.begin(), m.end(), 0.0f);
	m[0] = m[5] = m[10] = m[15] = 1.0f;
}

void copyInto(Mat4& dst, const Mat4& src) {
	std::copy(src.begin(), src.end(), dst.begin());
}

void fromTRSInto(Mat4& out, const Vec3& t, const Quat& r, const Vec3& s) {
	// Build a TRS matrix from translation, rotation (quaternion), and scale
	f32 xx = r.x * r.x;
	f32 xy = r.x * r.y;
	f32 xz = r.x * r.z;
	f32 xw = r.x * r.w;
	f32 yy = r.y * r.y;
	f32 yz = r.y * r.z;
	f32 yw = r.y * r.w;
	f32 zz = r.z * r.z;
	f32 zw = r.z * r.w;
	
	// Column 0
	out[0] = s.x * (1.0f - 2.0f * (yy + zz));
	out[1] = s.x * (2.0f * (xy + zw));
	out[2] = s.x * (2.0f * (xz - yw));
	out[3] = 0.0f;
	
	// Column 1
	out[4] = s.y * (2.0f * (xy - zw));
	out[5] = s.y * (1.0f - 2.0f * (xx + zz));
	out[6] = s.y * (2.0f * (yz + xw));
	out[7] = 0.0f;
	
	// Column 2
	out[8] = s.z * (2.0f * (xz + yw));
	out[9] = s.z * (2.0f * (yz - xw));
	out[10] = s.z * (1.0f - 2.0f * (xx + yy));
	out[11] = 0.0f;
	
	// Column 3 (translation)
	out[12] = t.x;
	out[13] = t.y;
	out[14] = t.z;
	out[15] = 1.0f;
}

void mulAffineInto(Mat4& out, const Mat4& a, const Mat4& b) {
	// Multiply two 4x4 affine matrices (assumes last row is [0,0,0,1])
	for (int col = 0; col < 4; col++) {
		for (int row = 0; row < 4; row++) {
			f32 sum = 0.0f;
			for (int k = 0; k < 4; k++) {
				sum += a[k * 4 + row] * b[col * 4 + k];
			}
			out[col * 4 + row] = sum;
		}
	}
}

} // namespace M4

/* ============================================================================
 * TransformComponent implementation
 * ============================================================================ */

TransformComponent::TransformComponent(const TransformComponentOptions& opts)
	: Component(opts)
	, position(opts.position.value_or(Vec3(0, 0, 0)))
	, orientationQ(opts.orientationQ.value_or(Quat::identity()))
	, scale(opts.scale.value_or(Vec3(1, 1, 1)))
	, m_dirty(true)
{
	M4::setIdentity(m_localMatrix);
	M4::setIdentity(m_worldMatrix);
}

void TransformComponent::setParentNode(TransformComponent* parent) {
	if (m_parentNode == parent) return;
	
	// Remove from old parent
	if (m_parentNode) {
		auto& siblings = m_parentNode->m_children;
		auto it = std::find(siblings.begin(), siblings.end(), this);
		if (it != siblings.end()) {
			siblings.erase(it);
		}
	}
	
	// Add to new parent
	m_parentNode = parent;
	if (parent) {
		parent->m_children.push_back(this);
	}
	
	markDirty();
}

void TransformComponent::markDirty() {
	if (!m_dirty) {
		m_dirty = true;
		for (TransformComponent* child : m_children) {
			child->markDirty();
		}
	}
}

void TransformComponent::updateMatrices() {
	M4::fromTRSInto(m_localMatrix, position, orientationQ, scale);
	
	if (m_parentNode) {
		const Mat4& parentWorld = m_parentNode->getWorldMatrix();
		M4::mulAffineInto(m_worldMatrix, parentWorld, m_localMatrix);
	} else {
		M4::copyInto(m_worldMatrix, m_localMatrix);
	}
	
	m_dirty = false;
}

const Mat4& TransformComponent::getWorldMatrix() {
	if (m_dirty) {
		updateMatrices();
	}
	return m_worldMatrix;
}

const Mat4& TransformComponent::getLocalMatrix() {
	if (m_dirty) {
		updateMatrices();
	}
	return m_localMatrix;
}

void TransformComponent::postprocessingUpdate(const ComponentUpdateParams&) {
	if (!m_parent) return;
	
	// Sync from parent WorldObject
	position.x = m_parent->x();
	position.y = m_parent->y();
	position.z = m_parent->z();
	
	// Orientation from parent if it supports rotation
	// (would need casting to check for Oriented interface)
	
	// Scale from parent if it supports scale
	// (would need casting to check for Scaled interface)
	
	markDirty();
}

} // namespace bmsx
