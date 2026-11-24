/**
 * Resume after a refresh (matched to recording/coponent3.mov at 4.5–11 s): the site remembers where you were — scroll
 * progress, solved gates and XP — in this browser. On reload the normal loader plays (countdown + frost), and when it
 * finishes you land straight back where you left off instead of at Component 1. Add `?restart` to the URL to start over.
 */
export interface ResumeState { p: number; solved: string[]; xp: number; awarded?: string[]; at: number }
const KEY = 'zero-resume-v1';

export function loadResume(): ResumeState | null {
  try {
    if (new URLSearchParams(location.search).has('restart')) { localStorage.removeItem(KEY); return null; }
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ResumeState;
    if (typeof s.p !== 'number' || !Array.isArray(s.solved)) return null;
    return s;
  } catch { return null; }
}

let lastJson = '';
export function saveResume(s: Omit<ResumeState, 'at'>) {
  try {
    const json = JSON.stringify({ ...s, p: Math.round(s.p * 10000) / 10000 });
    if (json === lastJson) return;
    lastJson = json;
    localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(json), at: Date.now() }));
  } catch { /* storage blocked: just don't resume */ }
}
