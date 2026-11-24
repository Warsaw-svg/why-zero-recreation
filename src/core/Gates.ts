export interface Gate { id: string; at: number; solved: boolean; /** once solved, you can't scroll back above this */ floorAt?: number }
/** Scroll locks. Progress is clamped to the first unsolved gate. Solved gates never re-lock. */
export class Gates {
  gates: Gate[] = [];
  private listeners: Array<(g: Gate) => void> = [];
  add(id: string, at: number, floorAt?: number) { this.gates.push({ id, at, solved: false, floorAt }); this.gates.sort((a, b) => a.at - b.at); }
  get(id: string) { return this.gates.find((g) => g.id === id)!; }
  isSolved(id: string) { return this.get(id).solved; }
  /** lowest progress you can scroll back to: once a hold gate is passed, the story can't go back behind it (reference) */
  /** extra floor set by story milestones (e.g. once Component 4 has started) */
  extraFloor = 0;
  floor(): number { let f = this.extraFloor; for (const g of this.gates) if (g.solved && g.id !== 'intro') f = Math.max(f, g.floorAt ?? g.at); return f; }
  /** highest progress currently reachable */
  limit(): number { const g = this.gates.find((x) => !x.solved); return g ? g.at : 1; }
  solve(id: string) {
    const g = this.get(id);
    if (g.solved) return;
    g.solved = true;
    this.listeners.forEach((f) => f(g));
  }
  /** mark every gate before p as solved (menu jumps) */
  skipTo(p: number) { this.gates.forEach((g) => { if (g.at < p) g.solved = true; }); }
  onSolve(f: (g: Gate) => void) { this.listeners.push(f); }
  /** is progress p currently parked at an unsolved gate? */
  activeAt(p: number, id: string, eps = 0.006) { const g = this.get(id); return !g.solved && p >= g.at - eps; }
}
