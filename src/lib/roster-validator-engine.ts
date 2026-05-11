/**
 * Stand-alone roster validators (read-only checks).
 * Rules mirror invariant comments in roster-algorithm without importing or modifying generator logic.
 */

import type { DailySchedule, ShiftAssignment } from '@/ai/flows/generate-staff-roster-flow';
import type { Staff } from '@/lib/types';

const MIN_GLOBAL_NIGHT_ASSIGNMENTS_PER_DAY = 2;

function shiftStr(a: ShiftAssignment): string {
  return String(a.shiftType);
}

function getAssignment(day: DailySchedule, staffName: string): ShiftAssignment | undefined {
  return day.assignments.find((a) => a.staffName === staffName);
}

function isNightAssignment(st: string): boolean {
  return st.includes('Night');
}

function isFullOffDay(st: string): boolean {
  return st === 'OFF';
}

function isHalfOffSlot(st: string): boolean {
  return st.includes('H1-OFF') || st.includes('H2-OFF');
}

function isPostNightRecoveryRest(st: string): boolean {
  return isFullOffDay(st) || isHalfOffSlot(st);
}

function shiftWeeklyRestCredit(st: string): number {
  if (isFullOffDay(st)) return 1;
  if (isHalfOffSlot(st)) return 0.5;
  return 0;
}

function weeklyOffCreditsForSlice(
  schedule: DailySchedule[],
  weekStartIdx: number,
  weekEndExclusive: number,
  staffName: string
): number {
  let sum = 0;
  for (let i = weekStartIdx; i < weekEndExclusive; i++) {
    const ax = getAssignment(schedule[i], staffName);
    if (!ax) continue;
    sum += shiftWeeklyRestCredit(shiftStr(ax));
  }
  return sum;
}

function getRequiredWeeklyOff(staff: Staff): 1 | 1.5 {
  if (staff.weeklyOffDays === 1 || staff.weeklyOffDays === 1.5) return staff.weeklyOffDays;
  return staff.department === 'Housekeeping' ? 1 : 1.5;
}

function reservationRotationalPool(staffList: Staff[]): string[] {
  return staffList.filter((s) => s.department === 'Reservation' && s.shiftPreference === 'Rotational').map((s) => s.name);
}

/** Same eligibility as spreadDeptSeparateFullOffAnchors targets (anchors), applied to validating realized OFF layout. */
function isOffDiversityEligible(staff: Staff): boolean {
  if (staff.shiftPreference === 'StudentFixed') return false;
  if ((staff.guaranteedOffFrequency ?? 'none') === 'weekly') return false;
  return true;
}

/** --- Output types -------------------------------------------------------- */

export type ValidatorId =
  | 'exactOffCount'
  | 'nightCoverage'
  | 'nightRecovery'
  | 'sundayFairness'
  | 'rotationalNightBalance'
  | 'offDiversity';

export type ViolationSeverity = 'error' | 'warning';

export interface RosterViolation {
  validator: ValidatorId;
  code: string;
  severity: ViolationSeverity;
  message: string;
  weekStartDate?: string;
  date?: string;
  staffName?: string;
  meta?: Record<string, unknown>;
}

export interface RosterValidationResult {
  valid: boolean;
  violations: RosterViolation[];
}

function pushViolation(out: RosterViolation[], v: RosterViolation): void {
  out.push(v);
}

