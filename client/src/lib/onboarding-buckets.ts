export const ONBOARDING_BUCKETS = [
  { num: 1, name: "Fountain Application", desc: "Initial application submitted" },
  { num: 2, name: "Sentix Screening", desc: "Background and MVR screening" },
  { num: 3, name: "SambaSafety", desc: "Safety training enrollment" },
  { num: 4, name: "Safety Videos", desc: "Required video training" },
  { num: 5, name: "Onboarding Core Training", desc: "Freedom Transportation core curriculum" },
  { num: 6, name: "JJ Keller", desc: "FMCSA compliance certification" },
  { num: 7, name: "Aaron Miller", desc: "Insurance verification" },
  { num: 8, name: "DataSense", desc: "Driver data entry" },
  { num: 9, name: "Amazon Relay", desc: "Relay account provisioning" },
  { num: 10, name: "DQF / Dispatch", desc: "Driver Qualification File complete, ready to dispatch" },
] as const;

export type OnboardingBucket = typeof ONBOARDING_BUCKETS[number];

export const getBucketByNumber = (num: number | null | undefined) =>
  num ? ONBOARDING_BUCKETS.find(b => b.num === num) : undefined;
