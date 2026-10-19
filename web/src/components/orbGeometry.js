export function computeGlowRadius(scale, t) {
  return Math.max(0, 80 * scale + 20 * Math.sin(t * 0.01));
}