/** 1 — Exact OFF count + strict weekly shape */
export function validateExactOffCount(schedule: DailySchedule[], staffList: Staff[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  const schedLen = schedule.length;
  const tail = schedLen % 7;

  if (tail > 0) {
    pushViolation(v, {
      validator: 'exactOffCount',
      code: 'PARTIAL_TAIL_WEEK',
      severity: 'warning',
      message: `Schedule length (${schedLen}) is not a multiple of 7; full-week OFF rules were not evaluated for the last ${tail} day(s).`,
      meta: { tailDays: tail },
    });
  }

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    const weekStartDate = schedule[ws]?.date;

    for (const staff of staffList) {
      if (staff.shiftPreference === 'StudentFixed') continue;
      const req = getRequiredWeeklyOff(staff);
      if (req !== 1 && req !== 1.5) continue;

      let nFull = 0;
      let nHalf = 0;
      for (let i = ws; i < we; i++) {
        const ax = getAssignment(schedule[i], staff.name);
        if (!ax) continue;
        const st = shiftStr(ax);
        if (isFullOffDay(st)) nFull++;
        else if (isHalfOffSlot(st)) nHalf++;
      }

      const cred = weeklyOffCreditsForSlice(schedule, ws, we, staff.name);
      const credMismatch = Math.abs(cred - req) > 1e-6;
      if (credMismatch) {
        pushViolation(v, {
          validator: 'exactOffCount',
          code: 'OFF_CREDIT_MISMATCH',
          severity: 'error',
          message: `${staff.name} has ${cred} OFF credits in week starting ${weekStartDate}; policy requires ${req}.`,
          weekStartDate,
          staffName: staff.name,
          meta: { credits: cred, required: req, fullOffDays: nFull, halfOffDays: nHalf },
        });
      }

      if (!credMismatch && req === 1) {
        const shapeOk = nFull === 1 && nHalf === 0;
        if (!shapeOk) {
          pushViolation(v, {
            validator: 'exactOffCount',
            code: 'OFF_SHAPE_ONE',
            severity: 'error',
            message: `${staff.name} weekly OFF shape invalid for weeklyOffDays=1 (expect exactly 1 full OFF and no half-offs) in week ${weekStartDate}.`,
            weekStartDate,
            staffName: staff.name,
            meta: { fullOffDays: nFull, halfOffDays: nHalf },
          });
        }
      } else if (!credMismatch && req === 1.5) {
        const shapeOk = nFull === 1 && nHalf === 1;
        if (!shapeOk) {
          pushViolation(v, {
            validator: 'exactOffCount',
            code: 'OFF_SHAPE_ONE_POINT_FIVE',
            severity: 'error',
            message: `${staff.name} weekly OFF shape invalid for weeklyOffDays=1.5 (expect exactly 1 full OFF + 1 half OFF) in week ${weekStartDate}.`,
            weekStartDate,
            staffName: staff.name,
            meta: { fullOffDays: nFull, halfOffDays: nHalf },
          });
        }
      }
    }
  }

  return v;
}

