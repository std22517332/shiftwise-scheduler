
import { DailySchedule, ShiftAssignment } from '@/ai/flows/generate-staff-roster-flow';
import { Staff } from '@/lib/types';
import { format, addDays, parseISO, eachDayOfInterval, getDay } from 'date-fns';

/**
 * CORE ROSTER LOGIC V48.0 - Perfect Dynamic Rotation
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_MAP: Record<string, number> = {
  'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6
};

/**
 * Generates the roster with weekly forward rotation (one day per week).
 */
export function generateLocalRoster(
  staffList: Staff[],
  holidays: string[],
  extraPeakDays: string[],
  startDateStr: string,
  endDateStr: string,
  initialWeekOffset: number = 0
): { generatedSchedule: DailySchedule[]; warnings: string[] } {
  const startDate = parseISO(startDateStr);
  const endDate = parseISO(endDateStr);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  
  const schedule: DailySchedule[] = [];
  const warnings: string[] = [];

  // Tracks rotational night count for fairness within the block
  const nightShiftCounter: Record<string, number> = {};
  staffList.forEach(s => nightShiftCounter[s.name] = 0);

  // Phase 1: Determine pattern-based shifts
  days.forEach((day, dayIdx) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const weekIdx = Math.floor(dayIdx / 7) + initialWeekOffset;
    const dayInWeekIdx = (getDay(day) + 6) % 7; // Convert to Mon=0...Sun=6

    const dailyAssignments: ShiftAssignment[] = staffList.map((staff) => {
      // Rotation: Each week, the pattern shifts one day to the right
      const baseOffIdx = DAY_MAP[staff.defaultOffDay] ?? 0;
      const rotatedDayOffIdx = (baseOffIdx + weekIdx) % 7;
      
      // 3-day gap between Full OFF and Half OFF
      const rotatedHalfOffIdx = (rotatedDayOffIdx + 4) % 7; 

      let shiftType: 'Day' | 'Night' | 'OFF' | 'H1-OFF' | 'H2-OFF' = 'Day';

      // Assign rest days
      if (dayInWeekIdx === rotatedDayOffIdx) {
        shiftType = 'OFF';
      } else if (dayInWeekIdx === rotatedHalfOffIdx) {
        shiftType = 'H2-OFF';
      } else {
        // Set default based on preference
        shiftType = staff.shiftPreference === 'Night' ? 'Night' : 'Day';
      }

      // Night connectivity logic for Rotational/Night staff
      // A Night shift is assigned the day BEFORE any rest period
      const tomorrowInWeekIdx = (dayInWeekIdx + 1) % 7;
      const isTomorrowRest = (tomorrowInWeekIdx === rotatedDayOffIdx || tomorrowInWeekIdx === rotatedHalfOffIdx);
      
      if (isTomorrowRest && staff.shiftPreference !== 'Day' && shiftType !== 'OFF') {
        shiftType = 'Night';
      }

      // Absolute Protection: Fixed Day preference staff NEVER assigned Night
      if (staff.shiftPreference === 'Day' && shiftType === 'Night') {
        shiftType = 'Day';
      }

      if (shiftType === 'Night') nightShiftCounter[staff.name]++;

      return {
        staffName: staff.name,
        department: staff.department,
        isSenior: staff.isSenior,
        shiftType: shiftType as any
      };
    });

    schedule.push({
      date: dateStr,
      dayOfWeek: DAY_NAMES[dayInWeekIdx],
      isPeakDay: [4, 5, 6].includes(dayInWeekIdx) || holidays.includes(dateStr) || extraPeakDays.includes(dateStr),
      assignments: dailyAssignments
    });
  });

  // Phase 2: Mandatory 2-Person Night Coverage with Fairness
  schedule.forEach((day) => {
    const nightAssignments = day.assignments.filter(a => a.shiftType.includes('Night'));
    let currentNightCount = nightAssignments.length;
    
    if (currentNightCount < 2) {
      const needed = 2 - currentNightCount;
      
      // Candidates are Rotational staff NOT already on Night/OFF and eligible for duty
      const candidates = day.assignments.filter(a => {
        const staff = staffList.find(s => s.name === a.staffName);
        return staff && staff.shiftPreference === 'Rotational' && a.shiftType === 'Day';
      });

      // Fairness: Sort candidates by those who have worked the fewest nights so far in this block
      candidates.sort((a, b) => (nightShiftCounter[a.staffName] || 0) - (nightShiftCounter[b.staffName] || 0));

      for (let i = 0; i < Math.min(needed, candidates.length); i++) {
        const target = candidates[i];
        target.shiftType = 'Night' as any;
        nightShiftCounter[target.staffName]++;
      }
    }
  });

  return { generatedSchedule: schedule, warnings };
}
