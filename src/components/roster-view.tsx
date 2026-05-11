
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getStore, saveActiveRoster, archiveCurrentRoster, updateRosterShift, swapWeeklyPatterns } from '@/lib/store';
import { generateLocalRoster } from '@/lib/roster-algorithm';
import {
  validateRoster,
  type ValidatorId,
  type RosterValidationResult,
  type RosterViolation,
} from '@/lib/roster-validator-engine';
import { stampAssignmentsWithDraft } from '@/lib/roster-mutation-meta';
import { RosterShiftMutationDropdownCell } from '@/components/roster-shift-mutation-cell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { 
  Calculator, 
  Calendar as CalendarIcon,
  RefreshCw,
  FileDown,
  ArrowLeftRight,
  ChevronDown,
  Check,
  Scale,
  AlertCircle,
  ShieldCheck,
  Loader2,
  ChevronRight,
  History
} from 'lucide-react';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const VALIDATOR_UI: { id: ValidatorId; label: string }[] = [
  { id: 'exactOffCount', label: 'Exact OFF count' },
  { id: 'nightCoverage', label: 'Night coverage' },
  { id: 'nightRecovery', label: 'Night recovery' },
  { id: 'sundayFairness', label: 'Sunday fairness' },
  { id: 'rotationalNightBalance', label: 'Rotational night balance' },
  { id: 'offDiversity', label: 'OFF diversity' },
];

