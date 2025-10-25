function simulate({
  innerWidth,
  innerHeight,
  screenHeight,
  visualHeight,
  offsetTop,
  isLandscape,
  label,
  dpadBaseWidth = 100,
  dpadBaseHeight = 100,
  actionBaseWidth = 100,
  actionBaseHeight = 220,
  maxRightWidth = null,
  maxLeftWidth = null,
  respectGamepadLebensraum = false,
  layoutMode = 'absolute', // 'absolute' = svg absolute positioned, 'static' = svg participates in flow
}) {
  const visualViewport = { height: visualHeight, offsetTop };
  const visibleBottom = visualViewport.offsetTop + visualViewport.height;
  const viewportBottomInset = Math.max(0, innerHeight - visibleBottom);
  const viewportWidth = innerWidth;
  const viewportHeight = innerHeight;
  const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
  const centeredSpan = visualViewport.height;
  const bottomInset = viewportBottomInset;

  const baseScale = referenceDimension * 0.20 / 100;

  const computeScale = (baseWidth, baseHeight, isRightSide) => {
    let scale = baseScale;
    if (respectGamepadLebensraum && isLandscape) {
      const maxWidth = isRightSide ? maxRightWidth : maxLeftWidth;
      if (typeof maxWidth === 'number' && maxWidth >= 0 && baseWidth > 0) {
        const maxScaleByWidth = maxWidth / baseWidth;
        scale = Math.min(scale, maxScaleByWidth);
      }
    }
    if (visualViewport.height > 0 && baseHeight > 0) {
      const maxScaleByHeight = visualViewport.height / baseHeight;
      scale = Math.min(scale, maxScaleByHeight);
    }
    return scale;
  };

  const dpadScale = computeScale(dpadBaseWidth, dpadBaseHeight, false);
  const actionScale = computeScale(actionBaseWidth, actionBaseHeight, true);
  const dpadHeight = dpadBaseHeight * dpadScale;
  const actionHeight = actionBaseHeight * actionScale;

  const computeBottom = (size, isRightSide) => {
    let newBottom;
    if (isLandscape) {
      const verticalRoom = Math.max(centeredSpan - size, 0);
      newBottom = bottomInset + verticalRoom / 2;
    } else if (isRightSide) {
      newBottom = bottomInset;
    } else {
      const referenceHeight = Math.max(actionHeight, size);
      const verticalRoom = Math.max(referenceHeight - size, 0);
      newBottom = bottomInset + verticalRoom / 2;
    }
    return Math.max(0, Math.round(newBottom));
  };

  const dpadBottom = computeBottom(dpadHeight, false);
  const actionBottom = computeBottom(actionHeight, true);

  const resolveVisualBottom = (computedBottom, baseHeight, scaledHeight) => {
    if (layoutMode === 'absolute') {
      const extraHeight = Math.max(0, scaledHeight - baseHeight);
      return computedBottom - extraHeight;
    }
    return computedBottom;
  };

  const dpadVisualBottom = resolveVisualBottom(dpadBottom, dpadBaseHeight, dpadHeight);
  const actionVisualBottom = resolveVisualBottom(actionBottom, actionBaseHeight, actionHeight);

  const clampWithinViewport = value => Math.max(0, Math.min(innerHeight, value));

  return {
    label,
    viewportBottomInset,
    centeredSpan,
    layoutMode,
    dpadComputedBottom: dpadBottom,
    actionComputedBottom: actionBottom,
    dpadVisualBottom,
    actionVisualBottom,
    actionTopFromViewportBottom: clampWithinViewport(innerHeight - actionVisualBottom),
    actionHeight: Math.round(actionHeight),
    dpadHeight: Math.round(dpadHeight),
    visualHeight,
    referenceDimension,
    dpadScale: Number(dpadScale.toFixed(3)),
    actionScale: Number(actionScale.toFixed(3)),
  };
}

const scenarios = [
  {
    label: 'Landscape wide (svg absolute positioning)',
    innerWidth: 1280,
    innerHeight: 720,
    screenHeight: 720,
    visualHeight: 720,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'absolute',
  },
  {
    label: 'Landscape wide (static positioning)',
    innerWidth: 1280,
    innerHeight: 720,
    screenHeight: 720,
    visualHeight: 720,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'static',
  },
  {
    label: 'Landscape with small visual viewport (svg absolute positioning)',
    innerWidth: 1280,
    innerHeight: 720,
    screenHeight: 720,
    visualHeight: 400,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'absolute',
  },
  {
    label: 'Landscape with small visual viewport (static)',
    innerWidth: 1280,
    innerHeight: 720,
    screenHeight: 720,
    visualHeight: 400,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'static',
  },
  {
    label: 'Portrait tall (static)',
    innerWidth: 768,
    innerHeight: 1024,
    screenHeight: 1024,
    visualHeight: 900,
    offsetTop: 0,
    isLandscape: false,
    layoutMode: 'static',
  },
  {
    label: 'Landscape device with inset (svg absolute positioning)',
    innerWidth: 1334,
    innerHeight: 750,
    screenHeight: 750,
    visualHeight: 320,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'absolute',
  },
  {
    label: 'Landscape device with inset (static)',
    innerWidth: 1334,
    innerHeight: 750,
    screenHeight: 750,
    visualHeight: 320,
    offsetTop: 0,
    isLandscape: true,
    layoutMode: 'static',
  },
];

const results = scenarios.map(simulate);
console.table(results);
