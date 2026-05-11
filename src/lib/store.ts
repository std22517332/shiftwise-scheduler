
import { Staff, RosterStore, RosterPeriod, CalendarOccasion } from './types';
import { DailySchedule } from '@/ai/flows/generate-staff-roster-flow';
import {
  attachShiftMutationMeta,
  createMutationId,
  createShiftMutationMeta,
  logRosterMutation,
  type AssignmentWithMutationMeta,
  type ShiftMutationMetaDraft,
} from './roster-mutation-meta';

const STORAGE_KEY = 'shiftwise_v15_local_db';

const DEFAULT_DATA: RosterStore = {
  staff: [],
  holidays: [],
  extraPeakDays: [],
  occasions: [],
  activeRoster: null,
  history: [],
};

export function getStore(): RosterStore {
  if (typeof window === 'undefined') return DEFAULT_DATA;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_DATA;
  try {
    const parsed = JSON.parse(stored);
    let hasMigration = false;
    if (!parsed.history) parsed.history = [];
    if (!parsed.holidays) parsed.holidays = [];
    if (!parsed.extraPeakDays) parsed.extraPeakDays = [];
    if (!parsed.occasions) parsed.occasions = [];
    if (!parsed.staff) parsed.staff = [];

    parsed.staff = parsed.staff.map((member: Staff) => {
      if (member.weeklyOffDays === 1 || member.weeklyOffDays === 1.5) return member;
      hasMigration = true;
      return {
        ...member,
        weeklyOffDays: member.department === 'Housekeeping' ? 1 : 1.5,
      };
    });

    // Backward compatibility: older data may only have `holidays`.
    // Migrate those dates into `occasions` so Config and Dashboard stay in sync.
    if (parsed.occasions.length === 0 && parsed.holidays.length > 0) {
      parsed.occasions = parsed.holidays.map((date: string) => ({
        date,
        title: 'Holiday',
        isHoliday: true,
      }));
      hasMigration = true;
    }

    if (hasMigration) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }

    return parsed;
  } catch (e) {
    return DEFAULT_DATA;
  }
}

export function saveStore(data: RosterStore) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function updateStaff(staff: Staff[]) {
  const store = getStore();
  store.staff = staff;
  saveStore(store);
}

export function updateHolidays(holidays: string[]) {
  const store = getStore();
  store.holidays = holidays;
  saveStore(store);
}

export function updateExtraPeakDays(extra: string[]) {
  const store = getStore();
  store.extraPeakDays = extra;
  saveStore(store);
}

export function updateOccasions(occasions: CalendarOccasion[]) {
  const store = getStore();
  store.occasions = occasions;
  store.holidays = occasions.filter((o) => o.isHoliday).map((o) => o.date);
  saveStore(store);
}

export function saveActiveRoster(roster: RosterPeriod) {
  const store = getStore();
  store.activeRoster = roster;
  saveStore(store);
}

export function archiveCurrentRoster() {
  const store = getStore();
  if (store.activeRoster) {
    const rosterToArchive = { ...store.activeRoster, status: 'PUBLISHED' as const };
    store.history = [rosterToArchive, ...store.history];
    store.activeRoster = null;
    saveStore(store);
  }
}

function applyShiftUpdateWithMeta(
  schedules: DailySchedule[],
  dayIdx: number,
  assignIdx: number,
  newType: unknown,
  staffName: string,
  mutationDraft?: ShiftMutationMetaDraft
) {
  const cell = schedules[dayIdx].assignments[assignIdx] as AssignmentWithMutationMeta;
  cell.shiftType = newType as AssignmentWithMutationMeta['shiftType'];
  const draft: ShiftMutationMetaDraft = mutationDraft ?? {
    origin: 'manual_override',
    actor: staffName,
    relatedStaff: [staffName],
    notes: 'Shift cell update (table or history)',
  };
  const meta = createShiftMutationMeta({
    ...draft,
    actor: draft.actor ?? staffName,
    relatedStaff: draft.relatedStaff ?? [staffName],
  });
  attachShiftMutationMeta(cell, meta);
}

