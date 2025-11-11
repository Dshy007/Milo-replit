// Bench contract seeding data
// Each contract represents a specific (type, startTime, tractor) combination

export interface BenchContract {
  type: "solo1" | "solo2";
  startTime: string; // HH:MM format
  tractorId: string;
  duration: number; // hours
  baseRoutes: number;
}

// Solo1 Contracts (14h duration, 10 base routes)
const solo1Contracts: BenchContract[] = [
  { type: "solo1", startTime: "00:30", tractorId: "Tractor_8", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "01:30", tractorId: "Tractor_6", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "16:30", tractorId: "Tractor_1", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "16:30", tractorId: "Tractor_9", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "17:30", tractorId: "Tractor_4", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "18:30", tractorId: "Tractor_7", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_10", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_2", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_3", duration: 14, baseRoutes: 10 },
  { type: "solo1", startTime: "21:30", tractorId: "Tractor_5", duration: 14, baseRoutes: 10 },
];

// Solo2 Contracts (38h duration, 7 base routes)
const solo2Contracts: BenchContract[] = [
  { type: "solo2", startTime: "08:30", tractorId: "Tractor_4", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "11:30", tractorId: "Tractor_6", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "15:30", tractorId: "Tractor_5", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "16:30", tractorId: "Tractor_7", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "18:30", tractorId: "Tractor_1", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "21:30", tractorId: "Tractor_3", duration: 38, baseRoutes: 7 },
  { type: "solo2", startTime: "23:30", tractorId: "Tractor_2", duration: 38, baseRoutes: 7 },
];

// All bench contracts (17 total: 10 Solo1 + 7 Solo2)
export const benchContracts: BenchContract[] = [
  ...solo1Contracts,
  ...solo2Contracts,
];
