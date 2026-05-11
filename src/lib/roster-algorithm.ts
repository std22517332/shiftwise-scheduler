
import { DailySchedule, ShiftAssignment } from '@/ai/flows/generate-staff-roster-flow';
import { Staff } from '@/lib/types';
import { format, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import { applyPostGenerationMutationTags, buildShiftTypeSnapshot } from '@/lib/roster-mutation-meta';

/**
 * CORE ROSTER LOGIC — rotation, nightly balance, rest-after-night, per-dept coverage
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_MAP: Record<string, number> = {
  'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6
};

function shiftStr(a: ShiftAssignment): string {
  return String(a.shiftType);
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

function isNightConvertibleWorkSlot(st: string): boolean {
  return st === 'Day' || st.includes('H2-OFF');
}

/** Mandatory rest after Night: full OFF or a half-rest pattern counts as recuperation day */
function isPostNightRecoveryRest(st: string): boolean {
  return isFullOffDay(st) || isHalfOffSlot(st);
}

/** Day / Night / H2-OFF (works morning). H1-OFF leaves morning uncovered. */
function isDeptStrongPresenceAssignment(st: string): boolean {
  return st === 'Day' || isNightAssignment(st) || st.includes('H2-OFF');
}

/** Reservation morning desk (8:30–13): Day or H2-OFF (works AM). H1-OFF = morning off. */
function coversReservationMorningShift(st: string): boolean {
  if (st === 'Day') return true;
  return st.includes('H2-OFF');
}

const RESERVATION_MIN_MORNING_DESK = 2;

function countReservationMorningDesk(schedule: DailySchedule[], di: number, memberNames: string[]): number {
  let n = 0;
  for (const nm of memberNames) {
    const ax = getAssignment(schedule[di], nm);
    if (ax && coversReservationMorningShift(shiftStr(ax))) n++;
  }
  return n;
}

/** All Reservation staff count toward morning desk (incl. students on Day/H2). */
function reservationCoverageMemberNames(staffList: Staff[]): string[] {
  return staffList.filter((s) => s.department === 'Reservation').map((s) => s.name);
}

/** Prefer non-student staff for coverage counts; if only students, they count. */
function deptMorningCoverageMemberNames(staffList: Staff[], department: string): string[] {
  const nonStudent = staffList.filter(
    (s) => s.department === department && s.shiftPreference !== 'StudentFixed'
  );
  if (nonStudent.length > 0) return nonStudent.map((s) => s.name);
  return staffList.filter((s) => s.department === department).map((s) => s.name);
}

/** Min people on morning desk (8:30–13), scaled by department headcount. */
function minDeptMorningDeskTarget(headcount: number): number {
  if (headcount <= 0) return 0;
  if (headcount === 1) return 1;
  return Math.max(1, Math.ceil(headcount / 3));
}

function canSwapDeptMorningPattern(staffList: Staff[], staffName: string): boolean {
  const s = staffList.find((x) => x.name === staffName);
  if (!s) return false;
  if (s.shiftPreference === 'StudentFixed' || s.shiftPreference === 'Night') return false;
  return true;
}

/** Whether that department meets its minimum morning coverage on this day. */
function morningCoverageMeetsMinAt(
  schedule: DailySchedule[],
  di: number,
  department: string,
  staffList: Staff[]
): boolean {
  const names =
    department === 'Reservation'
      ? reservationCoverageMemberNames(staffList)
      : deptMorningCoverageMemberNames(staffList, department);
  const minRequired =
    department === 'Reservation'
      ? RESERVATION_MIN_MORNING_DESK
      : minDeptMorningDeskTarget(names.length);
  if (minRequired < 1 || names.length === 0) return true;
  return countReservationMorningDesk(schedule, di, names) >= minRequired;
}

function coversReservationMorningDeskCell(st: string): boolean {
  if (isNightAssignment(st)) return false;
  return coversReservationMorningShift(st);
}

function staffRotationSlot(staffList: Staff[], staffIndex: number): number {
  const name = staffList[staffIndex]?.name ?? String(staffIndex);
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 7;
}

function nightFairnessTieBreaker(staffList: Staff[], staffIdx: number, globalWeekIdx: number): number {
  return ((staffRotationSlot(staffList, staffIdx) * 53 + globalWeekIdx * 17 + staffIdx * 3) >>> 0) % 10009;
}

/** ≥2 tracked staff ⇒ every day someone must carry a Day or Night bucket (coverage floor) */
function minDeptStrongPresenceTarget(headcount: number): number {
  return headcount < 2 ? 0 : 1;
}

/**
 * Separate full-off weekdays between staff in each department so their full OFF … and (+4 half) offsets
 * do not collide (avoids QC-size teams both resting the same weekday).
 */
function spreadDeptSeparateFullOffAnchors(
  staffList: Staff[],
  baseOffIdxPerStaff: number[],
  offOverrides?: Record<string, number>
): void {
  const deptToIndices = new Map<string, number[]>();
  staffList.forEach((staff, idx) => {
    if (staff.shiftPreference === 'StudentFixed') return;
    if ((staff.guaranteedOffFrequency ?? 'none') === 'weekly') return;
    if (offOverrides?.[staff.name] !== undefined) return;
    const bucket = deptToIndices.get(staff.department);
    if (bucket) bucket.push(idx);
    else deptToIndices.set(staff.department, [idx]);
  });
  for (const indices of deptToIndices.values()) {
    if (indices.length < 2) continue;
    indices.sort((a, b) => staffList[a].name.localeCompare(staffList[b].name));
    const taken = new Set<number>();
    for (const idx of indices) {
      let b = ((baseOffIdxPerStaff[idx] % 7) + 7) % 7;
      let guard = 0;
      while (taken.has(b) && guard < 8) {
        b = (b + 1) % 7;
        guard++;
      }
      taken.add(b);
      baseOffIdxPerStaff[idx] = b;
    }
  }
}

function getAssignment(day: DailySchedule, staffName: string): ShiftAssignment | undefined {
  return day.assignments.find((a) => a.staffName === staffName);
}

function rebuildNightCounters(
  schedule: DailySchedule[]
): Record<string, number> {
  const c: Record<string, number> = {};
  schedule.forEach((day) => {
    day.assignments.forEach((a) => {
      if (isNightAssignment(shiftStr(a))) {
        c[a.staffName] = (c[a.staffName] || 0) + 1;
      }
    });
  });
  return c;
}

function rebuildWeeklyNightCounts(
  schedule: DailySchedule[],
  staffList: Staff[]
): Record<number, Record<string, number>> {
  const byWeek: Record<number, Record<string, number>> = {};
  const rotationalSet = new Set(
    staffList.filter((s) => isRotationalNightFairnessStaff(s)).map((s) => s.name)
  );
  schedule.forEach((day, schedIdx) => {
    const w = Math.floor(schedIdx / 7);
    if (!byWeek[w]) byWeek[w] = {};
    day.assignments.forEach((a) => {
      if (!rotationalSet.has(a.staffName)) return;
      if (!isNightAssignment(shiftStr(a))) return;
      byWeek[w][a.staffName] = (byWeek[w][a.staffName] || 0) + 1;
    });
  });
  return byWeek;
}

/** Supplemental nightly pool fairness (lifetime + intra-week balancing) tracks all Rotational staff */
function isRotationalNightFairnessStaff(staff: Staff): boolean {
  return staff.shiftPreference === 'Rotational';
}

/** Can we assign Night on calendar day `schedIdx` without breaking next-day-rest rule */
function tomorrowAllowsPostNight(schedule: DailySchedule[], schedIdx: number, staffName: string): boolean {
  if (schedIdx >= schedule.length - 1) return false;
  const next = getAssignment(schedule[schedIdx + 1], staffName);
  if (!next) return false;
  return isPostNightRecoveryRest(shiftStr(next));
}

/**
 * For strict nightly minimum coverage, boundary day can still receive Night.
 * (Next-day rest must then be handled in next roster block / manual handoff.)
 */
function canTakeNightForCoverage(schedule: DailySchedule[], schedIdx: number, staffName: string): boolean {
  if (hasNightOnPreviousCalendarDay(schedule, schedIdx, staffName)) return false;
  if (tomorrowAllowsPostNight(schedule, schedIdx, staffName)) return true;
  return schedIdx === schedule.length - 1;
}

/** Move an existing weekly half-off onto the calendar day after `schedIdx` so night can be staffed (weekly shape preserved). */
function tryPrepNextDayBySwappingHalf(
  schedule: DailySchedule[],
  schedIdx: number,
  staffName: string,
  scheduleLen: number
): boolean {
  const nextIdx = schedIdx + 1;
  if (nextIdx >= scheduleLen) return false;
  const nx = shiftStr(getAssignment(schedule[nextIdx], staffName)!);
  if (isPostNightRecoveryRest(nx)) return true;
  if (!isDeptStrongPresenceAssignment(nx)) return false;

  const weekStart = Math.floor(schedIdx / 7) * 7;
  const weekEndExclusive = Math.min(weekStart + 7, scheduleLen);
  for (let dj = weekStart; dj < weekEndExclusive; dj++) {
    if (dj === nextIdx) continue;
    const h = getAssignment(schedule[dj], staffName);
    if (!h || !isHalfOffSlot(shiftStr(h))) continue;
    swapStaffShiftsAcrossDays(schedule, nextIdx, dj, staffName);
    return tomorrowAllowsPostNight(schedule, schedIdx, staffName);
  }
  return false;
}

/** Move weekly full-OFF onto the day after night so staffing can hit 2 (swap with tomorrow's working day). */
function tryPrepNextDayBySwappingFullOff(
  schedule: DailySchedule[],
  schedIdx: number,
  staffName: string,
  scheduleLen: number
): boolean {
  const nextIdx = schedIdx + 1;
  if (nextIdx >= scheduleLen) return false;
  const nxCell = getAssignment(schedule[nextIdx], staffName);
  if (!nxCell) return false;
  if (isPostNightRecoveryRest(shiftStr(nxCell))) return true;

  const weekStart = Math.floor(schedIdx / 7) * 7;
  const weekEndExclusive = Math.min(weekStart + 7, scheduleLen);
  for (let dj = weekStart; dj < weekEndExclusive; dj++) {
    if (dj === nextIdx) continue;
    const o = getAssignment(schedule[dj], staffName);
    if (!o || !isFullOffDay(shiftStr(o))) continue;
    swapStaffShiftsAcrossDays(schedule, nextIdx, dj, staffName);
    return tomorrowAllowsPostNight(schedule, schedIdx, staffName);
  }
  return false;
}

function swapStaffShiftsAcrossDays(schedule: DailySchedule[], idxA: number, idxB: number, staffName: string): void {
  const assA = getAssignment(schedule[idxA], staffName);
  const assB = getAssignment(schedule[idxB], staffName);
  if (!assA || !assB) return;
  const t = assA.shiftType;
  assA.shiftType = assB.shiftType;
  assB.shiftType = t;
}

/** OFF=1 · each H*-OFF=0.5 */
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

function hasNightOnPreviousCalendarDay(schedule: DailySchedule[], dayIdx: number, staffName: string): boolean {
  if (dayIdx <= 0) return false;
  const prev = getAssignment(schedule[dayIdx - 1], staffName);
  return !!prev && isNightAssignment(shiftStr(prev));
}

function postNightNonFixedViolations(schedule: DailySchedule[], staffList: Staff[]): number {
  return postNightViolations(schedule, staffList).filter(
    (v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference !== 'Night'
  ).length;
}

/** Allow converting Day → rest only if dept morning coverage stays at or above minimum. */
function morningSafeToConvertDayToRest(
  schedule: DailySchedule[],
  di: number,
  staffName: string,
  staffList: Staff[]
): boolean {
  const staff = staffList.find((s) => s.name === staffName);
  if (!staff) return true;
  const cell = getAssignment(schedule[di], staffName);
  if (!cell || shiftStr(cell) !== 'Day') return true;

  const names =
    staff.department === 'Reservation'
      ? reservationCoverageMemberNames(staffList)
      : deptMorningCoverageMemberNames(staffList, staff.department);
  const minRequired =
    staff.department === 'Reservation'
      ? RESERVATION_MIN_MORNING_DESK
      : minDeptMorningDeskTarget(names.length);
  if (minRequired < 1) return true;

  const c = countReservationMorningDesk(schedule, di, names);
  return c >= minRequired + 1;
}

/**
 * Matches each full 7-day slice to weeklyOffDays (1 or 1.5 credits). Never modifies Night buckets.
 */
function enforceWeeklyOffExactQuota(
  schedule: DailySchedule[],
  staffList: Staff[],
  getRequiredWeeklyOff: (staff: Staff) => 1 | 1.5,
  warnings: string[],
  emitDiagnostics = true
): void {
  const schedLen = schedule.length;
  if (schedLen < 7) return;
  const warn = (msg: string) => {
    if (emitDiagnostics) warnings.push(msg);
  };

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    for (const staff of staffList) {
      if (staff.shiftPreference === 'StudentFixed') continue;

      const req = getRequiredWeeklyOff(staff);
      if (req !== 1 && req !== 1.5) continue;

      let guard = 0;
      while (guard++ < 64) {
        const act = weeklyOffCreditsForSlice(schedule, ws, we, staff.name);
        if (Math.abs(act - req) < 1e-6) break;

        const cellAt = (dayIdx: number) => getAssignment(schedule[dayIdx], staff.name)!;

        if (act > req) {
          const over = act - req;
          let peeled = false;
          const tryPeel = (di: number, newType: string): boolean => {
            const cell = cellAt(di);
            const before = shiftStr(cell);
            cell.shiftType = newType as any;
            if (postNightNonFixedViolations(schedule, staffList) !== 0) {
              cell.shiftType = before as any;
              return false;
            }
            return true;
          };

          /** Prefer peeling half-days, then trim a full OFF by 0.5 (→ H2), then drop a full OFF to Day */
          const candidates: number[] = [];
          for (let di = ws; di < we; di++) {
            const st = shiftStr(cellAt(di));
            if (isNightAssignment(st)) continue;
            if (hasNightOnPreviousCalendarDay(schedule, di, staff.name)) continue;
            candidates.push(di);
          }

          if (over >= 0.5) {
            for (const di of candidates) {
              const st = shiftStr(cellAt(di));
              if (!isHalfOffSlot(st)) continue;
              if (tryPeel(di, 'Day')) {
                peeled = true;
                break;
              }
            }
          }
          if (!peeled && over >= 0.5) {
            for (const di of candidates) {
              const st = shiftStr(cellAt(di));
              if (!isFullOffDay(st)) continue;
              if (tryPeel(di, 'H2-OFF')) {
                peeled = true;
                break;
              }
            }
          }
          if (!peeled && over >= 1) {
            for (const di of candidates) {
              const st = shiftStr(cellAt(di));
              if (!isFullOffDay(st)) continue;
              if (tryPeel(di, 'Day')) {
                peeled = true;
                break;
              }
            }
          }
          if (!peeled) {
            warn(
              `[${staff.name}] Could not peel weekly OFF (${act}≠${req} credits ${schedule[ws].date}…) without breaking mandatory rest-after-night`
            );
            break;
          }
          continue;
        }

        /** act < req — add rest using existing Day buckets only (prefer days with spare Reservation morning desk) */
        const shortfall = req - act;
        let added = false;
        const covNames = reservationCoverageMemberNames(staffList);
        const sortDayCandidatesDesc = (cands: number[]) =>
          cands.sort(
            (a, b) =>
              countReservationMorningDesk(schedule, b, covNames) -
              countReservationMorningDesk(schedule, a, covNames)
          );

        if (shortfall >= 1) {
          const cands: number[] = [];
          for (let di = ws; di < we; di++) {
            const cell = cellAt(di);
            if (isNightAssignment(shiftStr(cell))) continue;
            if (shiftStr(cell) !== 'Day') continue;
            if (!morningSafeToConvertDayToRest(schedule, di, staff.name, staffList)) continue;
            cands.push(di);
          }
          sortDayCandidatesDesc(cands);
          for (const di of cands) {
            const cell = cellAt(di);
            const before = shiftStr(cell);
            cell.shiftType = 'OFF' as any;
            if (postNightNonFixedViolations(schedule, staffList) !== 0) {
              cell.shiftType = before as any;
              continue;
            }
            added = true;
            break;
          }
        } else if (shortfall >= 0.499 && req === 1.5) {
          const cands: number[] = [];
          for (let di = ws; di < we; di++) {
            const cell = cellAt(di);
            if (isNightAssignment(shiftStr(cell))) continue;
            if (shiftStr(cell) !== 'Day') continue;
            if (!morningSafeToConvertDayToRest(schedule, di, staff.name, staffList)) continue;
            cands.push(di);
          }
          sortDayCandidatesDesc(cands);
          for (const di of cands) {
            const cell = cellAt(di);
            const before = shiftStr(cell);
            cell.shiftType = 'H1-OFF' as any;
            if (postNightNonFixedViolations(schedule, staffList) !== 0) {
              cell.shiftType = before as any;
              continue;
            }
            added = true;
            break;
          }
        }
        if (!added) {
          warn(
            `[${staff.name}] Could not add weekly OFF (${act}≠${req} credits week ${schedule[ws].date}) — no safe Day bucket or rule conflict`
          );
          break;
        }
      }

      const finalAct = weeklyOffCreditsForSlice(schedule, ws, we, staff.name);
      if (Math.abs(finalAct - req) > 1e-6) {
        warn(`[${staff.name}] Weekly OFF still ${finalAct} (needs ${req}) for week ${schedule[ws].date}.`);
      }
    }
  }

  const tailLen = schedLen % 7;
  if (tailLen > 0) {
    warn(
      `Weekly OFF normalization skipped final ${tailLen} day(s) — roster length should be multiples of 7 for exact quotas`
    );
  }
}

function postNightViolations(schedule: DailySchedule[], staffList: Staff[]): { schedIdx: number; staffName: string }[] {
  const violations: { schedIdx: number; staffName: string }[] = [];
  for (let i = 0; i < schedule.length - 1; i++) {
    const staffNames = schedule[i].assignments.filter((x) =>
      isNightAssignment(shiftStr(x))
    ).map((x) => x.staffName);
    for (const nm of staffNames) {
      const next = getAssignment(schedule[i + 1], nm);
      const stNext = shiftStr(next!);
      if (!next || !isPostNightRecoveryRest(stNext)) {
        const mem = staffList.find((s) => s.name === nm);
        if (mem?.shiftPreference === 'Day' || mem?.shiftPreference === 'StudentFixed') continue;
        violations.push({ schedIdx: i, staffName: nm });
      }
    }
  }
  return violations;
}

/** Demotes extra nights that violate mandated rest-after-night (fixed Night preference is left and reported elsewhere). */
function demotePostNightViolations(schedule: DailySchedule[], staffList: Staff[], violations: ReturnType<typeof postNightViolations>): void {
  for (const { schedIdx, staffName } of violations) {
    const mem = staffList.find((s) => s.name === staffName);
    if (mem?.shiftPreference === 'Night' || mem?.shiftPreference === 'StudentFixed') continue;
    const cell = getAssignment(schedule[schedIdx], staffName);
    if (cell && isNightAssignment(shiftStr(cell))) {
      cell.shiftType = 'Day' as any;
    }
  }
}

/**
 * Strict weekly rest *shape* (not only credits):
 * - weeklyOffDays === 1 → exactly 1× full OFF, never H1/H2 in that week
 * - weeklyOffDays === 1.5 → exactly 1× OFF + at most 1× half; never 2+ half-only days
 */
function normalizeWeeklyOffShapeStrict(
  schedule: DailySchedule[],
  staffList: Staff[],
  getRequiredWeeklyOff: (staff: Staff) => 1 | 1.5,
  warnings: string[]
): void {
  const schedLen = schedule.length;
  const cov = reservationCoverageMemberNames(staffList);

  const sortHalfIdxsPromoteToFullOff = (halfIdxs: number[], staffName: string): number[] =>
    [...halfIdxs].sort((a, b) => {
      const stA = shiftStr(getAssignment(schedule[a], staffName)!);
      const stB = shiftStr(getAssignment(schedule[b], staffName)!);
      const h1A = stA.includes('H1-OFF') ? 1 : 0;
      const h1B = stB.includes('H1-OFF') ? 1 : 0;
      if (h1B !== h1A) return h1B - h1A;
      const stff = staffList.find((s) => s.name === staffName);
      const dept = stff?.department ?? 'Reservation';
      const deskNames =
        dept === 'Reservation' ? cov : deptMorningCoverageMemberNames(staffList, dept);
      const deskA = countReservationMorningDesk(schedule, a, deskNames);
      const deskB = countReservationMorningDesk(schedule, b, deskNames);
      if (deskB !== deskA) return deskB - deskA;
      return a - b;
    });

  const tryPeelHalfToDay = (staff: Staff, di: number): boolean => {
    if (hasNightOnPreviousCalendarDay(schedule, di, staff.name)) return false;
    const cell = getAssignment(schedule[di], staff.name);
    if (!cell || !isHalfOffSlot(shiftStr(cell))) return false;
    const before = cell.shiftType;
    cell.shiftType = 'Day' as any;
    if (postNightNonFixedViolations(schedule, staffList) !== 0) {
      cell.shiftType = before as any;
      return false;
    }
    if (!morningCoverageMeetsMinAt(schedule, di, staff.department, staffList)) {
      cell.shiftType = before as any;
      return false;
    }
    return true;
  };

  const tryPromoteHalfToFullOff = (staff: Staff, di: number): boolean => {
    if (hasNightOnPreviousCalendarDay(schedule, di, staff.name)) return false;
    const cell = getAssignment(schedule[di], staff.name);
    if (!cell || !isHalfOffSlot(shiftStr(cell))) return false;
    const before = cell.shiftType;
    cell.shiftType = 'OFF' as any;
    if (postNightNonFixedViolations(schedule, staffList) !== 0) {
      cell.shiftType = before as any;
      return false;
    }
    if (!morningCoverageMeetsMinAt(schedule, di, staff.department, staffList)) {
      cell.shiftType = before as any;
      return false;
    }
    return true;
  };

  /** Two half days → one full OFF + one Day (weekly 1.0 credit, no half-offs left) */
  const tryMergeTwoHalvesToOffAndDay = (staff: Staff, halfIdxs: number[]): boolean => {
    if (halfIdxs.length < 2) return false;
    const ordered = sortHalfIdxsPromoteToFullOff(halfIdxs, staff.name);
    for (let oi = 0; oi < ordered.length; oi++) {
      for (let dj = 0; dj < ordered.length; dj++) {
        if (oi === dj) continue;
        const iOff = ordered[oi];
        const iDay = ordered[dj];
        if (hasNightOnPreviousCalendarDay(schedule, iOff, staff.name)) continue;
        if (hasNightOnPreviousCalendarDay(schedule, iDay, staff.name)) continue;
        const cOff = getAssignment(schedule[iOff], staff.name)!;
        const cDay = getAssignment(schedule[iDay], staff.name)!;
        const bO = cOff.shiftType;
        const bD = cDay.shiftType;
        cOff.shiftType = 'OFF' as any;
        cDay.shiftType = 'Day' as any;
        if (postNightNonFixedViolations(schedule, staffList) !== 0) {
          cOff.shiftType = bO as any;
          cDay.shiftType = bD as any;
          continue;
        }
        if (
          !morningCoverageMeetsMinAt(schedule, iOff, staff.department, staffList) ||
          !morningCoverageMeetsMinAt(schedule, iDay, staff.department, staffList)
        ) {
          cOff.shiftType = bO as any;
          cDay.shiftType = bD as any;
          continue;
        }
        return true;
      }
    }
    return false;
  };

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    for (const staff of staffList) {
      if (staff.shiftPreference === 'StudentFixed') continue;
      const req = getRequiredWeeklyOff(staff);
      if (req !== 1 && req !== 1.5) continue;

      const maxHalfAllowed = req === 1 ? 0 : 1;

      let guard = 0;
      while (guard++ < 64) {
        const cred = weeklyOffCreditsForSlice(schedule, ws, we, staff.name);

        const restDays: { i: number; st: string }[] = [];
        for (let i = ws; i < we; i++) {
          const ax = getAssignment(schedule[i], staff.name);
          if (!ax) continue;
          const st = shiftStr(ax);
          if (isFullOffDay(st) || isHalfOffSlot(st)) restDays.push({ i, st });
        }
        const nFull = restDays.filter((x) => isFullOffDay(x.st)).length;
        const nHalf = restDays.filter((x) => isHalfOffSlot(x.st)).length;
        const halfIdxsAll = restDays.filter((x) => isHalfOffSlot(x.st)).map((x) => x.i);

        /** ——— weeklyOffDays === 1: forbid any H1/H2; only one full OFF ——— */
        if (req === 1) {
          if (nHalf >= 1 && nFull >= 1) {
            const halfFirst = restDays.find((x) => isHalfOffSlot(x.st))!;
            if (tryPeelHalfToDay(staff, halfFirst.i)) continue;
            warnings.push(
              `[${staff.name}] Cannot remove half-off next to full OFF (weekly 1.0 rule) (week ${schedule[ws].date})`
            );
            break;
          }
          if (nFull === 0 && nHalf >= 2) {
            if (tryMergeTwoHalvesToOffAndDay(staff, halfIdxsAll)) continue;
            let peeledAny = false;
            for (const di of [...halfIdxsAll].sort((a, b) => a - b)) {
              if (tryPeelHalfToDay(staff, di)) {
                peeledAny = true;
                break;
              }
            }
            if (peeledAny) continue;
            warnings.push(
              `[${staff.name}] Cannot replace 2×half-off with 1×OFF + Day (week ${schedule[ws].date})`
            );
            break;
          }
          if (nFull === 0 && nHalf === 1) {
            const sorted = sortHalfIdxsPromoteToFullOff(halfIdxsAll, staff.name);
            let ok = false;
            for (const di of sorted) {
              if (tryPromoteHalfToFullOff(staff, di)) {
                ok = true;
                break;
              }
            }
            if (ok) continue;
            warnings.push(
              `[${staff.name}] Cannot convert lone half-off to full OFF (weekly 1.0 rule) (week ${schedule[ws].date})`
            );
            break;
          }
          if (nFull > 1) {
            const fullIdxs = restDays
              .filter((x) => isFullOffDay(x.st))
              .map((x) => x.i)
              .sort((a, b) => b - a);
            let peeled = false;
            for (const fullIdx of fullIdxs) {
              if (hasNightOnPreviousCalendarDay(schedule, fullIdx, staff.name)) continue;
              const cell = getAssignment(schedule[fullIdx], staff.name)!;
              const before = cell.shiftType;
              cell.shiftType = 'Day' as any;
              if (postNightNonFixedViolations(schedule, staffList) !== 0) {
                cell.shiftType = before as any;
                continue;
              }
              if (!morningCoverageMeetsMinAt(schedule, fullIdx, staff.department, staffList)) {
                cell.shiftType = before as any;
                continue;
              }
              peeled = true;
              break;
            }
            if (peeled) continue;
            break;
          }
          if (nFull === 1 && nHalf === 0 && Math.abs(cred - 1) < 1e-6) break;
          if (Math.abs(cred - 1) > 1e-6) break;
          break;
        }

        /** ——— weeklyOffDays === 1.5: at most one half-off; never 2+ half days ——— */
        if (req === 1.5 && nHalf > maxHalfAllowed) {
          if (nFull === 0 && nHalf >= 3) {
            let peeled3 = false;
            for (const di of [...halfIdxsAll].sort((a, b) => b - a)) {
              if (tryPeelHalfToDay(staff, di)) {
                peeled3 = true;
                break;
              }
            }
            if (peeled3) continue;
            warnings.push(
              `[${staff.name}] Cannot peel from 3+ half-offs toward 1.5 shape (week ${schedule[ws].date})`
            );
            break;
          }
          if (nFull === 0 && nHalf === 2) {
            const sorted = sortHalfIdxsPromoteToFullOff(halfIdxsAll, staff.name);
            let promoted = false;
            for (const di of sorted) {
              if (tryPromoteHalfToFullOff(staff, di)) {
                promoted = true;
                break;
              }
            }
            if (promoted) continue;
            warnings.push(
              `[${staff.name}] Cannot promote 2×half-off to 1 OFF + 1 half (week ${schedule[ws].date})`
            );
            break;
          }
          const peelOrder = [...halfIdxsAll].sort((a, b) => b - a);
          let peeled15 = false;
          for (const di of peelOrder) {
            if (tryPeelHalfToDay(staff, di)) {
              peeled15 = true;
              break;
            }
          }
          if (peeled15) continue;
          warnings.push(
            `[${staff.name}] Cannot collapse extra half-off(s) to 1 OFF + 1 half (week ${schedule[ws].date})`
          );
          break;
        }

        if (req === 1.5 && cred > 1.5 + 1e-6) {
          const halfIdxsOver = restDays
            .filter((x) => isHalfOffSlot(x.st))
            .map((x) => x.i)
            .sort((a, b) => b - a);
          let peeledOver = false;
          for (const di of halfIdxsOver) {
            if (tryPeelHalfToDay(staff, di)) {
              peeledOver = true;
              break;
            }
          }
          if (peeledOver) continue;

          const fullIdxsOver = restDays
            .filter((x) => isFullOffDay(x.st))
            .map((x) => x.i)
            .sort((a, b) => b - a);
          for (const fullIdx of fullIdxsOver) {
            if (hasNightOnPreviousCalendarDay(schedule, fullIdx, staff.name)) continue;
            const cell = getAssignment(schedule[fullIdx], staff.name)!;
            const before = cell.shiftType;
            cell.shiftType = 'Day' as any;
            if (postNightNonFixedViolations(schedule, staffList) !== 0) {
              cell.shiftType = before as any;
              continue;
            }
            if (!morningCoverageMeetsMinAt(schedule, fullIdx, staff.department, staffList)) {
              cell.shiftType = before as any;
              continue;
            }
            peeledOver = true;
            break;
          }
          if (peeledOver) continue;

          warnings.push(
            `[${staff.name}] Cannot reduce weekly OFF over ${cred} to 1.5 (week ${schedule[ws].date})`
          );
          break;
        }

        if (req === 1.5 && Math.abs(cred - 1.5) > 1e-6) break;

        if (req === 1.5 && nFull === 1 && nHalf === 1) {
          const h = restDays.find((x) => isHalfOffSlot(x.st))!;
          if (h.st.includes('H2-OFF')) {
            const cell = getAssignment(schedule[h.i], staff.name)!;
            const before = cell.shiftType;
            cell.shiftType = 'H1-OFF' as any;
            const ok =
              postNightNonFixedViolations(schedule, staffList) === 0 &&
              morningCoverageMeetsMinAt(schedule, h.i, staff.department, staffList);
            if (ok) break;
            cell.shiftType = before as any;
          }
          break;
        }

        if (req === 1.5 && nFull >= 2) {
          const fullIdxs = restDays
            .filter((x) => isFullOffDay(x.st))
            .map((x) => x.i)
            .sort((a, b) => b - a);
          let peeled = false;
          for (const fullIdx of fullIdxs) {
            if (hasNightOnPreviousCalendarDay(schedule, fullIdx, staff.name)) continue;
            const cell = getAssignment(schedule[fullIdx], staff.name)!;
            const before = cell.shiftType;
            cell.shiftType = 'Day' as any;
            if (postNightNonFixedViolations(schedule, staffList) !== 0) {
              cell.shiftType = before as any;
              continue;
            }
            if (!morningCoverageMeetsMinAt(schedule, fullIdx, staff.department, staffList)) {
              cell.shiftType = before as any;
              continue;
            }
            peeled = true;
            break;
          }
          if (peeled) continue;
          break;
        }

        break;
      }
    }
  }
}