const SHIFT_TYPES = ['Day', 'Night', 'OFF', 'H1-OFF', 'H2-OFF'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const getShiftLabel = (type: string) => {
  if (type === 'H1-OFF') return '8:30-13';
  if (type === 'H2-OFF') return '13-18';
  return type;
};
export function RosterView() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [activeRoster, setActiveRoster] = useState<any>(null);
  
  // Dialog States
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [showConfirmNext, setShowConfirmNext] = useState(false);
  const [confirmStep, setConfirmStep] = useState(1);

  // Swap Tool States
  const [swapSourceStaff, setSwapSourceStaff] = useState<string | null>(null);
  const [selectedWeekDates, setSelectedWeekDates] = useState<string[]>([]);
  const [refDayIdx, setRefDayIdx] = useState<number>(0);
  const [targetCategory, setTargetCategory] = useState<'half' | 'full' | 'night' | null>(null);
  const [targetDayIdx, setTargetDayIdx] = useState<number | null>(null);

  // Sync Tool States
  const [syncWeekIdx, setSyncWeekIdx] = useState<number | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

  /** Validation diagnostics (runs after roster generation/sync and on schedule edits via activeRoster refresh). Matches engine output shape. */
  const [rosterValidation, setRosterValidation] = useState<RosterValidationResult | null>(null);
  const [validationErrorsOnly, setValidationErrorsOnly] = useState(false);
  /** When true, show subtle mutation provenance on shift cells (dot + ring + hover tooltip). */
  const [showMutationMetadata, setShowMutationMetadata] = useState(false);

  useEffect(() => {
    const store = getStore();
    setActiveRoster(store.activeRoster);
  }, []);

  useEffect(() => {
    if (!activeRoster?.schedules?.length) {
      setRosterValidation(null);
      return;
    }
    const store = getStore();
    const result = validateRoster(activeRoster.schedules, store.staff);
    setRosterValidation(result);
  }, [activeRoster]);

  const runPrint = (scope: 'all' | 'single', targetId?: string) => {
    const previousScope = document.body.dataset.printScope;
    const selectedBefore = Array.from(document.querySelectorAll('.week-container.print-selected'));
    const targetEl = targetId ? document.getElementById(targetId) : null;

    document.body.dataset.printScope = scope;
    if (scope === 'single' && targetEl) {
      targetEl.classList.add('print-selected');
    }

    const cleanup = () => {
      if (targetEl) targetEl.classList.remove('print-selected');
      selectedBefore.forEach((el) => el.classList.add('print-selected'));

      if (previousScope) {
        document.body.dataset.printScope = previousScope;
      } else {
        delete document.body.dataset.printScope;
      }
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
  };

  const initiateNewBlock = () => {
    const store = getStore();
    if (store.activeRoster) {
      setConfirmStep(1);
      setShowConfirmNext(true);
    } else {
      executeGeneration();
    }
  };

  const executeGeneration = () => {
    setLoading(true);
    setShowConfirmNext(false);
    
    const store = getStore();
    if (store.activeRoster) {
      archiveCurrentRoster();
    }

    const currentStore = getStore();
    let start = startOfWeek(new Date(), { weekStartsOn: 1 });
    const latestRoster = currentStore.history.length > 0 ? currentStore.history[0] : null;
    
    if (latestRoster) {
      start = addDays(parseISO(latestRoster.endDate), 1);
    }
    
    const startDate = format(start, 'yyyy-MM-dd');
    const endDate = format(addDays(start, 48), 'yyyy-MM-dd');

    const totalArchivedWeeks = currentStore.history.reduce((acc, r) => acc + (r.schedules.length / 7), 0);

    try {
      const result = generateLocalRoster(
        currentStore.staff, 
        currentStore.holidays, 
        currentStore.extraPeakDays, 
        startDate, 
        endDate, 
        totalArchivedWeeks
      );
      
      const newRoster = {
        id: Math.random().toString(36).substr(2, 9),
        startDate,
        endDate,
        status: 'DRAFT' as const,
        generatedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        schedules: result.generatedSchedule
      };

      saveActiveRoster(newRoster);
      setActiveRoster(newRoster);
      toast({ title: "New 7-Week Block", description: `Rotation continued from Week ${totalArchivedWeeks + 1}` });
    } catch (error: any) {
      toast({ title: "Generation Failed", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setConfirmStep(1);
    }
  };

  const handleManualChange = (staffName: string, date: string, newType: string) => {
    if (!activeRoster) return;
    const dayLabel =
      activeRoster.schedules.find((s: { date: string }) => s.date === date)?.dayOfWeek ?? date;
    updateRosterShift(activeRoster.id, date, staffName, newType, {
      origin: 'manual_override',
      actor: staffName,
      relatedStaff: [staffName],
      notes: `Roster grid — ${dayLabel} (${date})`,
    });
    const store = getStore();
    setActiveRoster({ ...store.activeRoster });
  };

  const executePatternSwap = (targetStaff: string) => {
    if (!swapSourceStaff || !selectedWeekDates.length || !activeRoster) return;
    const chosenIdx = targetDayIdx ?? refDayIdx ?? 0;
    const chosenDate = selectedWeekDates[chosenIdx];
    const chosenDay = activeRoster.schedules.find((s: any) => s.date === chosenDate);
    const sourceType = chosenDay?.assignments.find((a: any) => a.staffName === swapSourceStaff)?.shiftType || 'Day';
    const targetType = chosenDay?.assignments.find((a: any) => a.staffName === targetStaff)?.shiftType || 'Day';

    if (sourceType !== targetType) {
      toast({
        title: "Swap Notice",
        description: `${swapSourceStaff} (${sourceType}) swaps with ${targetStaff} (${targetType}) on ${DAYS_SHORT[chosenIdx]}.`,
      });
    }

    swapWeeklyPatterns(activeRoster.id, selectedWeekDates, swapSourceStaff, targetStaff);
    const store = getStore();
    setActiveRoster({ ...store.activeRoster });
    setIsSwapOpen(false);
    toast({ title: "Patterns Swapped", description: "Operation complete." });
  };

  const validateWeek = (weekDates: string[]) => {
    const warnings: string[] = [];
    const store = getStore();
    const staffList = store.staff;
    const getRequiredWeeklyOff = (staff: any): 1 | 1.5 => {
      if (staff.weeklyOffDays === 1 || staff.weeklyOffDays === 1.5) return staff.weeklyOffDays;
      return staff.department === 'Housekeeping' ? 1 : 1.5;
    };

    staffList.forEach(staff => {
      let offDays = 0;
      weekDates.forEach(date => {
        const day = activeRoster.schedules.find((s: any) => s.date === date);
        const assignment = day?.assignments.find((a: any) => a.staffName === staff.name);
        if (assignment?.shiftType === 'OFF') offDays += 1;
        if (assignment?.shiftType.includes('H')) offDays += 0.5;
      });
      const requiredOffDays = getRequiredWeeklyOff(staff);
      if (offDays !== requiredOffDays) {
        warnings.push(`${staff.name}: OFF-day total is ${offDays} (Requirement: ${requiredOffDays} days).`);
      }
      if (staff.department === 'Housekeeping' && staff.shiftPreference === 'Day') {
        weekDates.forEach((date) => {
          const day = activeRoster.schedules.find((s: any) => s.date === date);
          const assignment = day?.assignments.find((a: any) => a.staffName === staff.name);
          const allowed = requiredOffDays === 1.5 ? ['Day', 'OFF', 'H1-OFF', 'H2-OFF'] : ['Day', 'OFF'];
          if (assignment?.shiftType && !allowed.includes(assignment.shiftType)) {
            warnings.push(`${staff.name}: Day-only housekeeping preference conflicts with ${assignment.shiftType} on ${format(parseISO(date), 'EEE')}.`);
          }
        });
      }
    });

    const rotationalStaff = staffList.filter(s => s.shiftPreference === 'Rotational');
    if (rotationalStaff.length > 0) {
      const nightCounts: Record<string, number> = {};
      rotationalStaff.forEach(s => nightCounts[s.name] = 0);

      weekDates.forEach(date => {
        const day = activeRoster.schedules.find((s: any) => s.date === date);
        day?.assignments.forEach((a: any) => {
          if (a.shiftType.includes('Night') && nightCounts[a.staffName] !== undefined) {
            nightCounts[a.staffName]++;
          }
        });
      });

      const total = Object.values(nightCounts).reduce((a, b) => a + b, 0);
      const avg = total / rotationalStaff.length;
      rotationalStaff.forEach(s => {
        const count = nightCounts[s.name];
        if (Math.abs(count - avg) > 1.5) {
          warnings.push(`Night Imbalance: ${s.name} has ${count} shifts (Rotational average: ${avg.toFixed(1)}).`);
        }
      });
    }

    weekDates.forEach(date => {
      const day = activeRoster.schedules.find((s: any) => s.date === date);
      const halfDayNight = day?.assignments.filter((a: any) => a.shiftType.includes('Night') && a.shiftType.includes('H'));
      if (halfDayNight && halfDayNight.length > 0) {
        halfDayNight.forEach((a: any) => {
          const others = day.assignments.filter((oa: any) => oa.staffName !== a.staffName && oa.shiftType.includes('Night'));
          if (others.length < 2) {
            warnings.push(`Critical Coverage: On ${format(parseISO(date), 'EEE')}, ${a.staffName} is on a half-turn. Two backup night staff are required.`);
          }
        });
      }
    });

    return warnings;
  };

  const handleSyncClick = (weekDates: string[], weekIdx: number) => {
    setSyncWarnings(validateWeek(weekDates));
    setSyncWeekIdx(weekIdx);
    setIsSyncOpen(true);
  };

  const handleSyncSubmit = (impact: 'current' | 'future') => {
    if (impact === 'future' && syncWeekIdx !== null && activeRoster) {
      const store = getStore();
      const nextWeekStartIdx = (syncWeekIdx + 1) * 7;
      
      if (nextWeekStartIdx < activeRoster.schedules.length) {
        const totalArchivedWeeks = store.history.reduce((acc, r) => acc + (r.schedules.length / 7), 0);
        const globalWeekIdx = totalArchivedWeeks + syncWeekIdx;
        const nextStartDate = format(parseISO(activeRoster.schedules[nextWeekStartIdx].date), 'yyyy-MM-dd');
        const syncedWeekDates = activeRoster.schedules
          .slice(syncWeekIdx * 7, (syncWeekIdx + 1) * 7)
          .map((s: any) => s.date);

        // Build future OFF baseline from the finalized week.
        const offIndexOverrides: Record<string, number> = {};
        store.staff.forEach((staff) => {
          let offDayIdx = -1;
          for (let i = 0; i < syncedWeekDates.length; i++) {
            const date = syncedWeekDates[i];
            const day = activeRoster.schedules.find((s: any) => s.date === date);
            const assignment = day?.assignments.find((a: any) => a.staffName === staff.name);
            if (assignment?.shiftType === 'OFF') {
              offDayIdx = i;
              break;
            }
          }

          if (offDayIdx === -1) return;

          // In generator, rotated OFF index = (baseOffIdx + globalWeekIdx) % 7.
          // So derive baseOffIdx from the finalized week's GLOBAL index.
          offIndexOverrides[staff.name] = (offDayIdx - globalWeekIdx + 7000) % 7;
        });
        
        const result = generateLocalRoster(
          store.staff,
          store.holidays,
          store.extraPeakDays,
          nextStartDate,
          format(parseISO(activeRoster.endDate), 'yyyy-MM-dd'),
          totalArchivedWeeks + syncWeekIdx + 1,
          offIndexOverrides
        );

        const newSchedules = [...activeRoster.schedules];
        const regeneratedLen = result.generatedSchedule.length;
        newSchedules.splice(nextWeekStartIdx, regeneratedLen, ...result.generatedSchedule);

        stampAssignmentsWithDraft(newSchedules, nextWeekStartIdx, nextWeekStartIdx + regeneratedLen, {
          origin: 'future_propagation',
          affectsFuture: true,
          propagated: true,
          notes: 'Future segment rebuilt after week sync / OFF baseline propagation',
        });

        const newRoster = { ...activeRoster, schedules: newSchedules, lastModifiedAt: new Date().toISOString() };
        saveActiveRoster(newRoster);
        setActiveRoster(newRoster);
        toast({ title: "Future Impact Applied", description: "Remaining weeks updated based on weekly rotation." });
      }
    } else {
      toast({ title: "Week Updated", description: "Manual changes preserved." });
    }
    setIsSyncOpen(false);
  };

  const staffNames = useMemo((): string[] => {
    if (!activeRoster || activeRoster.schedules.length === 0) return [];
    return Array.from(
      new Set(
        activeRoster.schedules[0].assignments.map((a: { staffName?: string }) => String(a.staffName ?? ''))
      )
    );
  }, [activeRoster]);

  const staffByName = useMemo(() => {
    const store = getStore();
    return new Map(store.staff.map((s) => [s.name, s] as const));
  }, [activeRoster]);

  const weeks = useMemo((): string[][] => {
    if (!activeRoster) return [];
    const dates: string[] = activeRoster.schedules.map((s: { date: string }) => s.date);
    const w: string[][] = [];
    for (let i = 0; i < dates.length; i += 7) {
      w.push(dates.slice(i, i + 7));
    }
    return w;
  }, [activeRoster]);

  const validationPanels = useMemo(() => {
    if (!rosterValidation) return null;
    const v = rosterValidation.violations;
    return VALIDATOR_UI.map(({ id, label }) => {
      const forVal = v.filter((x) => x.validator === id);
      const errN = forVal.filter((x) => x.severity === 'error').length;
      const warnN = forVal.filter((x) => x.severity === 'warning').length;
      const visible = validationErrorsOnly
        ? forVal.filter((x) => x.severity === 'error')
        : forVal;
      let status: 'pass' | 'fail' | 'warn' = 'pass';
      if (errN > 0) status = 'fail';
      else if (warnN > 0) status = 'warn';
      return { id, label, errN, warnN, forVal, visible, status };
    });
  }, [rosterValidation, validationErrorsOnly]);

  const violationStaffCell = (row: RosterViolation) => {
    const fromMeta =
      Array.isArray(row.meta?.staffNames) && row.meta!.staffNames.length
        ? (row.meta!.staffNames as string[]).join(', ')
        : '';
    return row.staffName || fromMeta || '—';
  };

  const validationTotals = useMemo(() => {
    if (!rosterValidation) return null;
    const v = rosterValidation.violations;
    return {
      errors: v.filter((x) => x.severity === 'error').length,
      warnings: v.filter((x) => x.severity === 'warning').length,
    };
  }, [rosterValidation]);

  const validatorRollup = useMemo(() => {
    if (!rosterValidation) return null;
    let pass = 0;
    let fail = 0;
    let warnOnly = 0;
    for (const { id } of VALIDATOR_UI) {
      const forVal = rosterValidation.violations.filter((x) => x.validator === id);
      const errN = forVal.filter((x) => x.severity === 'error').length;
      const warnN = forVal.filter((x) => x.severity === 'warning').length;
      if (errN) fail++;
      else if (warnN) warnOnly++;
      else pass++;
    }
    return { pass, fail, warnOnly };
  }, [rosterValidation]);

  const getShiftStyles = (type: string) => {
    if (type === 'OFF') return 'bg-red-500 text-white border-red-600'; 
    if (type.includes('H')) return 'bg-amber-400 text-amber-950 border-amber-500';
    if (type.startsWith('Night')) return 'bg-blue-900 text-white border-blue-950';
    if (type === 'Day') return 'bg-sky-100 text-sky-800 border-sky-200';
    return 'bg-muted';
  };

  const availablePartners = useMemo(() => {
    if (!swapSourceStaff || !selectedWeekDates.length || targetCategory === null || targetDayIdx === null || !activeRoster) return [];
    const store = getStore();
    const staffByName = new Map(store.staff.map((s) => [s.name, s]));
    const selectedDate = selectedWeekDates[targetDayIdx!];
    const nextDayIdx = (targetDayIdx! + 1) % 7;
    const nextDate = selectedWeekDates[nextDayIdx];

    const getAssignmentType = (staffName: string, date: string) => {
      const day = activeRoster.schedules.find((s: any) => s.date === date);
      return day?.assignments.find((a: any) => a.staffName === staffName)?.shiftType || 'Day';
    };

    const isNightSupportEligible = (staffName: string) => {
      const profile = staffByName.get(staffName);
      if (!profile) return false;
      if (profile.department !== 'Reservation' || profile.shiftPreference !== 'Rotational') return false;
      const todayType = getAssignmentType(staffName, selectedDate);
      const tomorrowType = getAssignmentType(staffName, nextDate);
      return todayType === 'Day' && (tomorrowType === 'OFF' || tomorrowType.includes('H'));
    };

    return staffNames
      .filter(name => name !== swapSourceStaff)
      .map(name => {
        const shiftType = getAssignmentType(name, selectedDate);
        let isMatch = false;
        let matchReason = '';

        if (targetCategory === 'half' && shiftType.includes('H')) isMatch = true;
        if (targetCategory === 'full' && shiftType === 'OFF') isMatch = true;
        if (targetCategory === 'night') {
          const alreadyNight = shiftType.includes('Night');
          const supportEligible = isNightSupportEligible(name);
          isMatch = alreadyNight || supportEligible;
          if (alreadyNight) {
            matchReason = `Already Night on ${DAYS_SHORT[targetDayIdx!]}`;
          } else if (supportEligible) {
            matchReason = `Can support Night (${DAYS_SHORT[nextDayIdx]} is ${getAssignmentType(name, nextDate)})`;
          }
        }

        if (!isMatch) return null;

        if (!matchReason) {
          matchReason = `Matches ${targetCategory.toUpperCase()} on ${DAYS_SHORT[targetDayIdx!]}`;
        }

        const ownNightDays = selectedWeekDates
          .map((date, idx) => ({ date, idx, type: getAssignmentType(name, date) }))
          .filter((d) => d.type.includes('Night'));

        const ownNightNotes = ownNightDays.length
          ? ownNightDays.map((d) => DAYS_SHORT[d.idx]).join(', ')
          : 'None';

        const ownNightSwapOptions = ownNightDays.map((d) => {
          const options = staffNames.filter((candidateName) => {
            if (candidateName === name) return false;
            const candidateType = getAssignmentType(candidateName, d.date);
            if (candidateType.includes('Night')) return true;

            // Same eligibility logic for replacing a night shift
            const candidateNextIdx = (d.idx + 1) % 7;
            const candidateNextDate = selectedWeekDates[candidateNextIdx];
            const profile = staffByName.get(candidateName);
            if (!profile) return false;
            return (
              profile.department === 'Reservation' &&
              profile.shiftPreference === 'Rotational' &&
              candidateType === 'Day' &&
              (() => {
                const nextType = getAssignmentType(candidateName, candidateNextDate);
                return nextType === 'OFF' || nextType.includes('H');
              })()
            );
          });
          return { day: DAYS_SHORT[d.idx], options };
        });

        return { name, matchReason, ownNightNotes, ownNightSwapOptions };
      })
      .filter(p => p !== null) as any[];
  }, [swapSourceStaff, selectedWeekDates, targetCategory, targetDayIdx, activeRoster, staffNames]);

  return (
    <TooltipProvider delayDuration={280}>
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-headline font-bold text-foreground text-primary">Active Roster</h2>
            {activeRoster && <Badge className="bg-blue-100 text-blue-700 border-blue-200">Live Block</Badge>}
          </div>
          <p className="text-muted-foreground text-sm font-medium">
            {activeRoster ? `Range: ${activeRoster.startDate} — ${activeRoster.endDate}` : 'No active cycle.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 no-print">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
            <Switch id="roster-mutation-meta" checked={showMutationMetadata} onCheckedChange={setShowMutationMetadata} />
            <Label htmlFor="roster-mutation-meta" className="cursor-pointer text-xs font-medium text-muted-foreground">
              Show mutation metadata
            </Label>
          </div>
          <Button
            variant="outline"
            onClick={() => runPrint('all')}
            disabled={!activeRoster}
            className="border-primary/20 text-primary"
          >
            <FileDown className="w-4 h-4 mr-2" />
            PDF Export (All Weeks)
          </Button>
          <Button onClick={initiateNewBlock} disabled={loading} className="bg-primary shadow-lg shadow-primary/20">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
            New 7-Week Block
          </Button>
        </div>
      </div>

      {activeRoster && rosterValidation && validationPanels && validationTotals && validatorRollup && (
        <Card className="border-primary/15 shadow-sm rounded-2xl overflow-hidden no-print">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg font-headline text-primary flex items-center gap-2">
                  <Scale className="w-5 h-5" /> Roster validation
                </CardTitle>
                <CardDescription className="text-sm mt-1">
                  Engine checks after each schedule update (same rules as standalone <code className="text-xs rounded bg-muted px-1 py-0.5">validateRoster</code>).
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Badge
                  className={cn(
                    'text-xs font-semibold shrink-0',
                    rosterValidation.valid
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-red-100 text-red-800 border-red-300'
                  )}
                >
                  {rosterValidation.valid ? 'Valid' : 'Invalid'}
                </Badge>
                <div className="flex items-center gap-2">
                  <Switch
                    id="validation-errors-only"
                    checked={validationErrorsOnly}
                    onCheckedChange={setValidationErrorsOnly}
                  />
                  <Label htmlFor="validation-errors-only" className="text-sm font-medium whitespace-nowrap cursor-pointer">
                    Show only errors
                  </Label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
              <div className="rounded-xl border bg-white p-3 shadow-sm border-red-200/80">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Total errors</p>
                <p className="text-2xl font-bold text-red-700 tabular-nums">{validationTotals.errors}</p>
              </div>
              <div className="rounded-xl border bg-white p-3 shadow-sm border-amber-200/80">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Total warnings</p>
                <p className="text-2xl font-bold text-amber-800 tabular-nums">{validationTotals.warnings}</p>
              </div>
              <div className="rounded-xl border bg-white p-3 shadow-sm border-emerald-200/80">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Validators (pass · warn · fail)</p>
                <p className="text-lg font-bold text-emerald-800 tabular-nums">
                  {validatorRollup.pass} · {validatorRollup.warnOnly} · {validatorRollup.fail}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-3">
              {validationPanels.map((p) => (
                <Badge
                  key={`vb-${p.id}`}
                  variant="outline"
                  className={cn(
                    'text-[11px] font-semibold gap-1',
                    p.status === 'pass' && 'border-emerald-300 bg-emerald-50/80 text-emerald-900',
                    p.status === 'warn' && 'border-amber-300 bg-amber-50 text-amber-950',
                    p.status === 'fail' && 'border-red-300 bg-red-50 text-red-950'
                  )}
                >
                  {p.status === 'pass' ? <ShieldCheck className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {p.label}
                  <span className="opacity-80 font-normal">{p.errN}/{p.warnN}</span>
                </Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3 max-h-[min(520px,70vh)] overflow-y-auto">
            {validationPanels.map((p) => (
              <Collapsible
                key={`${p.id}-${activeRoster.id}`}
                defaultOpen={p.errN > 0 || (!validationErrorsOnly && p.warnN > 0)}
                className="rounded-xl border border-border/80 bg-muted/10"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/40 rounded-xl transition-colors [&[data-state=open]_svg.chevron-spin]:rotate-180">
                  <span className="flex items-center gap-2 flex-wrap min-w-0">
                    <ChevronDown className="chevron-spin w-4 h-4 shrink-0 transition-transform duration-200" />
                    <span className="font-semibold text-sm text-primary truncate">{p.label}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        p.status === 'pass' && 'border-emerald-400 text-emerald-800',
                        p.status === 'warn' && 'border-amber-400 text-amber-900',
                        p.status === 'fail' && 'border-red-400 text-red-800'
                      )}
                    >
                      {p.status === 'pass' ? 'Pass' : p.status === 'warn' ? 'Warnings' : 'Fail'}
                    </Badge>
                  </span>
                  <span className="flex gap-1 shrink-0 text-[10px] font-bold tabular-nums">
                    <span className="text-red-700">{p.errN} err</span>
                    <span className="text-amber-800">{p.warnN} warn</span>
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3">
                  <div className="overflow-x-auto rounded-lg border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="w-[88px] text-xs">Severity</TableHead>
                          <TableHead className="text-xs">Staff</TableHead>
                          <TableHead className="text-xs w-[110px]">Date</TableHead>
                          <TableHead className="text-xs w-[120px]">Week start</TableHead>
                          <TableHead className="text-xs">Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.visible.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-6">
                              {validationErrorsOnly && p.warnN > 0 && p.errN === 0
                                ? 'No errors in this group (warnings hidden).'
                                : 'No violations in this group.'}
                            </TableCell>
                          </TableRow>
                        ) : (
                          p.visible.map((row, ri) => (
                            <TableRow
                              key={`${p.id}-${row.code}-${ri}-${row.date}-${row.weekStartDate}`}
                              className={cn(
                                row.severity === 'error' && 'border-l-4 border-l-red-500 bg-red-50/40',
                                row.severity === 'warning' && 'border-l-4 border-l-amber-500 bg-amber-50/30'
                              )}
                            >
                              <TableCell className="text-[11px] font-semibold capitalize align-top">
                                <span className={row.severity === 'error' ? 'text-red-700' : 'text-amber-800'}>{row.severity}</span>
                              </TableCell>
                              <TableCell className="text-[11px] align-top">{violationStaffCell(row)}</TableCell>
                              <TableCell className="text-[11px] font-mono align-top">{row.date ?? '—'}</TableCell>
                              <TableCell className="text-[11px] font-mono align-top">{row.weekStartDate ?? '—'}</TableCell>
                              <TableCell className="text-[11px] align-top text-foreground">{row.message}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}

      {activeRoster ? weeks.map((weekDates, wIdx) => (
        <div key={wIdx} id={`active-week-${wIdx}`} className="bg-white rounded-2xl border shadow-sm overflow-hidden mb-10 week-container">
          <div className="p-4 bg-muted/30 border-b flex justify-between items-center no-print">
            <h3 className="font-headline font-bold text-primary flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" /> Week {wIdx + 1}
              <span className="text-xs font-medium text-muted-foreground ml-2">
                ({format(parseISO(weekDates[0]), 'MMM d')} - {format(parseISO(weekDates[6]), 'MMM d')})
              </span>
            </h3>
            <div className="flex gap-2">
              <Button onClick={() => handleSyncClick(weekDates, wIdx)} size="sm" className="h-8 text-xs bg-primary text-white">
                <RefreshCw className="w-3 h-3 mr-1" /> Update Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runPrint('single', `active-week-${wIdx}`)}
                className="h-8 text-xs border-primary/20 text-primary"
              >
                <FileDown className="w-3 h-3 mr-1" /> PDF Export
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="w-[180px] font-bold border-r text-xs uppercase">Staff</TableHead>
                {weekDates.map(date => (
                  <TableHead key={date} className="text-center p-2 min-w-[100px] border-r">
                    <div className="font-bold text-[11px] uppercase">{format(parseISO(date), 'EEE')}</div>
                  </TableHead>
                ))}
                <TableHead className="text-center w-[60px]"><ArrowLeftRight className="w-4 h-4 mx-auto opacity-30" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffNames.map(name => (
                <TableRow key={name}>
                  <TableCell className="font-bold text-xs border-r bg-muted/5">{name}</TableCell>
                  {weekDates.map(date => {
                    const day = activeRoster.schedules.find((s: any) => s.date === date);
                    const assignment = day?.assignments.find((a: any) => a.staffName === name);
                    const type = assignment?.shiftType || 'Day';
                    return (
                      <TableCell key={date} className="p-2 text-center border-r">
                        <RosterShiftMutationDropdownCell
                          assignment={assignment}
                          showMutationMeta={showMutationMetadata}
                          triggerClassName={cn(
                            'flex min-h-[44px] cursor-pointer items-center justify-center rounded border p-1 text-[10px] font-bold shadow-sm',
                            getShiftStyles(type)
                          )}
                          shiftLabel={getShiftLabel(type)}
                          showChevron
                          menuContent={
                            <DropdownMenuContent align="end">
                              {(() => {
                                const profile: any = staffByName.get(name);
                                if (profile?.department !== 'Housekeeping') return SHIFT_TYPES;
                                return profile?.weeklyOffDays === 1.5 ? ['Day', 'OFF', 'H1-OFF', 'H2-OFF'] : ['Day', 'OFF'];
                              })().map((st) => (
                                <DropdownMenuItem key={st} onClick={() => handleManualChange(name, date, st)} className="text-xs">
                                  {getShiftLabel(st)} {type === st && <Check className="ml-auto h-3 w-3 text-green-500" />}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          }
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                      setSwapSourceStaff(name);
                      setSelectedWeekDates(weekDates);
                      setIsSwapOpen(true);
                    }}>
                      <ArrowLeftRight className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )) : (
        <div className="p-32 bg-white rounded-3xl border-2 border-dashed flex flex-col items-center justify-center space-y-4 text-center">
          <CalendarIcon className="w-20 h-20 text-muted/20" />
          <h3 className="text-2xl font-headline font-bold">Start Planning</h3>
          <p className="text-muted-foreground">Generate the next 7-week operational cycle to begin.</p>
        </div>
      )}

      {/* Two-Step Confirmation Dialog for New Block */}
      <AlertDialog open={showConfirmNext} onOpenChange={(open) => {
        setShowConfirmNext(open);
        if (!open) setConfirmStep(1);
      }}>
        <AlertDialogContent className="rounded-3xl">
          {confirmStep === 1 ? (
            <div className="space-y-4">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-2xl font-headline font-bold text-primary flex items-center gap-2">
                  <AlertCircle className="w-6 h-6" /> Step 1: Finish Current Edits?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm font-medium">
                  Are you sure you have finished all manual adjustments and swaps for the current 7-week block? 
                  Once archived, these manual changes will be finalized in history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setShowConfirmNext(false)}>No, Continue Editing</AlertDialogCancel>
                <Button onClick={() => setConfirmStep(2)} className="bg-primary text-white font-bold px-6">
                  Yes, All Edits Complete <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </AlertDialogFooter>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-2xl font-headline font-bold text-primary flex items-center gap-2">
                  <History className="w-6 h-6" /> Step 2: Finalize & Generate
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm font-medium">
                  The current roster will be moved to History. A fresh 7-week cycle will be generated starting from the next rotation day, resetting to your master staff preferences.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="ghost" onClick={() => setConfirmStep(1)}>Go Back</Button>
                <AlertDialogAction onClick={executeGeneration} className="bg-primary text-white font-bold px-8 shadow-lg shadow-primary/20">
                  Confirm Archive & Generate
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Sync Tool Dialog */}
      <Dialog open={isSyncOpen} onOpenChange={setIsSyncOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-3xl p-0 overflow-hidden">
          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-2">
              <DialogTitle className="text-2xl font-headline font-bold text-primary">Update Week & Validation</DialogTitle>
              <DialogDescription className="text-sm font-medium text-muted-foreground">Review operational alerts before finalizing.</DialogDescription>
            </div>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-3 pr-4">
                {syncWarnings.length === 0 ? (
                  <Alert className="bg-emerald-50 border-emerald-200">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <AlertTitle className="text-emerald-800 font-bold">Rules Verified</AlertTitle>
                    <AlertDescription className="text-emerald-700">All rest-day and night fairness requirements are met.</AlertDescription>
                  </Alert>
                ) : (
                  syncWarnings.map((w, i) => (
                    <Alert key={i} variant="destructive" className="bg-red-50 border-red-200">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700 font-medium">{w}</AlertDescription>
                    </Alert>
                  ))
                )}
              </div>
            </ScrollArea>
            <DialogFooter className="flex gap-3">
              <Button variant="ghost" onClick={() => setIsSyncOpen(false)} className="flex-1">Cancel</Button>
              <Button variant="outline" onClick={() => handleSyncSubmit('current')} className="flex-1 border-primary text-primary font-bold">Submit (Current Only)</Button>
              <Button onClick={() => handleSyncSubmit('future')} className="flex-1 bg-primary text-white font-bold">Submit & Apply Future Impact</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Swap Tool Dialog */}
      <Dialog open={isSwapOpen} onOpenChange={setIsSwapOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden rounded-3xl">
          <div className="bg-white p-6 space-y-6">
            <div className="space-y-1">
              <DialogTitle className="text-2xl font-headline font-bold text-primary">Adjustment Tool</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Modifying patterns for <b>{swapSourceStaff}</b>.</DialogDescription>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Step 1: Reference Day</h4>
                <div className="flex gap-1">
                  {DAYS_SHORT.map((day, idx) => (
                    <Button key={day} variant={refDayIdx === idx ? 'default' : 'outline'} className="flex-1 h-9 rounded-lg font-bold text-xs" onClick={() => setRefDayIdx(idx)}>{day}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Step 2: Target Pattern Type</h4>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant={targetCategory === 'half' ? 'secondary' : 'outline'} className="h-9 rounded-lg text-[9px] font-bold" onClick={() => { setTargetCategory(targetCategory === 'half' ? null : 'half'); setTargetDayIdx(refDayIdx); }}>Symmetric Half OFF</Button>
                  <Button variant={targetCategory === 'full' ? 'secondary' : 'outline'} className="h-9 rounded-lg text-[9px] font-bold" onClick={() => { setTargetCategory(targetCategory === 'full' ? null : 'full'); setTargetDayIdx(refDayIdx); }}>Symmetric Full OFF</Button>
                  <Button variant={targetCategory === 'night' ? 'secondary' : 'outline'} className="h-9 rounded-lg text-[9px] font-bold" onClick={() => { setTargetCategory(targetCategory === 'night' ? null : 'night'); setTargetDayIdx(refDayIdx); }}>Symmetric Night</Button>
                </div>
              </div>
              {targetCategory && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Step 3: Partner Target Day</h4>
                  <div className="flex gap-1">
                    {DAYS_SHORT.map((day, idx) => (
                      <Button key={day} variant={targetDayIdx === idx ? 'default' : 'outline'} className="flex-1 h-8 rounded-lg text-[9px] font-bold" onClick={() => setTargetDayIdx(idx)}>{day}</Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <ScrollArea className="h-[200px] rounded-2xl border bg-accent/5 p-2">
              <div className="space-y-2">
                {availablePartners.map(partner => (
                  <div key={partner.name} className="flex items-center justify-between p-3 rounded-xl border bg-white shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">{partner.name.charAt(0)}</div>
                      <div>
                        <p className="text-xs font-bold">{partner.name}</p>
                        <p className="text-[9px] text-muted-foreground">{partner.matchReason}</p>
                        <p className="text-[9px] text-muted-foreground">Own Night(s): {partner.ownNightNotes}</p>
                        {partner.ownNightSwapOptions?.slice(0, 2).map((n: any) => (
                          <p key={`${partner.name}-${n.day}`} className="text-[9px] text-muted-foreground">
                            {n.day} swap options: {n.options.length ? n.options.slice(0, 3).join(', ') : 'None'}
                          </p>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => executePatternSwap(partner.name)} className="bg-emerald-500 text-white text-[10px] h-8 px-4 font-bold">Swap Pattern</Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

