
import { StaffProfile, DailySchedule } from '@/ai/flows/generate-staff-roster-flow';

export type StaffRole = 'FixedDay' | 'FixedNight' | 'Rotational';

export type Staff = StaffProfile & {
  id: string;
  role: StaffRole;
};

export type Department = StaffProfile['department'];
export type ShiftType = StaffProfile['shiftPreference'];

export type RosterStatus = 'DRAFT' | 'PUBLISHED';

export interface RosterPeriod {
  id: string;
  startDate: string;
  endDate: string;
  status: RosterStatus;
  generatedAt: string;
  lastModifiedAt: string;
  schedules: DailySchedule[];
}

export interface RosterStore {
  staff: Staff[];
  holidays: string[];
  extraPeakDays: string[];
  activeRoster: RosterPeriod | null;
  history: RosterPeriod[];
}