/**
 * Fairness for Reservation + Rotational nights:
 * 1) Lifetime totals (all weeks): spread ≤ 1 between min/max in pool
 * 2) Each week: try to give ≥1 night to anyone on 0 (swap from someone with ≥2 that week)
 * 3) Each week: intra-week spread ≤ 1 (tie-break hi/lo by lifetime totals)
 */
function balanceReservationRotationalNightsPerWeek(
  schedule: DailySchedule[],
  staffList: Staff[],
  initialWeekOffset: number = 0
): void {
  const schedLen = schedule.length;
  const cov = reservationCoverageMemberNames(staffList);
  const pool = staffList
    .filter((s) => s.department === 'Reservation' && s.shiftPreference === 'Rotational')
    .map((s) => s.name);
  if (pool.length < 2) return;

  const postOk = (): boolean =>
    postNightViolations(schedule, staffList).filter(
      (v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference !== 'Night'
    ).length === 0;

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

  const weekdayNightTotals = (): Record<string, Record<string, number>> => {
    const t: Record<string, Record<string, number>> = {};
    pool.forEach((n) => {
      t[n] = {};
      DAY_NAMES.forEach((dn) => (t[n][dn] = 0));
    });
    for (let d = 0; d < schedLen; d++) {
      const dayName = schedule[d].dayOfWeek;
      for (const nm of pool) {
        const ax = getAssignment(schedule[d], nm);
        if (ax && isNightAssignment(shiftStr(ax))) {
          t[nm][dayName] = (t[nm][dayName] || 0) + 1;
        }
      }
    }
    return t;
  };

  const fairnessScore = (): { globalSpread: number; weekdaySpreadSum: number; globalImbalance: number } => {
    const g = globalNightTotals();
    const vals = pool.map((n) => g[n] || 0);
    const maxG = Math.max(...vals);
    const minG = Math.min(...vals);
    const total = vals.reduce((a, b) => a + b, 0);
    const avg = total / pool.length;
    const globalImbalance = vals.reduce((a, v) => a + Math.abs(v - avg), 0);

    const wd = weekdayNightTotals();
    let weekdaySpreadSum = 0;
    for (const dn of DAY_NAMES) {
      const vv = pool.map((n) => wd[n][dn] || 0);
      const spread = Math.max(...vv) - Math.min(...vv);
      weekdaySpreadSum += spread;
    }

    return {
      globalSpread: maxG - minG,
      weekdaySpreadSum,
      globalImbalance,
    };
  };

  const isBetterScore = (
    next: { globalSpread: number; weekdaySpreadSum: number; globalImbalance: number },
    prev: { globalSpread: number; weekdaySpreadSum: number; globalImbalance: number }
  ): boolean => {
    if (next.globalSpread !== prev.globalSpread) return next.globalSpread < prev.globalSpread;
    if (next.weekdaySpreadSum !== prev.weekdaySpreadSum) return next.weekdaySpreadSum < prev.weekdaySpreadSum;
    return next.globalImbalance < prev.globalImbalance - 1e-9;
  };

  const weeklyCountsForWindow = (ws: number, we: number): Record<string, number> => {
    const c: Record<string, number> = {};
    pool.forEach((n) => (c[n] = 0));
    for (let d = ws; d < we && d < schedLen; d++) {
      for (const nm of pool) {
        const ax = getAssignment(schedule[d], nm);
        if (ax && isNightAssignment(shiftStr(ax))) c[nm]++;
      }
    }
    return c;
  };

  const isSundayIdx = (d: number): boolean => schedule[d]?.dayOfWeek === 'Sunday';

  const sundayNightsAt = (d: number): string[] =>
    pool.filter((nm) => {
      const ax = getAssignment(schedule[d], nm);
      return !!ax && isNightAssignment(shiftStr(ax));
    });

  const hasConsecutiveSundayFor = (d: number, name: string): boolean => {
    if (!isSundayIdx(d)) return false;
    const prev = d - 7;
    if (prev < 0 || !isSundayIdx(prev)) return false;
    const prevAx = getAssignment(schedule[prev], name);
    return !!prevAx && isNightAssignment(shiftStr(prevAx));
  };

  const weekStartOf = (d: number): number => Math.floor(d / 7) * 7;

  const canMoveNightWithoutBreakingWeeklyFloor = (d: number, donor: string, receiver: string): boolean => {
    const ws = weekStartOf(d);
    const we = Math.min(ws + 7, schedLen);
    const counts = weeklyCountsForWindow(ws, we);
    let poolWeekNights = 0;
    for (let i = ws; i < we; i++) {
      for (const nm of pool) {
        const ax = getAssignment(schedule[i], nm);
        if (ax && isNightAssignment(shiftStr(ax))) poolWeekNights++;
      }
    }
    if (poolWeekNights < pool.length) return true;
    const donorAfter = (counts[donor] || 0) - 1;
    const recvAfter = (counts[receiver] || 0) + 1;
    return donorAfter >= 1 && recvAfter >= 1;
  };

  const trySwapNightDay = (d: number, nightName: string, dayName: string): boolean => {
    if (nightName === dayName) return false;
    const hiCell = getAssignment(schedule[d], nightName);
    const loCell = getAssignment(schedule[d], dayName);
    if (!hiCell || !loCell) return false;
    if (!isNightAssignment(shiftStr(hiCell)) || shiftStr(loCell) !== 'Day') return false;
    if (hasNightOnPreviousCalendarDay(schedule, d, dayName)) return false;
    if (!canTakeNightForCoverage(schedule, d, dayName)) return false;
    if (hasConsecutiveSundayFor(d, dayName)) return false;
    const beforeScore = fairnessScore();
    const bHi = hiCell.shiftType;
    const bLo = loCell.shiftType;
    hiCell.shiftType = 'Day' as any;
    loCell.shiftType = 'Night' as any;
    const mornOk = countReservationMorningDesk(schedule, d, cov) >= RESERVATION_MIN_MORNING_DESK;
    const afterScore = fairnessScore();
    if (!postOk() || !mornOk || !isBetterScore(afterScore, beforeScore)) {
      hiCell.shiftType = bHi as any;
      loCell.shiftType = bLo as any;
      return false;
    }
    return true;
  };

  const trySwapNightDayHard = (d: number, nightName: string, dayName: string): boolean => {
    if (nightName === dayName) return false;
    const hiCell = getAssignment(schedule[d], nightName);
    const loCell = getAssignment(schedule[d], dayName);
    if (!hiCell || !loCell) return false;
    if (!isNightAssignment(shiftStr(hiCell)) || !isNightConvertibleWorkSlot(shiftStr(loCell))) return false;
    if (isSundayIdx(d)) return false;
    if (!canMoveNightWithoutBreakingWeeklyFloor(d, nightName, dayName)) return false;
    if (hasNightOnPreviousCalendarDay(schedule, d, dayName)) return false;
    if (!canTakeNightForCoverage(schedule, d, dayName)) {
      const scheduleLen = schedule.length;
      if (
        !(
          tryPrepNextDayBySwappingHalf(schedule, d, dayName, scheduleLen) ||
          tryPrepNextDayBySwappingFullOff(schedule, d, dayName, scheduleLen)
        )
      ) {
        return false;
      }
      if (!canTakeNightForCoverage(schedule, d, dayName)) return false;
    }

    const bHi = hiCell.shiftType;
    const bLo = loCell.shiftType;
    hiCell.shiftType = 'Day' as any;
    loCell.shiftType = 'Night' as any;
    const mornOk = countReservationMorningDesk(schedule, d, cov) >= RESERVATION_MIN_MORNING_DESK;
    if (!postOk() || !mornOk) {
      hiCell.shiftType = bHi as any;
      loCell.shiftType = bLo as any;
      return false;
    }
    return true;
  };

  for (let pass = 0; pass < 3; pass++) {
    /** Global: reduce gap between most- and least-assigned over full roster */
    for (let round = 0; round < 512; round++) {
      const g = globalNightTotals();
      let hiG = pool[0];
      let loG = pool[0];
      for (const nm of pool) {
        if (g[nm] > g[hiG]) hiG = nm;
        if (g[nm] < g[loG]) loG = nm;
      }
      if (g[hiG] - g[loG] <= 1) break;
      let movedG = false;
      for (let d = 0; d < schedLen && !movedG; d++) {
        if (trySwapNightDay(d, hiG, loG)) movedG = true;
      }
      if (!movedG) break;
    }

    /** Per-week floor: if pool has enough week-night slots, everyone should get at least one night */
    for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
      for (let round = 0; round < 128; round++) {
        const counts = weeklyCountsForWindow(ws, ws + 7);
        let poolWeekNights = 0;
        for (let d = ws; d < ws + 7 && d < schedLen; d++) {
          for (const nm of pool) {
            const ax = getAssignment(schedule[d], nm);
            if (ax && isNightAssignment(shiftStr(ax))) poolWeekNights++;
          }
        }
        if (poolWeekNights < pool.length) break;
        const zeros = pool.filter((n) => counts[n] === 0);
        if (zeros.length === 0) break;
        const donors = pool.filter((n) => counts[n] >= 1);
        if (donors.length === 0) break;
        const g = globalNightTotals();
        const zSorted = [...zeros].sort((a, b) => g[a] - g[b]);
        const dSorted = [...donors].sort((a, b) => g[b] - g[a] || counts[b] - counts[a]);
        let movedZ = false;
        outerZ: for (const loN of zSorted) {
          for (const hiN of dSorted) {
            for (let d = ws; d < ws + 7 && d < schedLen; d++) {
              if (trySwapNightDay(d, hiN, loN)) {
                movedZ = true;
                break outerZ;
              }
            }
          }
        }
        if (!movedZ) break;
      }
    }

    /** Hard global targets: distribute total pool nights as evenly as possible (e.g. 27 => 9/9/9). */
    for (let round = 0; round < 512; round++) {
      const g = globalNightTotals();
      const totalPoolNights = pool.reduce((acc, n) => acc + (g[n] || 0), 0);
      const lowTarget = Math.floor(totalPoolNights / pool.length);
      const highTarget = Math.ceil(totalPoolNights / pool.length);
      const over = pool.filter((n) => g[n] > highTarget).sort((a, b) => g[b] - g[a]);
      const under = pool.filter((n) => g[n] < lowTarget).sort((a, b) => g[a] - g[b]);
      if (over.length === 0 || under.length === 0) break;
      let moved = false;
      outerHard: for (const hi of over) {
        for (const lo of under) {
          for (let d = 0; d < schedLen; d++) {
            if (trySwapNightDay(d, hi, lo)) {
              moved = true;
              break outerHard;
            }
          }
        }
      }
      if (!moved) break;
    }

    /** Intra-week spread ≤ 1 */
    for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
      for (let round = 0; round < 96; round++) {
        const counts: Record<string, number> = {};
        pool.forEach((n) => (counts[n] = 0));
        for (let d = ws; d < ws + 7 && d < schedLen; d++) {
          for (const nm of pool) {
            const ax = getAssignment(schedule[d], nm);
            if (ax && isNightAssignment(shiftStr(ax))) counts[nm]++;
          }
        }
        const g = globalNightTotals();
        let hi = pool[0];
        let lo = pool[0];
        for (const nm of pool) {
          if (counts[nm] > counts[hi] || (counts[nm] === counts[hi] && g[nm] > g[hi])) hi = nm;
          if (counts[nm] < counts[lo] || (counts[nm] === counts[lo] && g[nm] < g[lo])) lo = nm;
        }
        if (counts[hi] - counts[lo] <= 1) break;

        let moved = false;
        for (let d = ws; d < ws + 7 && d < schedLen && !moved; d++) {
          if (trySwapNightDay(d, hi, lo)) moved = true;
        }
        if (!moved) break;
      }
    }

    /** Weekday fairness (avoid overloading same person on same weekday except Sunday) */
    for (const dn of DAY_NAMES.filter((x) => x !== 'Sunday')) {
      for (let round = 0; round < 96; round++) {
        const wd = weekdayNightTotals();
        let hi = pool[0];
        let lo = pool[0];
        for (const nm of pool) {
          if (wd[nm][dn] > wd[hi][dn]) hi = nm;
          if (wd[nm][dn] < wd[lo][dn]) lo = nm;
        }
        if ((wd[hi][dn] - wd[lo][dn]) <= 1) break;

        let moved = false;
        for (let d = 0; d < schedLen && !moved; d++) {
          if (schedule[d].dayOfWeek !== dn) continue;
          if (trySwapNightDay(d, hi, lo)) moved = true;
        }
        if (!moved) break;
      }
    }
  }

  /** Sunday fairness hard-lock:
   *  - no rotational person should take Sunday Night on consecutive weeks
   *  - total Sunday-Night counts should be as equal as possible across rotational pool
   */
  const sundayIdxs: number[] = [];
  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const si = ws + 6;
    if (si < schedLen && schedule[si].dayOfWeek === 'Sunday') sundayIdxs.push(si);
  }

  const sundayCounts = (): Record<string, number> => {
    const c: Record<string, number> = {};
    pool.forEach((n) => (c[n] = 0));
    for (const si of sundayIdxs) for (const nm of sundayNightsAt(si)) c[nm] = (c[nm] || 0) + 1;
    return c;
  };

  const trySwapSundayNight = (si: number, donor: string, receiver: string): boolean => {
    if (donor === receiver) return false;
    const donorCell = getAssignment(schedule[si], donor);
    const recvCell = getAssignment(schedule[si], receiver);
    if (!donorCell || !recvCell) return false;
    if (!isNightAssignment(shiftStr(donorCell))) return false;
    if (!isNightConvertibleWorkSlot(shiftStr(recvCell))) return false;
    if (hasNightOnPreviousCalendarDay(schedule, si, receiver)) return false;
    if (!canTakeNightForCoverage(schedule, si, receiver)) return false;

    const bD = donorCell.shiftType;
    const bR = recvCell.shiftType;
    donorCell.shiftType = 'Day' as any;
    recvCell.shiftType = 'Night' as any;
    const mornOk = countReservationMorningDesk(schedule, si, cov) >= RESERVATION_MIN_MORNING_DESK;
    if (!postOk() || !mornOk) {
      donorCell.shiftType = bD as any;
      recvCell.shiftType = bR as any;
      return false;
    }
    return true;
  };

  for (let pass = 0; pass < 36; pass++) {
    let changed = false;
    let c = sundayCounts();
    const totalSundayNights = pool.reduce((acc, nm) => acc + (c[nm] || 0), 0);
    const lowTarget = Math.floor(totalSundayNights / pool.length);
    const highTarget = Math.ceil(totalSundayNights / pool.length);

    for (let wi = 0; wi < sundayIdxs.length; wi++) {
      const si = sundayIdxs[wi];
      const current = sundayNightsAt(si);
      const prevSet = new Set(wi > 0 ? sundayNightsAt(sundayIdxs[wi - 1]) : []);
      const currentSet = new Set(current);

      // Rule 1: prevent consecutive-week Sunday night for same person.
      for (const donor of current) {
        if (!prevSet.has(donor)) continue;
        const candidates = pool
          .filter((nm) => !currentSet.has(nm) && !prevSet.has(nm))
          .sort((a, b) => (c[a] || 0) - (c[b] || 0));
        let moved = false;
        for (const recv of candidates) {
          if (trySwapSundayNight(si, donor, recv)) {
            changed = true;
            moved = true;
            c = sundayCounts();
            break;
          }
        }
        if (!moved) {
          const fallback = pool
            .filter((nm) => !currentSet.has(nm))
            .sort((a, b) => (c[a] || 0) - (c[b] || 0));
          for (const recv of fallback) {
            if (trySwapSundayNight(si, donor, recv)) {
              changed = true;
              c = sundayCounts();
              break;
            }
          }
        }
      }

      // Rule 2: equalize total Sunday-night counts.
      const afterConsecutive = sundayNightsAt(si);
      for (const donor of afterConsecutive
        .filter((nm) => (c[nm] || 0) > highTarget)
        .sort((a, b) => (c[b] || 0) - (c[a] || 0))) {
        const current2 = new Set(sundayNightsAt(si));
        const prev2 = new Set(wi > 0 ? sundayNightsAt(sundayIdxs[wi - 1]) : []);
        const g = globalNightTotals();
        const receivers = pool
          .filter((nm) => !current2.has(nm) && (c[nm] || 0) < lowTarget && !prev2.has(nm))
          .sort((a, b) => (c[a] || 0) - (c[b] || 0) || (g[a] || 0) - (g[b] || 0));
        for (const recv of receivers) {
          if (trySwapSundayNight(si, donor, recv)) {
            changed = true;
            c = sundayCounts();
            break;
          }
        }
      }
    }

    if (!changed) break;
  }

  // Re-balance global totals once more after Sunday lock (without breaking Sunday constraint).
  for (let round = 0; round < 256; round++) {
    const g = globalNightTotals();
    let hi = pool[0];
    let lo = pool[0];
    for (const nm of pool) {
      if ((g[nm] || 0) > (g[hi] || 0)) hi = nm;
      if ((g[nm] || 0) < (g[lo] || 0)) lo = nm;
    }
    if ((g[hi] || 0) - (g[lo] || 0) <= 1) break;
    let moved = false;
    for (let d = 0; d < schedLen && !moved; d++) {
      if (isSundayIdx(d)) continue;
      if (trySwapNightDay(d, hi, lo)) moved = true;
    }
    if (!moved) break;
  }

  // Hard non-Sunday equalization toward exact floor/ceil targets (e.g. 27 => 9/9/9).
  for (let round = 0; round < 1200; round++) {
    const g = globalNightTotals();
    const totalPoolNights = pool.reduce((acc, n) => acc + (g[n] || 0), 0);
    const lowTarget = Math.floor(totalPoolNights / pool.length);
    const highTarget = Math.ceil(totalPoolNights / pool.length);
    const over = pool.filter((n) => (g[n] || 0) > highTarget).sort((a, b) => (g[b] || 0) - (g[a] || 0));
    const under = pool.filter((n) => (g[n] || 0) < lowTarget).sort((a, b) => (g[a] || 0) - (g[b] || 0));
    if (over.length === 0 || under.length === 0) break;

    let moved = false;
    outerHard2: for (const hi of over) {
      for (const lo of under) {
        for (let d = 0; d < schedLen; d++) {
          if (trySwapNightDayHard(d, hi, lo)) {
            moved = true;
            break outerHard2;
          }
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Nights must be capped at two; optional pool excludes staff whose next calendar day cannot be rest-after-night.
 */
function phaseNightCapAndFill(
  schedule: DailySchedule[],
  staffList: Staff[],
  staffIndexByName: Record<string, number>,
  initialWeekOffset: number,
  nightShiftCounter: Record<string, number>,
  weeklyNightCounts: Record<number, Record<string, number>>
): boolean {
  let changed = false;
  schedule.forEach((day, schedIdx) => {
    const globalWeekIdx = Math.floor(schedIdx / 7) + initialWeekOffset;
    const weekRel = Math.floor(schedIdx / 7);
    const nightAssignments = day.assignments.filter((a) => isNightAssignment(shiftStr(a)));
    const currentNightCount = nightAssignments.length;
    const dayOfWeekName = day.dayOfWeek;
    const weekdayNightBurden = (name: string): number => {
      let c = 0;
      for (let d = 0; d < schedule.length; d++) {
        if (schedule[d].dayOfWeek !== dayOfWeekName) continue;
        const ax = getAssignment(schedule[d], name);
        if (ax && isNightAssignment(shiftStr(ax))) c++;
      }
      return c;
    };

    const sortRemoveNight = (a: ShiftAssignment, b: ShiftAssignment) => {
      const na = nightShiftCounter[a.staffName] || 0;
      const nb = nightShiftCounter[b.staffName] || 0;
      if (nb !== na) return nb - na;
      const daW = weekdayNightBurden(a.staffName);
      const dbW = weekdayNightBurden(b.staffName);
      if (dbW !== daW) return dbW - daW;
      const wa = weeklyNightCounts[weekRel]?.[a.staffName] ?? 0;
      const wb = weeklyNightCounts[weekRel]?.[b.staffName] ?? 0;
      if (wb !== wa) return wb - wa;
      const ia = staffIndexByName[a.staffName] ?? 0;
      const ib = staffIndexByName[b.staffName] ?? 0;
      return nightFairnessTieBreaker(staffList, ib, globalWeekIdx) - nightFairnessTieBreaker(staffList, ia, globalWeekIdx);
    };

    /** Count weeks (before currentWeekRel) where this person already had ≥2 nights */
    const doubleNightWeekBurdenToDate = (name: string): number => {
      let u = 0;
      Object.keys(weeklyNightCounts).forEach((wk) => {
        const iw = Number(wk);
        if (iw >= weekRel) return;
        if ((weeklyNightCounts[iw]?.[name] ?? 0) >= 2) u++;
      });
      return u;
    };

    const sortPickNightFixed = (a: ShiftAssignment, b: ShiftAssignment) => {
      const na = nightShiftCounter[a.staffName] || 0;
      const nb = nightShiftCounter[b.staffName] || 0;
      if (na !== nb) return na - nb;
      const daW = weekdayNightBurden(a.staffName);
      const dbW = weekdayNightBurden(b.staffName);
      if (daW !== dbW) return daW - dbW;
      const wa = weeklyNightCounts[weekRel]?.[a.staffName] ?? 0;
      const wb = weeklyNightCounts[weekRel]?.[b.staffName] ?? 0;
      if (wa !== wb) return wa - wb;
      const da = doubleNightWeekBurdenToDate(a.staffName);
      const db = doubleNightWeekBurdenToDate(b.staffName);
      if (da !== db) return da - db;
      const ia = staffIndexByName[a.staffName] ?? 0;
      const ib = staffIndexByName[b.staffName] ?? 0;
      return nightFairnessTieBreaker(staffList, ia, globalWeekIdx) - nightFairnessTieBreaker(staffList, ib, globalWeekIdx);
    };

    if (currentNightCount > 2) {
      const preferredRemovable = nightAssignments.filter((a) => {
        const staff = staffList.find((s) => s.name === a.staffName);
        return staff?.shiftPreference !== 'Night' && staff?.shiftPreference !== 'StudentFixed';
      });
      const protectedNight = nightAssignments.filter((a) => {
        const staff = staffList.find((s) => s.name === a.staffName);
        return staff?.shiftPreference === 'Night';
      });

      const removePool =
        preferredRemovable.length >= currentNightCount - 2 ? preferredRemovable : [...preferredRemovable, ...protectedNight];
      removePool.sort(sortRemoveNight);

      const toRemove = currentNightCount - 2;
      for (let i = 0; i < Math.min(toRemove, removePool.length); i++) {
        const target = removePool[i];
        target.shiftType = 'Day' as any;
        nightShiftCounter[target.staffName] = Math.max(0, (nightShiftCounter[target.staffName] || 0) - 1);
        if (!weeklyNightCounts[weekRel]) weeklyNightCounts[weekRel] = {};
        const wcur = weeklyNightCounts[weekRel][target.staffName] ?? 0;
        weeklyNightCounts[weekRel][target.staffName] = Math.max(0, wcur - 1);
        changed = true;
      }
    }

    const updatedNightCount = day.assignments.filter((a) => isNightAssignment(shiftStr(a))).length;
    if (updatedNightCount < 2) {
      const needed = 2 - updatedNightCount;

      const rotationalReservationCandidates = day.assignments.filter((a) => {
        const staff = staffList.find((s) => s.name === a.staffName);
        return (
          !!staff &&
          staff.department === 'Reservation' &&
          staff.shiftPreference === 'Rotational' &&
          isNightConvertibleWorkSlot(shiftStr(a))
        );
      });

      const fallbackCandidates = day.assignments.filter((a) => {
        const staff = staffList.find((s) => s.name === a.staffName);
        return !!staff && staff.shiftPreference === 'Rotational' && isNightConvertibleWorkSlot(shiftStr(a));
      });

      const rawPool =
        rotationalReservationCandidates.length >= needed
          ? rotationalReservationCandidates
          : [
              ...rotationalReservationCandidates,
              ...fallbackCandidates.filter(
                (a) => !rotationalReservationCandidates.some((r) => r.staffName === a.staffName)
              )
            ];

      const pool = rawPool.filter((a) => canTakeNightForCoverage(schedule, schedIdx, a.staffName));
      pool.sort(sortPickNightFixed);

      const scheduleLen = schedule.length;
      let slotsFilled = 0;

      const commitNightPick = (target: ShiftAssignment) => {
        target.shiftType = 'Night' as any;
        nightShiftCounter[target.staffName] = (nightShiftCounter[target.staffName] || 0) + 1;
        if (!weeklyNightCounts[weekRel]) weeklyNightCounts[weekRel] = {};
        weeklyNightCounts[weekRel][target.staffName] = (weeklyNightCounts[weekRel][target.staffName] ?? 0) + 1;
        changed = true;
        slotsFilled++;
      };

      for (let i = 0; i < pool.length && slotsFilled < needed; i++) {
        commitNightPick(pool[i]);
      }

      /** If still short (e.g. Sunday): few people show calendar “tomorrow = rest”; reshuffle OFF/half rows in-roster-week to expose rest days */
      if (slotsFilled < needed) {
        const rotationalDayAssignments = schedule[schedIdx].assignments.filter((a) => {
          const staff = staffList.find((s) => s.name === a.staffName);
          return !!staff && staff.shiftPreference === 'Rotational' && isNightConvertibleWorkSlot(shiftStr(a));
        });

        rotationalDayAssignments.sort(sortPickNightFixed);

        const tryPrepEligibilityForNight = (name: string): boolean => {
          if (canTakeNightForCoverage(schedule, schedIdx, name)) return true;
          if (
            tryPrepNextDayBySwappingHalf(schedule, schedIdx, name, scheduleLen) ||
            tryPrepNextDayBySwappingFullOff(schedule, schedIdx, name, scheduleLen)
          ) {
            return canTakeNightForCoverage(schedule, schedIdx, name);
          }
          return false;
        };

        for (let i = 0; i < rotationalDayAssignments.length && slotsFilled < needed; i++) {
          const cand = rotationalDayAssignments[i];
          if (!tryPrepEligibilityForNight(cand.staffName)) continue;
          commitNightPick(cand);
        }
      }
    }
  });
  return changed;
}

function enforceNightMinimumCoverageStrict(
  schedule: DailySchedule[],
  staffList: Staff[],
  staffIndexByName: Record<string, number>,
  initialWeekOffset: number,
  nightShiftCounter: Record<string, number>,
  warnings: string[],
  emitDiagnostics = true
): void {
  for (let pass = 0; pass < 24; pass++) {
    Object.assign(nightShiftCounter, rebuildNightCounters(schedule));
    const wk = rebuildWeeklyNightCounts(schedule, staffList);
    const changed = phaseNightCapAndFill(
      schedule,
      staffList,
      staffIndexByName,
      initialWeekOffset,
      nightShiftCounter,
      wk
    );
    const lacking = schedule.filter((d) => d.assignments.filter((a) => isNightAssignment(shiftStr(a))).length < 2);
    if (lacking.length === 0) return;
    if (!changed) break;
  }

  if (emitDiagnostics) {
    for (const d of schedule) {
      const n = d.assignments.filter((a) => isNightAssignment(shiftStr(a))).length;
      if (n < 2) {
        warnings.push(`Night staffing is ${n} (required 2) on ${d.date} — check rotational headcount / rest swaps.`);
      }
    }
  }
}

/**
 * Hard weekly lock for 1.5-off staff:
 * exactly 1x OFF + 1x HALF in each full week slice.
 * This runs late to prevent cross-week drift after night balancing.
 */
function enforceWeeklyOffHardLock(
  schedule: DailySchedule[],
  staffList: Staff[],
  getRequiredWeeklyOff: (staff: Staff) => 1 | 1.5
): void {
  const schedLen = schedule.length;
  if (schedLen < 7) return;

  const canSetShift = (di: number, staff: Staff, nextType: 'Day' | 'OFF' | 'H1-OFF'): boolean => {
    const cell = getAssignment(schedule[di], staff.name);
    if (!cell) return false;
    const before = cell.shiftType;
    cell.shiftType = nextType as any;
    const ok = postNightNonFixedViolations(schedule, staffList) === 0;
    if (!ok) {
      cell.shiftType = before as any;
      return false;
    }
    return true;
  };

  for (let ws = 0; ws + 7 <= schedLen; ws += 7) {
    const we = ws + 7;
    for (const staff of staffList) {
      if (staff.shiftPreference === 'StudentFixed') continue;
      if (getRequiredWeeklyOff(staff) !== 1.5) continue;

      let guard = 0;
      while (guard++ < 100) {
        const restIdx: { i: number; st: string }[] = [];
        const dayIdx: number[] = [];
        for (let i = ws; i < we; i++) {
          const ax = getAssignment(schedule[i], staff.name);
          if (!ax) continue;
          const st = shiftStr(ax);
          if (isFullOffDay(st) || isHalfOffSlot(st)) restIdx.push({ i, st });
          if (st === 'Day') dayIdx.push(i);
        }
        const full = restIdx.filter((x) => isFullOffDay(x.st)).map((x) => x.i);
        const half = restIdx.filter((x) => isHalfOffSlot(x.st)).map((x) => x.i);

        if (full.length === 1 && half.length === 1) break;

        // Reduce extras first.
        if (full.length > 1) {
          let changed = false;
          for (let k = full.length - 1; k >= 0; k--) {
            if (canSetShift(full[k], staff, 'Day')) {
              changed = true;
              break;
            }
          }
          if (changed) continue;
        }
        if (half.length > 1) {
          let changed = false;
          for (let k = half.length - 1; k >= 0; k--) {
            if (canSetShift(half[k], staff, 'Day')) {
              changed = true;
              break;
            }
          }
          if (changed) continue;
        }

        // Fill missing full off.
        if (full.length === 0) {
          let changed = false;
          for (const hi of half) {
            if (canSetShift(hi, staff, 'OFF')) {
              changed = true;
              break;
            }
          }
          if (!changed) {
            for (const di of dayIdx) {
              if (canSetShift(di, staff, 'OFF')) {
                changed = true;
                break;
              }
            }
          }
          if (changed) continue;
        }

        // Fill missing half off.
        if (half.length === 0) {
          let changed = false;
          for (const di of dayIdx) {
            if (canSetShift(di, staff, 'H1-OFF')) {
              changed = true;
              break;
            }
          }
          if (changed) continue;
        }

        // No more safe operations possible this week/staff.
        break;
      }
    }
  }
}

/**
 * Dept floor: ≥1 Day or Night tracked member every day when the dept has ≥2 non-students.
 * Uses OFF/H-half ↔ Day swaps in the same 7-row block (prefer Day swaps to preserve rest-after-night).
 */
function repairDepartmentPresence(
  schedule: DailySchedule[],
  staffList: Staff[],
  warnings: string[]
): boolean {
  const departments = [...new Set(staffList.map((s) => s.department))];
  let repairedAny = false;

  const postNightRepairOk = (): boolean =>
    postNightViolations(schedule, staffList).filter(
      (v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference !== 'Night'
    ).length === 0;

  for (const dept of departments) {
    const members = staffList
      .filter((s) => s.department === dept && s.shiftPreference !== 'StudentFixed')
      .map((s) => s.name);
    const needStrong = minDeptStrongPresenceTarget(members.length);
    if (needStrong < 1) continue;

    outerDay: for (let di = 0; di < schedule.length; di++) {
      let strongPresent = 0;
      for (const nm of members) {
        const ax = getAssignment(schedule[di], nm);
        if (ax && isDeptStrongPresenceAssignment(shiftStr(ax))) strongPresent++;
      }
      if (strongPresent >= needStrong) continue;

      const weekStart = Math.floor(di / 7) * 7;
      const weekEndExclusive = Math.min(weekStart + 7, schedule.length);

      for (const staffName of members) {
        const problem = getAssignment(schedule[di], staffName);
        if (!problem) continue;
        const pst = shiftStr(problem);
        if (!isFullOffDay(pst) && !isHalfOffSlot(pst)) continue;

        /** Prefer swapping with a plain Day elsewhere in the roster week row */
        for (let dj = weekStart; dj < weekEndExclusive; dj++) {
          if (dj === di) continue;
          const alt = getAssignment(schedule[dj], staffName);
          if (!alt || shiftStr(alt) !== 'Day') continue;

          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);

          let strong2 = 0;
          for (const nm of members) {
            const ax = getAssignment(schedule[di], nm);
            if (ax && isDeptStrongPresenceAssignment(shiftStr(ax))) strong2++;
          }

          const okDept = strong2 >= needStrong;
          if (okDept && postNightRepairOk()) {
            repairedAny = true;
            continue outerDay;
          }
          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);
        }

        /** Fall back only if rotating rest still makes room for mandatory Day/Night floor */
        for (let dj = weekStart; dj < weekEndExclusive; dj++) {
          if (dj === di) continue;
          const alt = getAssignment(schedule[dj], staffName);
          if (!alt) continue;
          const ast = shiftStr(alt);
          if (!(ast === 'Night')) continue;

          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);

          let strong2 = 0;
          for (const nm of members) {
            const ax = getAssignment(schedule[di], nm);
            if (ax && isDeptStrongPresenceAssignment(shiftStr(ax))) strong2++;
          }

          const okDept = strong2 >= needStrong;
          if (okDept && postNightRepairOk()) {
            repairedAny = true;
            continue outerDay;
          }
          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);
        }
      }

      warnings.push(
        `[${dept}] No Day/Night-covered member on ${schedule[di].date} (${members.length} staff) — check weekly OFF locks or widen dates`
      );
    }
  }

  return repairedAny;
}

function swapPairBetweenTwoStaff(
  schedule: DailySchedule[],
  di: number,
  dj: number,
  nameA: string,
  nameB: string
): void {
  const aDi = getAssignment(schedule[di], nameA);
  const bDi = getAssignment(schedule[di], nameB);
  const aDj = getAssignment(schedule[dj], nameA);
  const bDj = getAssignment(schedule[dj], nameB);
  if (!aDi || !bDi || !aDj || !bDj) return;
  let t = aDi.shiftType;
  aDi.shiftType = bDi.shiftType;
  bDi.shiftType = t;
  t = aDj.shiftType;
  aDj.shiftType = bDj.shiftType;
  bDj.shiftType = t;
}

/** Per department: minimum morning desk coverage (Day or H2-OFF; Night does not cover morning). */
function repairDepartmentMorningDeskCoverageCore(
  schedule: DailySchedule[],
  staffList: Staff[],
  memberNames: string[],
  minRequired: number,
  deptLabel: string,
  warnings: string[],
  emitDiagnostics: boolean
): boolean {
  if (minRequired < 1 || memberNames.length === 0) return false;

  const postNightRepairOk = (): boolean => postNightNonFixedViolations(schedule, staffList) === 0;

  let repairedAny = false;
  const schedLen = schedule.length;

  for (let pass = 0; pass < schedLen * 8; pass++) {
    let progressed = false;

    nextDay: for (let di = 0; di < schedLen; di++) {
      if (countReservationMorningDesk(schedule, di, memberNames) >= minRequired) continue nextDay;

      const weekStart = Math.floor(di / 7) * 7;
      const weekEndExclusive = Math.min(weekStart + 7, schedLen);

      /** H1→H2 same day */
      for (const staffName of memberNames) {
        if (!canSwapDeptMorningPattern(staffList, staffName)) continue;
        const cell = getAssignment(schedule[di], staffName);
        if (!cell) continue;
        const st = shiftStr(cell);
        if (!st.includes('H1-OFF')) continue;
        const before = cell.shiftType;
        cell.shiftType = 'H2-OFF' as any;
        if (postNightRepairOk() && countReservationMorningDesk(schedule, di, memberNames) >= minRequired) {
          repairedAny = true;
          progressed = true;
          continue nextDay;
        }
        cell.shiftType = before as any;
      }

      if (countReservationMorningDesk(schedule, di, memberNames) >= minRequired) continue nextDay;

      /** Single-staff: OFF or H1 on di ↔ Day or H2 on dj */
      for (const staffName of memberNames) {
        if (!canSwapDeptMorningPattern(staffList, staffName)) continue;
        const problem = getAssignment(schedule[di], staffName);
        if (!problem) continue;
        const pst = shiftStr(problem);
        if (!isFullOffDay(pst) && !pst.includes('H1-OFF')) continue;

        for (let dj = weekStart; dj < weekEndExclusive; dj++) {
          if (dj === di) continue;
          const alt = getAssignment(schedule[dj], staffName);
          if (!alt) continue;
          const ast = shiftStr(alt);
          if (ast !== 'Day' && !ast.includes('H2-OFF')) continue;

          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);

          if (
            postNightRepairOk() &&
            countReservationMorningDesk(schedule, di, memberNames) >= minRequired
          ) {
            repairedAny = true;
            progressed = true;
            continue nextDay;
          }
          swapStaffShiftsAcrossDays(schedule, di, dj, staffName);
        }
      }

      if (countReservationMorningDesk(schedule, di, memberNames) >= minRequired) continue nextDay;

      /** Two-staff complementary exchange */
      for (let dj = weekStart; dj < weekEndExclusive; dj++) {
        if (dj === di) continue;
        for (let ia = 0; ia < memberNames.length; ia++) {
          const nameA = memberNames[ia];
          if (!canSwapDeptMorningPattern(staffList, nameA)) continue;
          for (let ib = 0; ib < memberNames.length; ib++) {
            if (ib === ia) continue;
            const nameB = memberNames[ib];
            if (!canSwapDeptMorningPattern(staffList, nameB)) continue;

            const aDi = getAssignment(schedule[di], nameA);
            const aDj = getAssignment(schedule[dj], nameA);
            const bDi = getAssignment(schedule[di], nameB);
            const bDj = getAssignment(schedule[dj], nameB);
            if (!aDi || !aDj || !bDi || !bDj) continue;

            const stADi = shiftStr(aDi);
            const stADj = shiftStr(aDj);
            const stBDi = shiftStr(bDi);
            const stBDj = shiftStr(bDj);

            if (
              isNightAssignment(stADi) ||
              isNightAssignment(stADj) ||
              isNightAssignment(stBDi) ||
              isNightAssignment(stBDj)
            ) {
              continue;
            }

            const badA_di = !coversReservationMorningDeskCell(stADi);
            const goodB_di = coversReservationMorningDeskCell(stBDi);
            const goodA_dj = coversReservationMorningDeskCell(stADj);
            const badB_dj = !coversReservationMorningDeskCell(stBDj);

            if (!(badA_di && goodB_di && goodA_dj && badB_dj)) continue;

            const pairCreditA = shiftWeeklyRestCredit(stADi) + shiftWeeklyRestCredit(stADj);
            const pairCreditB = shiftWeeklyRestCredit(stBDi) + shiftWeeklyRestCredit(stBDj);
            if (Math.abs(pairCreditA - pairCreditB) > 1e-6) continue;

            swapPairBetweenTwoStaff(schedule, di, dj, nameA, nameB);

            if (
              postNightRepairOk() &&
              countReservationMorningDesk(schedule, di, memberNames) >= minRequired
            ) {
              repairedAny = true;
              progressed = true;
              continue nextDay;
            }
            swapPairBetweenTwoStaff(schedule, di, dj, nameA, nameB);
          }
        }
      }
    }

    if (!progressed) break;
  }

  if (emitDiagnostics) {
    for (let di = 0; di < schedLen; di++) {
      const c = countReservationMorningDesk(schedule, di, memberNames);
      if (c < minRequired) {
        warnings.push(
          `[${deptLabel}] Morning desk (8:30–13) has ${c} (need ${minRequired}) on ${schedule[di].date} (${schedule[di].dayOfWeek})`
        );
      }
    }
  }

  return repairedAny;
}

