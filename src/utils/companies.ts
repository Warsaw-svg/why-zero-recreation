/** Companies shown in the final city. Project text is illustrative (written for this demo), not real job data. */
export interface Company {
  id: string; name: string; color: string;
  hq: string; founded: string;
  role: string; project: string; summary: string; tools: string[];
  /** ground position of the company's building in the city (x, z) */
  pos: [number, number];
}

export const COMPANIES: Company[] = [
  {
    id: 'google', name: 'Google', color: '#4285F4', hq: 'Mountain View, California', founded: '1998',
    role: 'Software Engineer', project: 'Transit Delay Alerts Prototype',
    summary: 'Build a prototype that warns commuters about delays and suggests an earlier departure time.',
    tools: ['TypeScript', 'React', 'Firebase', 'Gemini API'], pos: [-21, -15],
  },
  {
    id: 'openai', name: 'OpenAI', color: '#10A37F', hq: 'Mission Bay, San Francisco', founded: '2015',
    role: 'Product Analyst', project: 'First-Week Drop-off Analysis',
    summary: 'Find where new users abandon the first-week flow and propose three experiments to fix it.',
    tools: ['SQL', 'Python', 'Google Sheets', 'Looker'], pos: [-17, 17],
  },
  {
    id: 'anthropic', name: 'Anthropic', color: '#D97757', hq: 'SoMa, San Francisco', founded: '2021',
    role: 'Research Engineer', project: 'Prompt Evaluation Harness',
    summary: 'Build a small eval harness that compares prompt variants on accuracy, tone and refusals.',
    tools: ['Python', 'Claude API', 'Pytest', 'Notebook'], pos: [20, -16],
  },
  {
    id: 'netflix', name: 'Netflix', color: '#E50914', hq: 'Los Gatos, California', founded: '1997',
    role: 'Data Analyst', project: 'Artwork A/B Test Readout',
    summary: 'Analyse an artwork A/B test and recommend which thumbnail variant to roll out, and why.',
    tools: ['SQL', 'Python', 'Tableau', 'Jupyter'], pos: [21, 15],
  },
];