export function updateRosterShift(
  rosterId: string,
  date: string,
  staffName: string,
  newType: any,
  mutationDraft?: ShiftMutationMetaDraft
) {
  const store = getStore();

  if (store.activeRoster?.id === rosterId) {
    const dayIdx = store.activeRoster.schedules.findIndex((s) => s.date === date);
    if (dayIdx !== -1) {
      const assignIdx = store.activeRoster.schedules[dayIdx].assignments.findIndex((a) => a.staffName === staffName);
      if (assignIdx !== -1) {
        applyShiftUpdateWithMeta(store.activeRoster.schedules, dayIdx, assignIdx, newType, staffName, mutationDraft);
        store.activeRoster.lastModifiedAt = new Date().toISOString();
        saveStore(store);
        logRosterMutation('updateRosterShift', { rosterId, date, staffName, origin: mutationDraft?.origin ?? 'manual_override' });
        return;
      }
    }
  }

  const historyIdx = store.history.findIndex((h) => h.id === rosterId);
  if (historyIdx !== -1) {
    const dayIdx = store.history[historyIdx].schedules.findIndex((s) => s.date === date);
    if (dayIdx !== -1) {
      const assignIdx = store.history[historyIdx].schedules[dayIdx].assignments.findIndex((a) => a.staffName === staffName);
      if (assignIdx !== -1) {
        applyShiftUpdateWithMeta(store.history[historyIdx].schedules, dayIdx, assignIdx, newType, staffName, mutationDraft);
        store.history[historyIdx].lastModifiedAt = new Date().toISOString();
        saveStore(store);
        logRosterMutation('updateRosterShift', { rosterId, date, staffName, history: true, origin: mutationDraft?.origin ?? 'manual_override' });
      }
    }
  }
}

export function swapWeeklyPatterns(rosterId: string, weekDates: string[], staffAName: string, staffBName: string) {
  const store = getStore();
  const staffA = store.staff.find(s => s.name === staffAName);
  const staffB = store.staff.find(s => s.name === staffBName);
  
  if (!staffA || !staffB) return;

  const swapPair = [staffAName, staffBName];
  const linkedPatternId = createMutationId();
  const swapTs = new Date().toISOString();

  const applySwap = (roster: RosterPeriod) => {
    weekDates.forEach((date) => {
      const dayIdx = roster.schedules.findIndex((s) => s.date === date);
      if (dayIdx !== -1) {
        const schedule = roster.schedules[dayIdx];
        const idxA = schedule.assignments.findIndex((a) => a.staffName === staffAName);
        const idxB = schedule.assignments.findIndex((a) => a.staffName === staffBName);

        if (idxA !== -1 && idxB !== -1) {
          let typeA = schedule.assignments[idxA].shiftType;
          let typeB = schedule.assignments[idxB].shiftType;

          // Swap logic with FixedDay protection (local roster uses Day/Night/OFF/H*; widen for TS)
          let nextA: unknown = typeB;
          let nextB: unknown = typeA;

          if (staffA.shiftPreference === 'Day' && staffB.shiftPreference !== 'Day') {
            if (String(nextA).includes('Night')) {
              nextA = 'Day'; // Keep Ali on Day
              nextB = 'Night'; // Keep Rotational on Night
            }
          } else if (staffB.shiftPreference === 'Day' && staffA.shiftPreference !== 'Day') {
            if (String(nextB).includes('Night')) {
              nextB = 'Day';
              nextA = 'Night';
            }
          }

          const cellA = schedule.assignments[idxA] as AssignmentWithMutationMeta;
          const cellB = schedule.assignments[idxB] as AssignmentWithMutationMeta;
          cellA.shiftType = nextA as AssignmentWithMutationMeta['shiftType'];
          cellB.shiftType = nextB as AssignmentWithMutationMeta['shiftType'];

          attachShiftMutationMeta(
            cellA,
            createShiftMutationMeta({
              origin: 'pattern_swap',
              timestamp: swapTs,
              linkedPatternId,
              relatedStaff: swapPair,
              notes: `Pattern swap with ${staffBName} (${date})`,
            })
          );
          attachShiftMutationMeta(
            cellB,
            createShiftMutationMeta({
              origin: 'pattern_swap',
              timestamp: swapTs,
              linkedPatternId,
              relatedStaff: swapPair,
              notes: `Pattern swap with ${staffAName} (${date})`,
            })
          );
        }
      }
    });
    roster.lastModifiedAt = new Date().toISOString();
  };

  if (store.activeRoster?.id === rosterId) {
    applySwap(store.activeRoster);
    saveStore(store);
    logRosterMutation('swapWeeklyPatterns', { rosterId, linkedPatternId, staff: swapPair });
  } else {
    const historyIdx = store.history.findIndex((h) => h.id === rosterId);
    if (historyIdx !== -1) {
      applySwap(store.history[historyIdx]);
      saveStore(store);
      logRosterMutation('swapWeeklyPatterns', { rosterId, linkedPatternId, staff: swapPair, history: true });
    }
  }
}

export function exportStoreData(): string {
  if (typeof window === 'undefined') return '{}';
  return localStorage.getItem(STORAGE_KEY) || JSON.stringify(DEFAULT_DATA);
}

export function importStoreData(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && ('staff' in parsed || 'activeRoster' in parsed)) {
      localStorage.setItem(STORAGE_KEY, json);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export function resetSchedulingData(options: { resetEmployees: boolean; resetConfig: boolean }) {
  const store = getStore();
  store.activeRoster = null;
  store.history = [];
  if (options.resetEmployees) store.staff = [...DEFAULT_DATA.staff];
  if (options.resetConfig) {
    store.holidays = [];
    store.extraPeakDays = [];
    store.occasions = [];
  }
  saveStore(store);
}
