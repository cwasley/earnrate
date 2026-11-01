// Returns closer than this are equal: floating-point noise, not a difference.
export const EPSILON = 1e-9

// A card close to the best one: within a percentage point, and at least
// three quarters of its rate. Answers and cheat sheets mention a welcome
// bonus card when it's this close.
export function isClose(own: number, best: number): boolean {
  return best - own <= 1 && own >= best * 0.75
}
