
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getStore, updateRosterShift, swapWeeklyPatterns, updateStaff } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { format, parseISO, addDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, FileDown, ArrowLeftRight, ChevronDown, Check, Scale, RefreshCw, ShieldCheck, AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from '@/hooks/use-toast';

const SHIFT_TYPES = ['Day', 'Night', 'OFF', 'H1-OFF', 'H2-OFF'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function HistoryView() {
  const { toast } = useToast();
  const [history, setHistory] = useState<any[]>([]);
  const [selectedRoster, setSelectedRoster] = useState<any | null>(null);

  // Swap Tool States
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [swapSourceStaff, setSwapSourceStaff] = useState<string | null>(null);
  const [selectedWeekDates, setSelectedWeekDates] = useState<string[]>([]);
  const [refDayIdx, setRefDayIdx] = useState<number>(0);
  const [targetCategory, setTargetCategory] = useState<'half' | 'full' | 'night' | null>(null);
  const [targetDayIdx, setTargetDayIdx] = useState<number | null>(null);

  // Sync / Update States
  const [syncWeekIdx, setSyncWeekIdx] = useState<number | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [isSyncOpen, setIsSyncOpen] = useState(false);

  useEffect(() => {
    const store = getStore();
    setHistory(store.history);
    if (store.history.length > 0 && !selectedRoster) {
      setSelectedRoster(store.history[0]);
    }
  }, []);

  const refreshData = () => {
    const store = getStore();
    setHistory(store.history);
    if (selectedRoster) {
      const updated = store.history.find(h => h.id === selectedRoster.id);
      if (updated) setSelectedRoster(updated);
    }
  };

  const handleManualChange = (staffName: string, date: string, newType: string) => {
    if (!selectedRoster) return;
    updateRosterShift(selectedRoster.id, date, staffName, newType);
    refreshData();
  };

  const executePatternSwap = (targetStaff: string) => {
    if (!swapSourceStaff || !selectedWeekDates.length || !selectedRoster) return;
    swapWeeklyPatterns(selectedRoster.id, selectedWeekDates, swapSourceStaff, targetStaff);
    refreshData();
    setIsSwapOpen(false);
    setTargetCategory(null);
    setTargetDayIdx(null);
  };

  const validateWeek = (weekDates: string[]) => {
    const warnings: string[] = [];
    const store = getStore();
    const staffList = store.staff;
    if (!selectedRoster) return [];

    // 1. Check OFF-day Balance (Target 1.5 days)
    staffList.forEach(staff => {
      let offDays = 0;
      weekDates.forEach(date => {
        const day = selectedRoster.schedules.find((s: any) => s.date === date);
        const assignment = day?.assignments.find((a: any) => a.staffName === staff.name);
        if (assignment?.shiftType === 'OFF') offDays += 1;
        if (assignment?.shiftType.includes('H')) offDays += 0.5;
      });
      if (offDays !== 1.5) {
        warnings.push(`${staff.name} has ${offDays} days off this week (Target: 1.5 days).`);
      }
    });

    // 2. Check Night Shift Fairness
    const eligibleForNight = staffList.filter(s => s.shiftPreference !== 'Day');
    const nightCounts: Record<string, number> = {};
    eligibleForNight.forEach(s => nightCounts[s.name] = 0);

    weekDates.forEach(date => {
      const day = selectedRoster.schedules.find((s: any) => s.date === date);
      day?.assignments.forEach((a: any) => {
        if (a.shiftType.includes('Night') && eligibleForNight.some(s => s.name === a.staffName)) {
          nightCounts[a.staffName]++;
        }
      });
    });

    const totalNightShifts = Object.values(nightCounts).reduce((a, b) => a + b, 0);
    const avgNightShifts = totalNightShifts / eligibleForNight.length;

    eligibleForNight.forEach(s => {
      const count = nightCounts[s.name];
      if (Math.abs(count - avgNightShifts) > 1) {
        warnings.push(`Night shift imbalance: ${s.name} is assigned ${count} shifts, while the team average is ${avgNightShifts.toFixed(1)}.`);
      }
    });

    // 3. Night Coverage during Half-Day Turn
    weekDates.forEach(date => {
      const day = selectedRoster.schedules.find((s: any) => s.date === date);
      const halfDayNightStaff = day?.assignments.filter((a: any) => a.shiftType.includes('Night') && a.shiftType.includes('H'));
      
      if (halfDayNightStaff && halfDayNightStaff.length > 0) {
        halfDayNightStaff.forEach((a: any) => {
          const others = day.assignments.filter((oa: any) => oa.shiftType.includes('Night') && oa.staffName !== a.staffName);
          if (others.length < 2) {
            warnings.push(`Critical Coverage: On ${format(parseISO(date), 'EEEE')}, ${a.staffName} is on a Half-Day pattern. Two additional night staff are required for safety.`);
          }
        });
      }
    });

    return warnings;
  };

  const handleSyncClick = (weekDates: string[], weekIdx: number) => {
    const warnings = validateWeek(weekDates);
    setSyncWarnings(warnings);
    setSyncWeekIdx(weekIdx);
    setIsSyncOpen(true);
  };

  const handleSyncSubmit = (impact: 'current' | 'future') => {
    if (impact === 'future' && syncWeekIdx !== null && selectedRoster) {
      const store = getStore();
      const weekDates = weeks[syncWeekIdx];
      const updatedStaff = [...store.staff];

      updatedStaff.forEach(staff => {
        const weekAssignments = weekDates.map(date => {
          const day = selectedRoster.schedules.find((s: any) => s.date === date);
          return day?.assignments.find((a: any) => a.staffName === staff.name);
        });
        const offDayIdx = weekAssignments.findIndex(a => a?.shiftType === 'OFF');
        if (offDayIdx !== -1) {
          staff.defaultOffDay = DAYS_SHORT[offDayIdx];
        }
      });

      updateStaff(updatedStaff);
      toast({ title: "Profiles Updated", description: "Master staff preferences updated from archive pattern." });
    }

    setIsSyncOpen(false);
    setSyncWeekIdx(null);
    toast({ title: "Archive Updated", description: "Manual changes preserved in history." });
  };

  const staffNames = useMemo(() => {
    if (!selectedRoster || selectedRoster.schedules.length === 0) return [];
    return Array.from(new Set(selectedRoster.schedules[0].assignments.map((a: any) => a.staffName)));
  }, [selectedRoster]);

  const weeks = useMemo(() => {
    if (!selectedRoster) return [];
    const dates = selectedRoster.schedules.map((s: any) => s.date);
    const w: string[][] = [];
    for (let i = 0; i < dates.length; i += 7) {
      w.push(dates.slice(i, i + 7));
    }
    return w;
  }, [selectedRoster]);

  const getShiftStyles = (type: string) => {
    if (type === 'OFF') return 'bg-red-500 text-white border-red-600'; 
    if (type.includes('H')) return 'bg-amber-400 text-amber-950 border-amber-500';
    if (type.startsWith('Night')) return 'bg-blue-900 text-white border-blue-950';
    if (type === 'Day') return 'bg-sky-100 text-sky-800 border-sky-200';
    return 'bg-muted';
  };

  const availablePartners = useMemo(() => {
    if (!swapSourceStaff || !selectedWeekDates.length || targetCategory === null || targetDayIdx === null || !selectedRoster) return [];
    return staffNames
      .filter(name => name !== swapSourceStaff)
      .map(name => {
        const targetDayDate = selectedWeekDates[targetDayIdx];
        const day = selectedRoster.schedules.find((s: any) => s.date === targetDayDate);
        const assignment = day?.assignments.find((a: any) => a.staffName === name);
        const shiftType = assignment?.shiftType || 'Day';
        let isMatch = false;
        if (targetCategory === 'half' && shiftType.includes('H')) isMatch = true;
        if (targetCategory === 'full' && shiftType === 'OFF') isMatch = true;
        if (targetCategory === 'night' && shiftType === 'Night') isMatch = true;
        if (!isMatch) return null;
        return { name, matchReason: `Matches ${targetCategory.toUpperCase()} on ${DAYS_SHORT[targetDayIdx]}` };
      })
      .filter(p => p !== null) as any[];
  }, [swapSourceStaff, selectedWeekDates, targetCategory, targetDayIdx, selectedRoster, staffNames]);

  const handleCategorySelect = (category: 'half' | 'full' | 'night', dayIdx: number) => {
    if (targetCategory === category && targetDayIdx === dayIdx) {
      setTargetCategory(null);
      setTargetDayIdx(null);
    } else {
      setTargetCategory(category);
      setTargetDayIdx(dayIdx);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground text-primary">History</h2>
          <p className="text-muted-foreground text-sm">Review and edit archived rosters.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <ScrollArea className="h-[70vh] rounded-xl border bg-white p-2">
            {history.map((roster) => (
              <button
                key={roster.id}
                onClick={() => setSelectedRoster(roster)}
                className={cn(
                  "w-full text-left p-4 rounded-lg mb-2 border transition-all",
                  selectedRoster?.id === roster.id ? "bg-primary text-white" : "hover:bg-accent"
                )}
              >
                <div className="font-bold text-sm">
                  {format(parseISO(roster.startDate), 'MMM dd')} - {format(parseISO(roster.endDate), 'MMM dd')}
                </div>
                <p className="text-[10px] opacity-70">Published Archive</p>
              </button>
            ))}
          </ScrollArea>
        </div>

        <div className="lg:col-span-3 space-y-6">
          {selectedRoster && weeks.map((weekDates, wIdx) => (
            <div key={wIdx} className="bg-white rounded-2xl border shadow-sm overflow-hidden mb-6 week-container">
              <div className="p-3 bg-muted/20 border-b flex justify-between items-center no-print">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">Week {wIdx + 1}</span>
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => handleSyncClick(weekDates, wIdx)}
                    className="h-7 text-[9px] bg-primary text-white hover:bg-primary/90"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> Update Archive
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.print()} className="h-7 text-[10px]">
                  <FileDown className="w-3 h-3 mr-1" /> PDF
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px] text-xs font-bold border-r">Staff</TableHead>
                    {weekDates.map(date => (
                      <TableHead key={date} className="text-center p-2 border-r">
                        <div className="font-bold text-[9px] uppercase">{format(parseISO(date), 'EEE')}</div>
                      </TableHead>
                    ))}
                    <TableHead className="w-[50px] text-center"><ArrowLeftRight className="w-3 h-3 mx-auto" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffNames.map(name => (
                    <TableRow key={name}>
                      <TableCell className="font-bold text-[10px] border-r bg-muted/5">{name}</TableCell>
                      {weekDates.map(date => {
                        const day = selectedRoster.schedules.find((s: any) => s.date === date);
                        const assignment = day?.assignments.find((a: any) => a.staffName === name);
                        const type = assignment?.shiftType || 'Day';
                        return (
                          <TableCell key={date} className="p-1.5 text-center border-r">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <div className={cn(
                                  "flex items-center justify-center p-1 rounded border text-[9px] font-bold min-h-[36px] cursor-pointer relative",
                                  getShiftStyles(type)
                                )}>
                                  <span>{type}</span>
                                </div>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {SHIFT_TYPES.map(st => (
                                  <DropdownMenuItem key={st} onClick={() => handleManualChange(name, date, st)}>
                                    {st}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                          setSwapSourceStaff(name);
                          setSelectedWeekDates(weekDates);
                          setIsSwapOpen(true);
                        }}>
                          <ArrowLeftRight className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      </div>

      {/* Sync/Update Dialog (Archive) */}
      <Dialog open={isSyncOpen} onOpenChange={setIsSyncOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-3xl p-0 overflow-hidden">
          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-2">
              <DialogTitle className="text-2xl font-headline font-bold text-primary">Archive Sync & Validation</DialogTitle>
              <DialogDescription className="text-sm font-medium text-muted-foreground">
                Review operational alerts for this historical record.
              </DialogDescription>
            </div>

            <ScrollArea className="max-h-[300px] pr-4">
              <div className="space-y-3">
                {syncWarnings.length === 0 ? (
                  <Alert className="bg-emerald-50 border-emerald-200">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <AlertTitle className="text-emerald-800 font-bold">Historical Integrity Verified</AlertTitle>
                    <AlertDescription className="text-emerald-700">
                      Manual changes maintain standard coverage requirements.
                    </AlertDescription>
                  </Alert>
                ) : (
                  syncWarnings.map((warning, idx) => (
                    <Alert key={idx} variant="destructive" className="bg-red-50 border-red-200">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700 font-medium">
                        {warning}
                      </AlertDescription>
                    </Alert>
                  ))
                )}
              </div>
            </ScrollArea>

            <DialogFooter className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button variant="ghost" onClick={() => setIsSyncOpen(false)} className="flex-1 rounded-xl">
                Cancel
              </Button>
              <Button 
                variant="outline" 
                onClick={() => handleSyncSubmit('current')} 
                className="flex-1 rounded-xl border-primary text-primary hover:bg-primary/5 font-bold"
              >
                Submit (Current Only)
              </Button>
              <Button 
                onClick={() => handleSyncSubmit('future')} 
                className="flex-1 rounded-xl bg-primary shadow-lg shadow-primary/20 font-bold"
              >
                Submit & Apply Future Impact
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
