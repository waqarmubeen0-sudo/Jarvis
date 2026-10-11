// Agent Town scene data, authored against the supplied panel artwork
// (agent-town-panel.png, 1620×971). Every coordinate below is in artwork pixels.

export const ART_W = 1620;
export const ART_H = 971;

export type Pt = { x: number; y: number };
export type Box = [number, number, number, number]; // x0, y0, x1, y1

// Open floor the characters may stand on.
export const WALKABLE: Box[] = [
  [120, 302, 545, 336], // code lab aisle, in front of the desks
  [540, 222, 605, 350], // corridor beside the code lab
  [540, 318, 1430, 346], // top corridor along the room fronts
  [615, 300, 845, 346], // AI core front
  [868, 245, 1085, 346], // security floor
  [1160, 300, 1425, 346], // server vault aisle
  [485, 346, 624, 640], // left lane
  [110, 578, 490, 612], // research floor
  [350, 528, 490, 612], // research floor beside the shelves
  [590, 600, 1030, 845], // command floor
  [975, 346, 1045, 640], // right lane
  [975, 555, 1100, 640], // bridge to the data lab
  [1085, 545, 1470, 582], // data lab aisle
  [1078, 590, 1130, 760], // ramp into the automation bay
  [1120, 705, 1455, 762], // automation walkway
  [150, 742, 555, 842], // lounge floor
  [540, 790, 600, 842], // lounge entrance (the art draws no door, this is the thinnest wall section)
];

// Furniture and fixtures inside walkable space.
export const BLOCKED: Box[] = [
  [612, 488, 682, 592], [908, 488, 978, 592], // command chairs
  [635, 346, 965, 602], // screen wall + holo table
  [955, 645, 1015, 745], [970, 795, 1020, 850], // command plants
  [1028, 628, 1078, 850], // stairs
  [240, 682, 420, 748], // sofa
  [195, 650, 275, 712], // fireplace
  [180, 742, 242, 804], // cactus
  [262, 752, 385, 818], // coffee table
  [440, 645, 510, 778], // lounge plant
  [75, 755, 135, 835], // lounge cylinder
  [55, 535, 115, 615], // research plant
  [812, 295, 852, 335], // core hazard device
  [848, 115, 866, 330], // core/security divider pole
  [1095, 240, 1165, 330], // vault plant
  [55, 235, 120, 330], // code lab plant
];

// Art patches redrawn over characters standing behind them (feet above `base`).
export interface Occluder { box: Box; base: number }
export const OCCLUDERS: Occluder[] = [
  { box: [553, 640, 580, 846], base: 846 }, // lounge right wall
  { box: [1076, 580, 1100, 850], base: 850 }, // automation left wall
  { box: [1084, 115, 1096, 342], base: 342 }, // vault left wall
  { box: [608, 486, 684, 594], base: 594 }, // command chair left
  { box: [906, 486, 980, 594], base: 594 }, // command chair right
  { box: [955, 645, 1015, 745], base: 745 },
  { box: [970, 795, 1020, 850], base: 850 },
  { box: [240, 682, 420, 748], base: 748 },
  { box: [180, 742, 242, 804], base: 804 },
  { box: [262, 752, 385, 818], base: 818 },
  { box: [440, 645, 510, 778], base: 778 },
  { box: [55, 535, 115, 615], base: 615 },
  { box: [1095, 240, 1165, 330], base: 330 },
];

export type StationKind = 'work' | 'coffee' | 'meeting' | 'wander';
export interface Station extends Pt { kind: StationKind; facing: 'left' | 'right' | 'down'; label: string }

