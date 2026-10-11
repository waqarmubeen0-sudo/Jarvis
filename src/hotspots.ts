export interface HotspotNode {
  id: string;
  name: string;
  category: 'Command' | 'Research' | 'Security' | 'Automation' | 'Quantum';
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  status: 'ONLINE' | 'ACTIVE' | 'STANDBY';
  agentId: string;
  description: string;
  metrics: {
    load: string;
    ping: string;
    efficiency: string;
  };
}

export const JARVIS_HOTSPOTS: HotspotNode[] = [
  {
    id: 'node-nex',
    name: 'NEX Command Core',
    category: 'Command',
    x: 50,
    y: 45,
    status: 'ACTIVE',
    agentId: 'NEX',
    description: 'Central Multi-Agent Manager & Task Orchestration Nexus.',
    metrics: { load: '14%', ping: '2ms', efficiency: '99.8%' },
  },
  {
    id: 'node-code',
    name: 'CODE Synthesis Lab',
    category: 'Research',
    x: 25,
    y: 30,
    status: 'ONLINE',
    agentId: 'CODE',
    description: 'Automated Architecture & Code Synthesis Node.',
    metrics: { load: '32%', ping: '5ms', efficiency: '98.5%' },
  },
  {
    id: 'node-sec',
    name: 'SEC Sentinel Grid',
    category: 'Security',
    x: 75,
    y: 30,
    status: 'ONLINE',
    agentId: 'SEC',
    description: 'Cybersecurity Firewall & Privacy Encryption Node.',
    metrics: { load: '8%', ping: '1ms', efficiency: '100%' },
  },
  {
    id: 'node-ops',
    name: 'OPS Terminal Relay',
    category: 'Automation',
    x: 30,
    y: 70,
    status: 'ACTIVE',
    agentId: 'OPS',
    description: 'Host OS PowerShell & PC Control Execution Engine.',
    metrics: { load: '19%', ping: '3ms', efficiency: '99.1%' },
  },
  {
    id: 'node-solve',
    name: 'SOLVE Reasoning Matrix',
    category: 'Quantum',
    x: 70,
    y: 70,
    status: 'ONLINE',
    agentId: 'SOLVE',
    description: 'Multi-Step Logical Reasoning & Problem Solving Engine.',
    metrics: { load: '22%', ping: '4ms', efficiency: '99.4%' },
  },
  {
    id: 'node-data',
    name: 'DATA Intelligence Bank',
    category: 'Research',
    x: 50,
    y: 80,
    status: 'ONLINE',
    agentId: 'DATA',
    description: 'Data Scraping, Analytical Comparison & Research Memory.',
    metrics: { load: '45%', ping: '6ms', efficiency: '97.8%' },
  },
];

// Alias for backwards compatibility
export const STONIC_HOTSPOTS = JARVIS_HOTSPOTS;