/** ≥2 Reservation staff on morning desk each day */
function repairReservationMorningDeskCoverage(
  schedule: DailySchedule[],
  staffList: Staff[],
  warnings: string[],
  emitDiagnostics = true
): boolean {
  const coverageNames = reservationCoverageMemberNames(staffList);
  if (coverageNames.length < RESERVATION_MIN_MORNING_DESK) {
    if (coverageNames.length > 0) {
      warnings.push(
        `Reservation has only ${coverageNames.length} staff — cannot meet ${RESERVATION_MIN_MORNING_DESK} morning desk daily`
      );
    }
    return false;
  }
  return repairDepartmentMorningDeskCoverageCore(
    schedule,
    staffList,
    coverageNames,
    RESERVATION_MIN_MORNING_DESK,
    'Reservation',
    warnings,
    emitDiagnostics
  );
}

/** Non-Reservation depts: morning minimum scales with headcount (e.g. 2 QC → at least 1 morning). */
function repairNonReservationDepartmentsMorningDeskCoverage(
  schedule: DailySchedule[],
  staffList: Staff[],
  warnings: string[],
  emitDiagnostics = true
): boolean {
  let repairedAny = false;
  const depts = [...new Set(staffList.map((s) => s.department))].filter((d) => d !== 'Reservation');
  for (const dept of depts) {
    const names = deptMorningCoverageMemberNames(staffList, dept);
    const minR = minDeptMorningDeskTarget(names.length);
    if (minR < 1) continue;
    repairedAny =
      repairDepartmentMorningDeskCoverageCore(
        schedule,
        staffList,
        names,
        minR,
        dept,
        warnings,
        emitDiagnostics
      ) || repairedAny;
  }
  return repairedAny;
}