export const STATIONS: Record<string, Station> = {
  codeA: { x: 335, y: 322, kind: 'work', facing: 'down', label: 'Code Lab desk A' },
  codeB: { x: 470, y: 322, kind: 'work', facing: 'down', label: 'Code Lab desk B' },
  codeC: { x: 200, y: 322, kind: 'work', facing: 'down', label: 'Code Lab desk C' },
  research: { x: 270, y: 596, kind: 'work', facing: 'down', label: 'Research desk' },
  researchShelf: { x: 420, y: 560, kind: 'work', facing: 'down', label: 'Research archive' },
  core: { x: 720, y: 330, kind: 'work', facing: 'down', label: 'AI Core' },
  sec: { x: 960, y: 296, kind: 'work', facing: 'down', label: 'Security console' },
  secRack: { x: 905, y: 296, kind: 'work', facing: 'down', label: 'Security rack' },
  vaultA: { x: 1250, y: 326, kind: 'work', facing: 'down', label: 'Server vault' },
  vaultB: { x: 1350, y: 326, kind: 'work', facing: 'down', label: 'Server vault' },
  data: { x: 1200, y: 566, kind: 'work', facing: 'down', label: 'Data dashboards' },
  dataB: { x: 1330, y: 566, kind: 'work', facing: 'down', label: 'Analytics station' },
  cmd: { x: 800, y: 622, kind: 'work', facing: 'down', label: 'Command table' },
  auto: { x: 1225, y: 738, kind: 'work', facing: 'down', label: 'Robotics rig' },
  autoB: { x: 1310, y: 738, kind: 'work', facing: 'down', label: 'Automation console' },
  autoArm: { x: 1400, y: 742, kind: 'work', facing: 'down', label: 'Robot arm bay' },
  coffee1: { x: 200, y: 828, kind: 'coffee', facing: 'right', label: 'Lounge' },
  coffee2: { x: 330, y: 832, kind: 'coffee', facing: 'down', label: 'Lounge coffee table' },
  coffee3: { x: 480, y: 818, kind: 'coffee', facing: 'left', label: 'Lounge' },
  coffee4: { x: 410, y: 770, kind: 'coffee', facing: 'left', label: 'Lounge' },
  meet1: { x: 660, y: 650, kind: 'meeting', facing: 'right', label: 'Command briefing' },
  meet2: { x: 740, y: 705, kind: 'meeting', facing: 'right', label: 'Command briefing' },
  meet3: { x: 860, y: 705, kind: 'meeting', facing: 'left', label: 'Command briefing' },
  meet4: { x: 935, y: 650, kind: 'meeting', facing: 'left', label: 'Command briefing' },
  meet5: { x: 800, y: 770, kind: 'meeting', facing: 'down', label: 'Command briefing' },
  hubL: { x: 550, y: 480, kind: 'wander', facing: 'down', label: 'West lane' },
  hubR: { x: 1010, y: 470, kind: 'wander', facing: 'down', label: 'East lane' },
  hubB: { x: 700, y: 790, kind: 'wander', facing: 'down', label: 'Command floor' },
  hubB2: { x: 900, y: 790, kind: 'wander', facing: 'down', label: 'Command floor' },
  hallW: { x: 650, y: 334, kind: 'wander', facing: 'down', label: 'North corridor' },
  hallE: { x: 1120, y: 341, kind: 'wander', facing: 'down', label: 'North corridor' },
};

// Rooms a task force can claim (WORKING_GROUP). One room per task force; members take its seats.
export interface GroupRoom { id: string; label: string; seats: string[] }
export const GROUP_ROOMS: GroupRoom[] = [
  { id: 'command', label: 'Command briefing table', seats: ['meet1', 'meet2', 'meet3', 'meet4', 'meet5'] },
  { id: 'lounge', label: 'Lounge', seats: ['coffee1', 'coffee2', 'coffee3', 'coffee4'] },
];

// Named areas for the "Current location" readout; first match wins.
export const ZONES: [string, Box][] = [
  ['Lounge', [60, 640, 600, 860]],
  ['Code Lab', [60, 115, 560, 340]],
  ['AI Core', [606, 115, 850, 340]],
  ['Security', [850, 115, 1090, 340]],
  ['Server Vault', [1090, 115, 1560, 340]],
  ['Research Lab', [60, 345, 490, 640]],
  ['Data Lab', [1060, 340, 1560, 585]],
  ['Automation Bay', [1075, 585, 1560, 860]],
  ['Command Center', [480, 340, 1075, 860]],
];

export const zoneAt = (p: Pt) => ZONES.find(([, [x0, y0, x1, y1]]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)?.[0] ?? 'Corridor';

// Live HUD overlays painted onto the artwork's own header/footer.
export const HUD = {
  units: { cover: [1447, 54, 1578, 79] as Box, center: { x: 1512, y: 66 } },
  grid: { cover: [318, 886, 545, 924] as Box, dot: [325, 897, 342, 914] as Box, textX: 358, y: 906 },
  busy: { x: 640, y: 906 },
  chat: [1368, 873, 1590, 937] as Box,
};