/** 2 — Minimum global night staffing (≥2 assignments including NightShift / Night tokens) */
export function validateNightCoverage(schedule: DailySchedule[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  schedule.forEach((day, idx) => {
    const n = day.assignments.filter((a) => isNightAssignment(shiftStr(a))).length;
    if (n >= MIN_GLOBAL_NIGHT_ASSIGNMENTS_PER_DAY) return;
    pushViolation(v, {
      validator: 'nightCoverage',
      code: 'NIGHT_COUNT_UNDER_TARGET',
      severity: 'error',
      message: `Only ${n} night assignment(s) on ${day.date} (${day.dayOfWeek}); minimum is ${MIN_GLOBAL_NIGHT_ASSIGNMENTS_PER_DAY}.`,
      date: day.date,
      meta: { count: n, minRequired: MIN_GLOBAL_NIGHT_ASSIGNMENTS_PER_DAY, scheduleIndex: idx },
    });
  });
  return v;
}

/** 3 — Mandatory rest-after-night (Day / StudentFixed exempt, matches postNightViolations) */
export function validateNightRecovery(schedule: DailySchedule[], staffList: Staff[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  const byName = new Map(staffList.map((s) => [s.name, s]));

  for (let i = 0; i < schedule.length - 1; i++) {
    const dayDate = schedule[i].date;
    const tomorrowDate = schedule[i + 1].date;
    const nightNames = schedule[i].assignments.filter((x) => isNightAssignment(shiftStr(x))).map((x) => x.staffName);

    for (const nm of nightNames) {
      const mem = byName.get(nm);
      if (mem?.shiftPreference === 'Day' || mem?.shiftPreference === 'StudentFixed') continue;

      const next = getAssignment(schedule[i + 1], nm);
      const stNext = next ? shiftStr(next) : '';
      if (!next || !isPostNightRecoveryRest(stNext)) {
        pushViolation(v, {
          validator: 'nightRecovery',
          code: 'POST_NIGHT_NOT_REST',
          severity: 'error',
          message: `${nm} works a night shift on ${dayDate} but ${tomorrowDate} is not mandatory recovery (OFF or half-OFF): got "${stNext || 'missing'}".`,
          date: tomorrowDate,
          staffName: nm,
          meta: { nightDate: dayDate, nextAssignment: stNext || null },
        });
      }
    }
  }
  return v;
}

/** 4 — Sunday fairness for Reservation rotational pool */
export function validateSundayFairness(schedule: DailySchedule[], staffList: Staff[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  const pool = reservationRotationalPool(staffList);
  if (pool.length < 2) return v;

  const schedLen = schedule.length;

  const sundayNightsAt = (di: number): string[] =>
    pool.filter((nm) => {
      const ax = getAssignment(schedule[di], nm);
      return !!ax && isNightAssignment(shiftStr(ax));
    });

  const sundayIdxs: number[] = [];
  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const si = ws + 6;
    if (si < schedLen && schedule[si].dayOfWeek === 'Sunday') sundayIdxs.push(si);
  }

  const sundayCounts: Record<string, number> = {};
  pool.forEach((n) => (sundayCounts[n] = 0));
  for (const si of sundayIdxs) {
    for (const nm of sundayNightsAt(si)) sundayCounts[nm] = (sundayCounts[nm] || 0) + 1;
  }

  for (let wi = 1; wi < sundayIdxs.length; wi++) {
    const prev = sundayNightsAt(sundayIdxs[wi - 1]);
    const cur = sundayNightsAt(sundayIdxs[wi]);
    const prevSet = new Set(prev);
    for (const nm of cur) {
      if (prevSet.has(nm)) {
        pushViolation(v, {
          validator: 'sundayFairness',
          code: 'CONSECUTIVE_SUNDAY_NIGHT',
          severity: 'error',
          message: `${nm} is on Sunday Night in consecutive roster weeks (${schedule[sundayIdxs[wi - 1]].date} → ${schedule[sundayIdxs[wi]].date}).`,
          date: schedule[sundayIdxs[wi]].date,
          staffName: nm,
          meta: { prevSundayDate: schedule[sundayIdxs[wi - 1]].date, currentSundayDate: schedule[sundayIdxs[wi]].date },
        });
      }
    }
  }

  const totalSundayNights = pool.reduce((a, nm) => a + (sundayCounts[nm] || 0), 0);
  if (totalSundayNights > 0) {
    const lowTarget = Math.floor(totalSundayNights / pool.length);
    const highTarget = Math.ceil(totalSundayNights / pool.length);
    const vals = pool.map((nm) => sundayCounts[nm] || 0);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const spread = maxVal - minVal;
    if (spread > 1) {
      pushViolation(v, {
        validator: 'sundayFairness',
        code: 'SUNDAY_NIGHT_COUNT_IMBALANCE',
        severity: 'error',
        message: `Reservation rotational Sunday-night counts are uneven (${JSON.stringify(sundayCounts)}); max−min=${spread}, fair band per person within [${lowTarget}, ${highTarget}].`,
        meta: { sundayNightCountsByMember: { ...sundayCounts }, lowTarget, highTarget, totalSundayNights, spread },
      });
    }
  }

  return v;
}

/** 5 — Reservation rotational night balance (global + per-week structure from balanceReservationRotationalNightsPerWeek) */
export function validateRotationalNightBalance(schedule: DailySchedule[], staffList: Staff[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  const pool = reservationRotationalPool(staffList);
  if (pool.length < 2) return v;

  const schedLen = schedule.length;
  const globalNightTotals = (): Record<string, number> => {
    const t: Record<string, number> = {};
    pool.forEach((n) => (t[n] = 0));
    for (let d = 0; d < schedLen; d++) {
      for (const nm of pool) {
        const ax = getAssignment(schedule[d], nm);
        if (ax && isNightAssignment(shiftStr(ax))) t[nm]++;
      }
    }
    return t;
  };

  const g = globalNightTotals();
  const gVals = pool.map((n) => g[n] || 0);
  const gMin = Math.min(...gVals);
  const gMax = Math.max(...gVals);
  if (gMax - gMin > 1) {
    pushViolation(v, {
      validator: 'rotationalNightBalance',
      code: 'GLOBAL_ROTATIONAL_SPREAD',
      severity: 'error',
      message: `Reservation rotational nights spread ${gMax - gMin} (min=${gMin}, max=${gMax}); target spread ≤ 1.`,
      meta: { globalTotals: { ...g } },
    });
  }

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    let poolWeekNights = 0;
    const counts: Record<string, number> = {};
    pool.forEach((n) => (counts[n] = 0));

    for (let d = ws; d < we && d < schedLen; d++) {
      for (const nm of pool) {
        const ax = getAssignment(schedule[d], nm);
        if (ax && isNightAssignment(shiftStr(ax))) {
          counts[nm]++;
          poolWeekNights++;
        }
      }
    }

    if (poolWeekNights >= pool.length) {
      const zeros = pool.filter((n) => counts[n] === 0);
      for (const nm of zeros) {
        pushViolation(v, {
          validator: 'rotationalNightBalance',
          code: 'WEEK_ROTATIONAL_ZERO_NIGHT',
          severity: 'error',
          message: `${nm} has 0 Reservation rotational nights week ${schedule[ws].date} despite enough pool-night slots (${poolWeekNights}).`,
          weekStartDate: schedule[ws].date,
          staffName: nm,
          meta: { poolWeekNightSlots: poolWeekNights, weekCounts: { ...counts } },
        });
      }
    }

    const cVals = pool.map((n) => counts[n] || 0);
    const cMin = Math.min(...cVals);
    const cMax = Math.max(...cVals);
    if (cMax - cMin > 1) {
      pushViolation(v, {
        validator: 'rotationalNightBalance',
        code: 'WEEK_ROTATIONAL_INTRASPREAD',
        severity: 'error',
        message: `Intra-week Reservation rotational night spread ${cMax - cMin} in week ${schedule[ws].date}; target spread ≤ 1.`,
        weekStartDate: schedule[ws].date,
        meta: { counts: { ...counts }, spread: cMax - cMin },
      });
    }
  }

  return v;
}

/** 6 — OFF day diversity: non-student dept members (eligible for spread in generator) avoid same full-OFF weekday in the same roster week */
export function validateOffDiversity(schedule: DailySchedule[], staffList: Staff[]): RosterViolation[] {
  const v: RosterViolation[] = [];
  const schedLen = schedule.length;

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    const weekStartDate = schedule[ws]?.date;

    type DeptBuckets = Record<string, Record<string, string[]>>;
    const byDeptWeekdayFullOff: DeptBuckets = {};

    for (const staff of staffList) {
      if (!isOffDiversityEligible(staff)) continue;

      let offDow = '';
      for (let di = ws; di < we; di++) {
        const ax = getAssignment(schedule[di], staff.name);
        if (!ax || !isFullOffDay(shiftStr(ax))) continue;
        offDow = schedule[di].dayOfWeek;
        break;
      }
      if (!offDow) continue;

      if (!byDeptWeekdayFullOff[staff.department]) byDeptWeekdayFullOff[staff.department] = {};
      if (!byDeptWeekdayFullOff[staff.department][offDow]) byDeptWeekdayFullOff[staff.department][offDow] = [];
      byDeptWeekdayFullOff[staff.department][offDow].push(staff.name);
    }

    for (const dept of Object.keys(byDeptWeekdayFullOff)) {
      const dowMap = byDeptWeekdayFullOff[dept];
      const namesInDept = new Set<string>();
      for (const lst of Object.values(dowMap)) lst.forEach((n) => namesInDept.add(n));
      if (namesInDept.size < 2) continue;

      for (const dow of Object.keys(dowMap)) {
        const names = dowMap[dow];
        if (names.length <= 1) continue;
        pushViolation(v, {
          validator: 'offDiversity',
          code: 'DEPT_FULL_OFF_WEEKDAY_COLLISION',
          severity: 'error',
          message: `${dept}: ${names.length} staff share full OFF on ${dow} (week ${weekStartDate}): ${names.sort().join(', ')}.`,
          weekStartDate,
          meta: { department: dept, weekday: dow, staffNames: names.sort() },
        });
      }
    }
  }

  return v;
}

/** Run every validator */
export function validateRoster(schedule: DailySchedule[], staffList: Staff[]): RosterValidationResult {
  const violations: RosterViolation[] = [];

  violations.push(...validateExactOffCount(schedule, staffList));
  violations.push(...validateNightCoverage(schedule));
  violations.push(...validateNightRecovery(schedule, staffList));
  violations.push(...validateSundayFairness(schedule, staffList));
  violations.push(...validateRotationalNightBalance(schedule, staffList));
  violations.push(...validateOffDiversity(schedule, staffList));

  const hasError = violations.some((x) => x.severity === 'error');

  return { valid: !hasError, violations };
}