function rosterFingerprint(schedule: DailySchedule[]): string {
  return schedule
    .map((d) => d.assignments.map((a) => `${a.staffName}:${String(a.shiftType)}`).join('|'))
    .join('||');
}

export function generateLocalRoster(
  staffList: Staff[],
  holidays: string[],
  extraPeakDays: string[],
  startDateStr: string,
  endDateStr: string,
  initialWeekOffset: number = 0,
  offIndexOverrides?: Record<string, number>
): { generatedSchedule: DailySchedule[]; warnings: string[] } {
  const startDate = parseISO(startDateStr);
  const endDate = parseISO(endDateStr);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  
  const schedule: DailySchedule[] = [];
  const warnings: string[] = [];
  const getRequiredWeeklyOff = (staff: Staff): 1 | 1.5 => {
    if (staff.weeklyOffDays === 1 || staff.weeklyOffDays === 1.5) return staff.weeklyOffDays;
    return staff.department === 'Housekeeping' ? 1 : 1.5;
  };
  const housekeepingStaffCount = staffList.filter((s) => s.department === 'Housekeeping').length;
  if (housekeepingStaffCount > 0 && housekeepingStaffCount < 2) {
    warnings.push('Housekeeping has fewer than 2 staff members; minimum daily 2-person presence cannot be met.');
  }

  const nightShiftCounter: Record<string, number> = {};
  staffList.forEach((s) => (nightShiftCounter[s.name] = 0));

  const monthlyGuaranteedGroups: Record<string, Staff[]> = {};
  staffList.forEach((staff) => {
    if (staff.guaranteedOffFrequency !== 'monthly' || !staff.guaranteedOffDay) return;
    const key = `${staff.department}__${staff.guaranteedOffDay}`;
    if (!monthlyGuaranteedGroups[key]) monthlyGuaranteedGroups[key] = [];
    monthlyGuaranteedGroups[key].push(staff);
  });

  const baseOffIdxPerStaff = staffList.map((staff, staffIdx) => {
    const guaranteeFreq = staff.guaranteedOffFrequency ?? 'none';
    const overrideOffIdx = offIndexOverrides?.[staff.name];
    const listSlot = staffRotationSlot(staffList, staffIdx);
    const prefIdx =
      guaranteeFreq === 'none' && staff.defaultOffDay && DAY_MAP[staff.defaultOffDay] !== undefined
        ? DAY_MAP[staff.defaultOffDay]
        : undefined;
    if (overrideOffIdx !== undefined) return overrideOffIdx;
    return prefIdx !== undefined ? (prefIdx + listSlot) % 7 : listSlot;
  });

  spreadDeptSeparateFullOffAnchors(staffList, baseOffIdxPerStaff, offIndexOverrides);

  // Phase 1: pattern + connectivity (night before programmed rest days)
  days.forEach((day, dayIdx) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const weekIdx = Math.floor(dayIdx / 7) + initialWeekOffset;
    const dayInWeekIdx = (getDay(day) + 6) % 7;

    const dailyAssignments: ShiftAssignment[] = staffList.map((staff, staffIdx) => {
      const requiredWeeklyOff = getRequiredWeeklyOff(staff);
      const guaranteeFreq = staff.guaranteedOffFrequency ?? 'none';

      const baseOffIdx = baseOffIdxPerStaff[staffIdx];
      let rotatedDayOffIdx = (baseOffIdx + weekIdx) % 7;

      if (staff.guaranteedOffDay && DAY_MAP[staff.guaranteedOffDay] !== undefined) {
        const guaranteedIdx = DAY_MAP[staff.guaranteedOffDay];
        if (guaranteeFreq === 'weekly') {
          rotatedDayOffIdx = guaranteedIdx;
        } else if (guaranteeFreq === 'monthly') {
          const groupKey = `${staff.department}__${staff.guaranteedOffDay}`;
          const group = monthlyGuaranteedGroups[groupKey] || [];
          const staffOrder = group.findIndex((s) => s.name === staff.name);
          if (staffOrder !== -1) {
            const isMonthlyTurn = (weekIdx + staffOrder) % 4 === 0;
            if (isMonthlyTurn) rotatedDayOffIdx = guaranteedIdx;
          }
        }
      }
      
      const rotatedHalfOffIdx = (rotatedDayOffIdx + 4) % 7; 

      let shiftType: 'Day' | 'Night' | 'OFF' | 'H1-OFF' | 'H2-OFF' = 'Day';

      if (dayInWeekIdx === rotatedDayOffIdx) {
        shiftType = 'OFF';
      } else if (requiredWeeklyOff === 1.5 && dayInWeekIdx === rotatedHalfOffIdx) {
        shiftType = 'H1-OFF';
      } else {
        if (staff.shiftPreference === 'StudentFixed') {
          if (staff.studentPatternMode === 'summer') {
            shiftType = 'Day';
          } else {
            const todayName = DAY_NAMES[dayInWeekIdx] as keyof NonNullable<Staff['studentWeeklyPattern']>;
            const patternValue = staff.studentWeeklyPattern?.[todayName];
            shiftType = patternValue === 'Night' ? 'Night' : 'Day';
          }
        } else {
          shiftType = staff.shiftPreference === 'Night' ? 'Night' : 'Day';
        }
      }

      const tomorrowInWeekIdx = (dayInWeekIdx + 1) % 7;
      const isTomorrowRest =
        tomorrowInWeekIdx === rotatedDayOffIdx || tomorrowInWeekIdx === rotatedHalfOffIdx;

      if (
        isTomorrowRest &&
        staff.shiftPreference !== 'Day' &&
        staff.shiftPreference !== 'StudentFixed' &&
        shiftType !== 'OFF'
      ) {
        shiftType = 'Night';
      }

      if (staff.shiftPreference === 'Day' && shiftType === 'Night') {
        shiftType = 'Day';
      }

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

  const phase1ShiftSnapshot = buildShiftTypeSnapshot(schedule);

  Object.assign(nightShiftCounter, rebuildNightCounters(schedule));

  const staffIndexByName: Record<string, number> = {};
  staffList.forEach((s, i) => {
    staffIndexByName[s.name] = i;
  });

  // Phase housekeeping
  const housekeepingForcedCoverCounter: Record<string, number> = {};
  staffList
    .filter((s) => s.department === 'Housekeeping')
    .forEach((s) => {
      housekeepingForcedCoverCounter[s.name] = 0;
    });

  schedule.forEach((day) => {
    const housekeepingAssignments = day.assignments.filter((a) => a.department === 'Housekeeping');
    if (housekeepingAssignments.length === 0) return;

    let presentCount = housekeepingAssignments.filter((a) => shiftStr(a) === 'Day').length;
    if (presentCount >= 2) return;

    const needed = 2 - presentCount;
    const convertible = housekeepingAssignments
      .filter((a) => shiftStr(a) === 'OFF' || isHalfOffSlot(shiftStr(a)))
      .sort((a, b) => (housekeepingForcedCoverCounter[a.staffName] || 0) - (housekeepingForcedCoverCounter[b.staffName] || 0));

    for (let i = 0; i < Math.min(needed, convertible.length); i++) {
      convertible[i].shiftType = 'Day' as any;
      housekeepingForcedCoverCounter[convertible[i].staffName] =
        (housekeepingForcedCoverCounter[convertible[i].staffName] || 0) + 1;
      presentCount++;
    }

    if (presentCount < 2) {
      warnings.push(`Housekeeping minimum coverage not met on ${day.date} (present: ${presentCount}, required: 2).`);
    }
  });

  // Single convergence pipeline (prevents duplicate/contradictory passes).
  for (let pass = 0; pass < 40; pass++) {
    const before = rosterFingerprint(schedule);

    Object.assign(nightShiftCounter, rebuildNightCounters(schedule));
    const wk = rebuildWeeklyNightCounts(schedule, staffList);
    phaseNightCapAndFill(schedule, staffList, staffIndexByName, initialWeekOffset, nightShiftCounter, wk);

    const nonFixedViol = postNightViolations(schedule, staffList).filter(
      (v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference !== 'Night'
    );
    if (nonFixedViol.length > 0) demotePostNightViolations(schedule, staffList, nonFixedViol);

    repairDepartmentPresence(schedule, staffList, warnings);
    repairReservationMorningDeskCoverage(schedule, staffList, warnings, false);
    repairNonReservationDepartmentsMorningDeskCoverage(schedule, staffList, warnings, false);

    enforceWeeklyOffExactQuota(schedule, staffList, getRequiredWeeklyOff, warnings, false);
    normalizeWeeklyOffShapeStrict(schedule, staffList, getRequiredWeeklyOff, warnings);
    enforceWeeklyOffHardLock(schedule, staffList, getRequiredWeeklyOff);

    balanceReservationRotationalNightsPerWeek(schedule, staffList, initialWeekOffset);

    const after = rosterFingerprint(schedule);
    if (after === before) break;
  }

  // Final lock order: nights >=2, fairness, then exact weekly OFF, then final diagnostics.
  enforceNightMinimumCoverageStrict(
    schedule,
    staffList,
    staffIndexByName,
    initialWeekOffset,
    nightShiftCounter,
    warnings,
    false
  );
  balanceReservationRotationalNightsPerWeek(schedule, staffList, initialWeekOffset);
  enforceWeeklyOffExactQuota(schedule, staffList, getRequiredWeeklyOff, warnings, true);
  normalizeWeeklyOffShapeStrict(schedule, staffList, getRequiredWeeklyOff, warnings);
  enforceWeeklyOffHardLock(schedule, staffList, getRequiredWeeklyOff);
  repairReservationMorningDeskCoverage(schedule, staffList, warnings, true);
  repairNonReservationDepartmentsMorningDeskCoverage(schedule, staffList, warnings, true);

  const allRestViol = postNightViolations(schedule, staffList);
  if (allRestViol.length > 0) {
    const fixedNightNamed = [
      ...new Set(
        allRestViol
          .filter((v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference === 'Night')
          .map((v) => v.staffName)
      ),
    ];
    if (fixedNightNamed.length > 0) {
      warnings.push(
        `Fixed-night staff lack OFF/half-rest after some night (${fixedNightNamed.join(', ')}) — review or extend roster window.`
      );
    }
    const other = allRestViol.filter(
      (v) => staffList.find((s) => s.name === v.staffName)?.shiftPreference !== 'Night'
    );
    if (other.length > 0) {
      warnings.push('Rest-after-night could not be fully satisfied for some shifts (boundary days or overlaps).');
    }
  }

  enforceNightMinimumCoverageStrict(
    schedule,
    staffList,
    staffIndexByName,
    initialWeekOffset,
    nightShiftCounter,
    warnings,
    true
  );

  const last = schedule[schedule.length - 1];
  if (last?.assignments.some((a) => isNightAssignment(shiftStr(a)))) {
    warnings.push(
      'End-date has night shifts — the following calendar day must be OFF/half-rest for those people (next roster block or manual).'
    );
  }

  applyPostGenerationMutationTags(schedule, phase1ShiftSnapshot);

  return { generatedSchedule: schedule, warnings };
}
