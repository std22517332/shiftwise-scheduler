
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, CalendarDays, Loader2, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStore } from '@/lib/store';

type DashboardData = {
  activeRoster: any;
  history: any[];
  holidays: string[];
  extraPeakDays: string[];
  occasions?: { date: string; title: string; isHoliday: boolean }[];
};

export function DashboardOverview() {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<DashboardData>({ activeRoster: null, history: [], holidays: [], extraPeakDays: [] });

  useEffect(() => {
    setMounted(true);
    const store = getStore();
    setData({
      activeRoster: store.activeRoster,
      history: store.history,
      holidays: store.holidays || [],
      extraPeakDays: store.extraPeakDays || [],
      occasions: store.occasions || [],
    });
  }, []);

  const todayStr = useMemo(() => {
    if (!mounted) return '';
    return format(new Date(), 'yyyy-MM-dd');
  }, [mounted]);

  const formattedToday = useMemo(() => {
    if (!mounted) return 'Loading...';
    return format(new Date(), 'EEEE, MMMM do');
  }, [mounted]);

  const todayShifts = useMemo(() => {
    if (!mounted || !todayStr) return [];
    
    // Check active roster first
    let day = data.activeRoster?.schedules.find((s: any) => s.date === todayStr);
    
    // If not in active, check recent history
    if (!day && data.history.length > 0) {
      for (const roster of data.history) {
        day = roster.schedules.find((s: any) => s.date === todayStr);
        if (day) break;
      }
    }
    
    return day ? day.assignments : [];
  }, [data, todayStr, mounted]);

  const stats = useMemo(() => {
    if (todayShifts.length === 0) return { day: 0, night: 0, off: 0 };
    return {
      day: todayShifts.filter((s: any) => s.shiftType === 'Day').length,
      night: todayShifts.filter((s: any) => s.shiftType.includes('Night')).length,
      off: todayShifts.filter((s: any) => s.shiftType === 'OFF' || s.shiftType.includes('OFF')).length,
    };
  }, [todayShifts]);

  const holidayAlerts = useMemo(() => {
    if (!mounted) return [] as { date: string; title: string; scope: 'current' | 'next' }[];
    const today = new Date();
    const currentMonthStart = startOfMonth(today);
    const currentMonthEnd = endOfMonth(today);
    const nextMonthStart = startOfMonth(addMonths(today, 1));
    const nextMonthEnd = endOfMonth(addMonths(today, 1));

    const allOccasions = data.occasions || [];
    return allOccasions
      .filter((o) => o.isHoliday)
      .filter((o) => {
        const d = parseISO(o.date);
        if (Number.isNaN(d.getTime())) return false;
        const inCurrentMonth = d >= currentMonthStart && d <= currentMonthEnd;
        const inNextMonth = d >= nextMonthStart && d <= nextMonthEnd;
        return inCurrentMonth || inNextMonth;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((o) => {
        const d = parseISO(o.date);
        const scope = d >= currentMonthStart && d <= currentMonthEnd ? 'current' : 'next';
        return { date: o.date, title: o.title, scope };
      });
  }, [data.occasions, mounted]);

  if (!mounted) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  }

  const activeRange = data.activeRoster 
    ? `${data.activeRoster.startDate} - ${data.activeRoster.endDate}` 
    : (data.history[0] ? `${data.history[0].startDate} - ${data.history[0].endDate} (Finalized)` : 'No Data');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground">Operations Dashboard</h2>
          <p className="text-muted-foreground text-sm font-medium">Real-time status for {formattedToday}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="shadow-sm border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Day Shift</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{stats.day} Staff</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Night Shift</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{stats.night} Staff</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">OFF / Break</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{stats.off} Staff</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm bg-primary text-white border-none shadow-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold opacity-80 uppercase tracking-widest">Roster Block</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold truncate">
              {activeRange}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border-amber-200 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="text-lg font-headline font-bold flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-600" /> This Month Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Holiday Notifications</p>
            <div className="flex flex-wrap gap-2">
              {holidayAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No holiday notifications for current window.</p>
              ) : (
                holidayAlerts.map((item) => (
                  <Badge key={`h-${item.date}`} variant="outline" className={item.scope === 'next' ? 'border-blue-300 text-blue-700' : ''}>
                    {item.date} - {item.title} {item.scope === 'next' ? '(next month preview)' : ''}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="shadow-sm border-primary/5">
          <CardHeader>
            <CardTitle className="text-lg font-headline font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Today's Assignments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {todayShifts.length === 0 && (
                <div className="py-12 text-center bg-muted/5 rounded-2xl border-2 border-dashed border-muted">
                   <CalendarDays className="w-8 h-8 text-muted-foreground opacity-30 mx-auto mb-2" />
                   <p className="text-sm text-muted-foreground font-medium">No shifts assigned for today.</p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                {todayShifts.map((shift: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-white rounded-xl border border-primary/5 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs text-white",
                        shift.shiftType.includes('Night') ? "bg-blue-900" : (shift.shiftType.includes('OFF')) ? "bg-red-500" : "bg-primary"
                      )}>
                        {shift.staffName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">{shift.staffName}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{shift.department}</p>
                      </div>
                    </div>
                    <Badge variant={shift.shiftType.includes('OFF') ? 'destructive' : 'secondary'} className="font-bold text-[10px]">
                      {shift.shiftType}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-primary/5">
          <CardHeader>
            <CardTitle className="text-lg font-headline font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Shift Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative border-l-2 border-primary/20 pl-8 space-y-10 py-4 ml-2">
              <div className="relative">
                <div className="absolute -left-[41px] top-1 w-6 h-6 rounded-full bg-primary border-4 border-white shadow-md" />
                <h4 className="text-sm font-bold text-primary">Day Shift (08:30)</h4>
                <p className="text-xs text-muted-foreground mt-1">Operational start and briefing.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-[41px] top-1 w-6 h-6 rounded-full bg-secondary border-4 border-white shadow-md" />
                <h4 className="text-sm font-bold text-foreground">Handover (15:00)</h4>
                <p className="text-xs text-muted-foreground mt-1">Teams synchronization overlap.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-[41px] top-1 w-6 h-6 rounded-full bg-blue-900 border-4 border-white shadow-md" />
                <h4 className="text-sm font-bold text-blue-900">Night Shift (18:00+)</h4>
                <p className="text-xs text-muted-foreground mt-1">High stability monitoring focus.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
