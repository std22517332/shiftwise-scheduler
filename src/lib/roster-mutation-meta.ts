/**
 * Lightweight mutation metadata on shift assignments (incremental; no full architecture rewrite).
 * Stored on each assignment as optional `shiftMutationMeta`.
 */

import type { DailySchedule } from '@/ai/flows/generate-staff-roster-flow';

export type MutationOrigin =
  | 'generator'
  | 'manual_override'
  | 'pair_swap'
  | 'pattern_swap'
  | 'auto_repair'
  | 'future_propagation';

export interface ShiftMutationMeta {
  id: string;
  origin: MutationOrigin;
  actor?: string;
  timestamp: string;
  affectsFuture?: boolean;
  propagated?: boolean;
  linkedPatternId?: string;
  relatedStaff?: string[];
  notes?: string;
}

/** Fields client code supplies; id/timestamp optional (filled by factory). */
export type ShiftMutationMetaDraft = Omit<ShiftMutationMeta, 'id' | 'timestamp'> &
  Partial<Pick<ShiftMutationMeta, 'id' | 'timestamp'>>;

export function createMutationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mut_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createShiftMutationMeta(draft: ShiftMutationMetaDraft): ShiftMutationMeta {
  return {
    id: draft.id ?? createMutationId(),
    timestamp: draft.timestamp ?? new Date().toISOString(),
    origin: draft.origin,
    actor: draft.actor,
    affectsFuture: draft.affectsFuture,
    propagated: draft.propagated,
    linkedPatternId: draft.linkedPatternId,
    relatedStaff: draft.relatedStaff,
    notes: draft.notes,
  };
}

/** Assignment shape used in local store / generator (extends flow type with optional meta). */
export type AssignmentWithMutationMeta = {
  staffName: string;
  shiftType: unknown;
  shiftMutationMeta?: ShiftMutationMeta;
  [key: string]: unknown;
};

/** Safe read of persisted mutation metadata (unknown / legacy assignments). */
export function getAssignmentMutationMeta(assignment: unknown): ShiftMutationMeta | undefined {
  if (!assignment || typeof assignment !== 'object') return undefined;
  const raw = (assignment as AssignmentWithMutationMeta).shiftMutationMeta;
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as unknown as Record<string, unknown>;
  if (
    typeof m.id !== 'string' ||
    typeof m.origin !== 'string' ||
    typeof m.timestamp !== 'string'
  ) {
    return undefined;
  }
  return raw as ShiftMutationMeta;
}

/**
 * Inset ring when mutation debug is on. Includes width + inset so Tailwind actually draws the ring.
 * Using `ring-4` temporarily for easier debugging visibility (switch back to `ring-2` when done).
 */
export function getMutationOriginRingClass(origin: MutationOrigin): string {
  switch (origin) {
    case 'generator':
      return 'ring-4 ring-inset ring-zinc-400/35';
    case 'manual_override':
      return 'ring-4 ring-inset ring-blue-500/55';
    case 'pattern_swap':
    case 'pair_swap':
      return 'ring-4 ring-inset ring-violet-500/55';
    case 'auto_repair':
      return 'ring-4 ring-inset ring-amber-500/60';
    case 'future_propagation':
      return 'ring-4 ring-inset ring-teal-500/55';
  }
}

export function attachShiftMutationMeta(
  assignment: AssignmentWithMutationMeta,
  meta: ShiftMutationMeta,
  logContext?: string
): void {
  assignment.shiftMutationMeta = meta;
  if (logContext) {
    logRosterMutation(logContext, {
      staffName: assignment.staffName,
      origin: meta.origin,
      mutationId: meta.id,
    });
  }
}

/** Snapshot shift types after phase-1 schedule build (date + staff → shiftType string). */
export function buildShiftTypeSnapshot(schedule: DailySchedule[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of schedule) {
    for (const a of d.assignments) {
      m.set(`${d.date}::${a.staffName}`, String(a.shiftType));
    }
  }
  return m;
}

/**
 * After full generation: unchanged vs phase-1 → `generator`; changed → `auto_repair`.
 */
export function applyPostGenerationMutationTags(schedule: DailySchedule[], phase1Snapshot: Map<string, string>): void {
  const baseTs = new Date().toISOString();
  let generatorCount = 0;
  let repairCount = 0;
  for (const d of schedule) {
    for (const a of d.assignments) {
      const key = `${d.date}::${a.staffName}`;
      const before = phase1Snapshot.get(key);
      const now = String(a.shiftType);
      const unchanged = before !== undefined && before === now;
      const meta = createShiftMutationMeta({
        timestamp: baseTs,
        origin: unchanged ? 'generator' : 'auto_repair',
        notes: unchanged
          ? undefined
          : 'Adjusted during schedule generation (coverage, housekeeping, convergence, or fairness).',
      });
      attachShiftMutationMeta(a as AssignmentWithMutationMeta, meta);
      if (unchanged) generatorCount++;
      else repairCount++;
    }
  }
  logRosterMutation('post_generation_tags', {
    days: schedule.length,
    generatorCells: generatorCount,
    autoRepairCells: repairCount,
  });
}

/** Stamp each assignment in a slice of schedules (e.g. spliced propagation window). */
export function stampAssignmentsWithDraft(
  schedules: DailySchedule[],
  dayStartInclusive: number,
  dayEndExclusive: number,
  draft: ShiftMutationMetaDraft
): void {
  const ts = draft.timestamp ?? new Date().toISOString();
  for (let i = dayStartInclusive; i < dayEndExclusive && i < schedules.length; i++) {
    for (const a of schedules[i].assignments) {
      const meta = createShiftMutationMeta({ ...draft, timestamp: ts });
      attachShiftMutationMeta(a as AssignmentWithMutationMeta, meta);
    }
  }
  logRosterMutation('batch_stamp', {
    origin: draft.origin,
    dayStartInclusive,
    dayEndExclusive,
    affectsFuture: draft.affectsFuture,
    propagated: draft.propagated,
  });
}

/** Temporary dev helper for inspecting mutation flow. */
export function logRosterMutation(step: string, detail?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  const log = typeof console !== 'undefined' ? console.debug.bind(console) : () => {};
  log(`[RosterMutation] ${step}`, detail ?? '');
}
