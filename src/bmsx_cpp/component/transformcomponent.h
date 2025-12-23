/*
 * transformcomponent.h - Transform component for 3D transforms
 *
 * Mirrors TypeScript component/transformcomponent.ts
 * Handles position, orientation (quaternion), and scale with parent-child hierarchy.
 */

#ifndef BMSX_TRANSFORM_COMPONENT_H
#define BMSX_TRANSFORM_COMPONENT_H

#include "component.h"
#include "../core/types.h"
#include <array>
#include <vector>

namespace bmsx {

/* ============================================================================
 * Quaternion type
 * ============================================================================ */

struct Quat {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 w = 1.0f;
	
	Quat() = default;
	Quat(f32 x_, f32 y_, f32 z_, f32 w_) : x(x_), y(y_), z(z_), w(w_) {}
	
	static Quat identity() { return Quat(0, 0, 0, 1); }
};

/* ============================================================================
 * 4x4 Matrix type (column-major, matches GL conventions)
 * ============================================================================ */

using Mat4 = std::array<f32, 16>;

namespace M4 {
	void setIdentity(Mat4& m);
	void copyInto(Mat4& dst, const Mat4& src);
	void fromTRSInto(Mat4& out, const Vec3& translation, const Quat& rotation, const Vec3& scale);
	void mulAffineInto(Mat4& out, const Mat4& a, const Mat4& b);
}

/* ============================================================================
 * TransformComponent options
 * ============================================================================ */

struct TransformComponentOptions : ComponentAttachOptions {
	std::optional<Vec3> position;
	std::optional<Vec3> scale;
	std::optional<Quat> orientationQ;
};

/* ============================================================================
 * TransformComponent
 *
 * Manages hierarchical 3D transforms for a WorldObject.
 * Caches local and world matrices, invalidating on changes.
 * ============================================================================ */

class TransformComponent : public Component {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "TransformComponent"; }
	const char* name() const override { return typeName(); }

	// Transform properties
	Vec3 position;
	Quat orientationQ;
	Vec3 scale;

private:
	TransformComponent* m_parentNode = nullptr;
	std::vector<TransformComponent*> m_children;
	
	Mat4 m_localMatrix;
	Mat4 m_worldMatrix;
	bool m_dirty = true;

public:
	explicit TransformComponent(const TransformComponentOptions& opts);
	~TransformComponent() override = default;

	// Parent node hierarchy
	TransformComponent* parentNode() const { return m_parentNode; }
	void setParentNode(TransformComponent* parent);
	
	const std::vector<TransformComponent*>& children() const { return m_children; }

	// Matrix access
	const Mat4& getWorldMatrix();
	const Mat4& getLocalMatrix();

	// Dirty flag management
	void markDirty();

	// Component lifecycle
	void postprocessingUpdate(const ComponentUpdateParams& params) override;

private:
	void updateMatrices();
};

} // namespace bmsx

#endif // BMSX_TRANSFORM_COMPONENT_H
