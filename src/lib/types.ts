
import { StaffProfile, DailySchedule } from '@/ai/flows/generate-staff-roster-flow';

/** Roster assignment mutation provenance (also export from `roster-mutation-meta`). */
export type {
  MutationOrigin,
  ShiftMutationMeta,
  ShiftMutationMetaDraft,
  AssignmentWithMutationMeta,
} from './roster-mutation-meta';

export { logRosterMutation, getAssignmentMutationMeta } from './roster-mutation-meta';

export type StaffRole = 'FixedDay' | 'FixedNight' | 'Rotational' | 'StudentFixed';
export type GuaranteedOffFrequency = 'none' | 'weekly' | 'monthly';
export type WeeklyOffDays = 1 | 1.5;
export type StudentPatternMode = 'academic' | 'summer';
export type StudentWeeklyPattern = Partial<Record<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday', 'Day' | 'Night'>>;

export type Staff = StaffProfile & {
  id: string;
  role: StaffRole;
  guaranteedOffDay?: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  guaranteedOffFrequency?: GuaranteedOffFrequency;
  weeklyOffDays?: WeeklyOffDays;
  studentPatternMode?: StudentPatternMode;
  studentWeeklyPattern?: StudentWeeklyPattern;
};

export type Department = StaffProfile['department'];
export type ShiftType = StaffProfile['shiftPreference'];
export interface CalendarOccasion {
  date: string; // yyyy-MM-dd
  title: string;
  isHoliday: boolean;
}

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
  occasions?: CalendarOccasion[];
  activeRoster: RosterPeriod | null;
  history: RosterPeriod[];
}
