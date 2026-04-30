
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getStore, saveActiveRoster, archiveCurrentRoster, updateRosterShift, swapWeeklyPatterns } from '@/lib/store';
import { generateLocalRoster } from '@/lib/roster-algorithm';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const SHIFT_TYPES = ['Day', 'Night', 'OFF', 'H1-OFF', 'H2-OFF'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  useEffect(() => {
    const store = getStore();
    setActiveRoster(store.activeRoster);
  }, []);

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
    updateRosterShift(activeRoster.id, date, staffName, newType);
    const store = getStore();
    setActiveRoster({ ...store.activeRoster });
  };

  const executePatternSwap = (targetStaff: string) => {
    if (!swapSourceStaff || !selectedWeekDates.length || !activeRoster) return;
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

    staffList.forEach(staff => {
      let offDays = 0;
      weekDates.forEach(date => {
        const day = activeRoster.schedules.find((s: any) => s.date === date);
        const assignment = day?.assignments.find((a: any) => a.staffName === staff.name);
        if (assignment?.shiftType === 'OFF') offDays += 1;
        if (assignment?.shiftType.includes('H')) offDays += 0.5;
      });
      if (offDays !== 1.5) {
        warnings.push(`${staff.name}: OFF-day total is ${offDays} (Requirement: 1.5 days).`);
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
        const nextStartDate = format(parseISO(activeRoster.schedules[nextWeekStartIdx].date), 'yyyy-MM-dd');
        
        const result = generateLocalRoster(
          store.staff,
          store.holidays,
          store.extraPeakDays,
          nextStartDate,
          format(parseISO(activeRoster.endDate), 'yyyy-MM-dd'),
          totalArchivedWeeks + syncWeekIdx + 1
        );

        const newSchedules = [...activeRoster.schedules];
        newSchedules.splice(nextWeekStartIdx, result.generatedSchedule.length, ...result.generatedSchedule);
        
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

  const staffNames = useMemo(() => {
    if (!activeRoster || activeRoster.schedules.length === 0) return [];
    return Array.from(new Set(activeRoster.schedules[0].assignments.map((a: any) => a.staffName)));
  }, [activeRoster]);

  const weeks = useMemo(() => {
    if (!activeRoster) return [];
    const dates = activeRoster.schedules.map((s: any) => s.date);
    const w: string[][] = [];
    for (let i = 0; i < dates.length; i += 7) {
      w.push(dates.slice(i, i + 7));
    }
    return w;
  }, [activeRoster]);

  const getShiftStyles = (type: string) => {
    if (type === 'OFF') return 'bg-red-500 text-white border-red-600'; 
    if (type.includes('H')) return 'bg-amber-400 text-amber-950 border-amber-500';
    if (type.startsWith('Night')) return 'bg-blue-900 text-white border-blue-950';
    if (type === 'Day') return 'bg-sky-100 text-sky-800 border-sky-200';
    return 'bg-muted';
  };

  const availablePartners = useMemo(() => {
    if (!swapSourceStaff || !selectedWeekDates.length || targetCategory === null || targetDayIdx === null || !activeRoster) return [];
    return staffNames
      .filter(name => name !== swapSourceStaff)
      .map(name => {
        const day = activeRoster.schedules.find((s: any) => s.date === selectedWeekDates[targetDayIdx!]);
        const assignment = day?.assignments.find((a: any) => a.staffName === name);
        const shiftType = assignment?.shiftType || 'Day';
        let isMatch = false;
        if (targetCategory === 'half' && shiftType.includes('H')) isMatch = true;
        if (targetCategory === 'full' && shiftType === 'OFF') isMatch = true;
        if (targetCategory === 'night' && shiftType === 'Night') isMatch = true;
        if (!isMatch) return null;
        return { name, matchReason: `Matches ${targetCategory.toUpperCase()} on ${DAYS_SHORT[targetDayIdx!]}` };
      })
      .filter(p => p !== null) as any[];
  }, [swapSourceStaff, selectedWeekDates, targetCategory, targetDayIdx, activeRoster, staffNames]);

  return (
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
        <Button onClick={initiateNewBlock} disabled={loading} className="bg-primary shadow-lg shadow-primary/20 no-print">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
          New 7-Week Block
        </Button>
      </div>

      {activeRoster ? weeks.map((weekDates, wIdx) => (
        <div key={wIdx} className="bg-white rounded-2xl border shadow-sm overflow-hidden mb-10 week-container">
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
              <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 text-xs border-primary/20 text-primary">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className={cn(
                              "flex items-center justify-center p-1 rounded border text-[10px] font-bold min-h-[44px] cursor-pointer shadow-sm relative group",
                              getShiftStyles(type)
                            )}>
                              <span>{type}</span>
                              <ChevronDown className="w-3 h-3 absolute bottom-0 right-0 opacity-0 group-hover:opacity-100" />
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {SHIFT_TYPES.map(st => (
                              <DropdownMenuItem key={st} onClick={() => handleManualChange(name, date, st)} className="text-xs">
                                {st} {type === st && <Check className="w-3 h-3 ml-auto text-green-500" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
  );
}

