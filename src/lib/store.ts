
import { Staff, RosterStore, RosterPeriod } from './types';
import { DailySchedule } from '@/ai/flows/generate-staff-roster-flow';

const STORAGE_KEY = 'shiftwise_v15_local_db';

const DEFAULT_DATA: RosterStore = {
  staff: [
    { id: '1', name: 'Ali Rezayi', department: 'Reservation', shiftPreference: 'Day', isSenior: true, defaultOffDay: 'Monday', role: 'FixedDay' },
    { id: '2', name: 'Sara Mohammadi', department: 'Reservation', shiftPreference: 'Night', isSenior: true, defaultOffDay: 'Tuesday', role: 'FixedNight' },
    { id: '3', name: 'Hassan Alavi', department: 'Reservation', shiftPreference: 'Rotational', isSenior: false, defaultOffDay: 'Wednesday', role: 'Rotational' },
    { id: '4', name: 'Maryam Rad', department: 'Reservation', shiftPreference: 'Rotational', isSenior: false, defaultOffDay: 'Thursday', role: 'Rotational' },
    { id: '5', name: 'Reza Karimi', department: 'Reservation', shiftPreference: 'Rotational', isSenior: false, defaultOffDay: 'Friday', role: 'Rotational' },
    { id: '6', name: 'Fatemeh Zahra', department: 'Reservation', shiftPreference: 'Rotational', isSenior: false, defaultOffDay: 'Saturday', role: 'Rotational' },
    { id: '7', name: 'Babak Zanjani', department: 'Reservation', shiftPreference: 'Rotational', isSenior: false, defaultOffDay: 'Sunday', role: 'Rotational' },
  ],
  holidays: [],
  extraPeakDays: [],
  activeRoster: null,
  history: [],
};

export function getStore(): RosterStore {
  if (typeof window === 'undefined') return DEFAULT_DATA;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_DATA;
  try {
    const parsed = JSON.parse(stored);
    if (!parsed.history) parsed.history = [];
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

export function updateRosterShift(rosterId: string, date: string, staffName: string, newType: any) {
  const store = getStore();
  
  if (store.activeRoster?.id === rosterId) {
    const dayIdx = store.activeRoster.schedules.findIndex(s => s.date === date);
    if (dayIdx !== -1) {
      const assignIdx = store.activeRoster.schedules[dayIdx].assignments.findIndex(a => a.staffName === staffName);
      if (assignIdx !== -1) {
        store.activeRoster.schedules[dayIdx].assignments[assignIdx].shiftType = newType;
        store.activeRoster.lastModifiedAt = new Date().toISOString();
        saveStore(store);
        return;
      }
    }
  }

  const historyIdx = store.history.findIndex(h => h.id === rosterId);
  if (historyIdx !== -1) {
    const dayIdx = store.history[historyIdx].schedules.findIndex(s => s.date === date);
    if (dayIdx !== -1) {
      const assignIdx = store.history[historyIdx].schedules[dayIdx].assignments.findIndex(a => a.staffName === staffName);
      if (assignIdx !== -1) {
        store.history[historyIdx].schedules[dayIdx].assignments[assignIdx].shiftType = newType;
        store.history[historyIdx].lastModifiedAt = new Date().toISOString();
        saveStore(store);
      }
    }
  }
}

export function swapWeeklyPatterns(rosterId: string, weekDates: string[], staffAName: string, staffBName: string) {
  const store = getStore();
  const staffA = store.staff.find(s => s.name === staffAName);
  const staffB = store.staff.find(s => s.name === staffBName);
  
  if (!staffA || !staffB) return;

  const applySwap = (roster: RosterPeriod) => {
    weekDates.forEach(date => {
      const dayIdx = roster.schedules.findIndex(s => s.date === date);
      if (dayIdx !== -1) {
        const schedule = roster.schedules[dayIdx];
        const idxA = schedule.assignments.findIndex(a => a.staffName === staffAName);
        const idxB = schedule.assignments.findIndex(a => a.staffName === staffBName);
        
        if (idxA !== -1 && idxB !== -1) {
          let typeA = schedule.assignments[idxA].shiftType;
          let typeB = schedule.assignments[idxB].shiftType;

          // Swap logic with FixedDay protection
          let nextA = typeB;
          let nextB = typeA;

          if (staffA.shiftPreference === 'Day' && staffB.shiftPreference !== 'Day') {
            if (nextA.includes('Night')) {
              nextA = 'Day'; // Keep Ali on Day
              nextB = 'Night'; // Keep Rotational on Night
            }
          } else if (staffB.shiftPreference === 'Day' && staffA.shiftPreference !== 'Day') {
            if (nextB.includes('Night')) {
              nextB = 'Day';
              nextA = 'Night';
            }
          }

          schedule.assignments[idxA].shiftType = nextA as any;
          schedule.assignments[idxB].shiftType = nextB as any;
        }
      }
    });
    roster.lastModifiedAt = new Date().toISOString();
  };

  if (store.activeRoster?.id === rosterId) {
    applySwap(store.activeRoster);
    saveStore(store);
  } else {
    const historyIdx = store.history.findIndex(h => h.id === rosterId);
    if (historyIdx !== -1) {
      applySwap(store.history[historyIdx]);
      saveStore(store);
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
  }
  saveStore(store);
}
