/**
 * Tiny shared bridge between the click overlay and the neural background: a
 * click pushes an NDC-space ripple here, and NeuralBackground consumes it to
 * propagate a lit ring + spawn energy packets through the mesh. Mirrors the
 * design prototype's `_netRipple`, which lived in the same component.
 */
export interface NetRipple {
  x: number;
  y: number;
  t: number;
}

export const fx = {
  /** Active ripples in normalized device coords (-1..1), advanced by the net. */
  ripples: [] as NetRipple[],
  /** Bumped on every new ripple so the net can spawn a burst of packets once. */
  epoch: 0,
};

/** Register a click (screen px) as a network ripple. */
export function addNetRipple(clientX: number, clientY: number): void {
  fx.ripples.push({
    x: (clientX / window.innerWidth - 0.5) * 2,
    y: -(clientY / window.innerHeight - 0.5) * 2,
    t: 0,
  });
  if (fx.ripples.length > 6) fx.ripples.shift();
  fx.epoch += 1;
}
