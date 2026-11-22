interface DrawingBufferSize {
  drawWidth: number;
  drawHeight: number;
}

interface RenderView extends DrawingBufferSize {
  pxScale: number;
}

export function capRenderScale(drawHeight: number, preferredScale: number, heightLimit: number): number {
  return Math.max(1, Math.min(preferredScale, heightLimit / drawHeight));
}

export function selectAdaptiveRenderScale(
  { drawWidth, drawHeight }: DrawingBufferSize,
  pixelBudget: number,
  maximumScale: number,
  minimumScale: number,
): number {
  const budgetScale = Math.sqrt(pixelBudget / (drawWidth * drawHeight));
  return Math.max(minimumScale, Math.min(maximumScale, budgetScale));
}

export function measureRenderTargets(
  { drawWidth, drawHeight, pxScale }: RenderView,
  supersampling: number,
  keyMapDivisor: number,
) {
  const width = Math.round(drawWidth * supersampling);
  const height = Math.round(drawHeight * supersampling);
  return {
    width,
    height,
    keyWidth: Math.ceil(width / keyMapDivisor),
    keyHeight: Math.ceil(height / keyMapDivisor),
    effectiveScale: height / drawHeight,
    pixelScale: pxScale * height / drawHeight,
  };
}
