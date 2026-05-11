 'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { getStore, updateOccasions } from '@/lib/store';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarDays, Plus, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CalendarOccasion } from '@/lib/types';

export function ConfigView() {
  const { toast } = useToast();
  const [occasions, setOccasions] = useState<CalendarOccasion[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [displayMonth, setDisplayMonth] = useState<Date>(new Date());
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [occasionTitle, setOccasionTitle] = useState('');
  const [isHoliday, setIsHoliday] = useState(true);

  useEffect(() => {
    const store = getStore();
    const initialOccasions = store.occasions || [];
    setOccasions(initialOccasions);

    if (initialOccasions.length > 0) {
      const sorted = [...initialOccasions].sort((a, b) => a.date.localeCompare(b.date));
      const firstDate = parseISO(sorted[0].date);
      if (!Number.isNaN(firstDate.getTime())) {
        setSelectedDate(firstDate);
        setDisplayMonth(firstDate);
      }
    }
  }, []);

  const openEditor = () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const existing = occasions.find((o) => o.date === dateStr);
    setOccasionTitle(existing?.title || '');
    setIsHoliday(existing?.isHoliday ?? true);
    setIsEditorOpen(true);
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (!date) return;
    setDisplayMonth(date);
    const dateStr = format(date, 'yyyy-MM-dd');
    const existing = occasions.find((o) => o.date === dateStr);
    setOccasionTitle(existing?.title || '');
    setIsHoliday(existing?.isHoliday ?? true);
    setIsEditorOpen(true);
  };

  const saveOccasion = () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const cleanTitle = occasionTitle.trim();

    if (!cleanTitle) {
      toast({ title: 'Title Required', description: 'Please enter the occasion title.', variant: 'destructive' });
      return;
    }

    const next = [
      ...occasions.filter((o) => o.date !== dateStr),
      { date: dateStr, title: cleanTitle, isHoliday },
    ].sort((a, b) => a.date.localeCompare(b.date));

    setOccasions(next);
    updateOccasions(next);
    setIsEditorOpen(false);
    toast({ title: 'Saved', description: `${dateStr} saved successfully.` });
  };

  const removeOccasion = (date: string) => {
    const next = occasions.filter((o) => o.date !== date);
    setOccasions(next);
    updateOccasions(next);
    toast({ title: 'Removed', description: `${date} removed.` });
  };

  const monthKey = useMemo(() => format(displayMonth, 'yyyy-MM'), [displayMonth]);
  const monthOccasions = useMemo(() => occasions.filter((o) => o.date.startsWith(monthKey)).sort((a, b) => a.date.localeCompare(b.date)), [occasions, monthKey]);
  const monthHolidayCount = monthOccasions.filter((o) => o.isHoliday).length;
  const holidayDates = useMemo(() => occasions.filter((o) => o.isHoliday).map((o) => parseISO(o.date)), [occasions]);
  const occasionDates = useMemo(() => occasions.map((o) => parseISO(o.date)), [occasions]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground">Scheduling Calendar</h2>
          <p className="text-muted-foreground text-sm">Navigate month-by-month, add occasions, and mark holiday days.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg">Calendar</CardTitle>
            <CardDescription>Move to any month and select a day to register an occasion.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              month={displayMonth}
              onMonthChange={setDisplayMonth}
              onSelect={handleDateSelect}
              onDayClick={(day) => handleDateSelect(day)}
              className="rounded-md border mx-auto w-full"
              modifiers={{ holiday: holidayDates, occasion: occasionDates }}
              modifiersClassNames={{
                holiday: 'bg-red-100 text-red-700 font-bold',
                occasion: 'ring-1 ring-primary/40',
              }}
            />
            <Button onClick={openEditor} className="bg-primary gap-2">
              <Plus className="w-4 h-4" /> Add / Edit Occasion
            </Button>
            <p className="text-xs text-muted-foreground">
              Click on a day to open editor. Selected: {selectedDate ? format(selectedDate, 'yyyy-MM-dd') : 'None'}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" /> {monthKey} Summary
              </CardTitle>
              <CardDescription>Monthly occasions and holiday count.</CardDescription>
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/20">
              {monthHolidayCount === 0 ? 'No holidays' : `${monthHolidayCount} holiday day(s)`}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="w-full overflow-x-auto rounded-xl border">
              {monthOccasions.length === 0 && <p className="text-sm text-muted-foreground italic p-4">No occasions for this month.</p>}
              {monthOccasions.length > 0 && (
                <table className="w-full min-w-[460px] text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Title</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-right px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthOccasions.map((item) => (
                      <tr key={item.date} className="border-t">
                        <td className="px-3 py-2 font-medium">{item.date}</td>
                        <td className="px-3 py-2">{item.title}</td>
                        <td className="px-3 py-2">
                          <Badge variant={item.isHoliday ? 'destructive' : 'secondary'}>
                            {item.isHoliday ? 'Holiday' : 'Occasion'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" onClick={() => removeOccasion(item.date)} className="h-7 w-7">
                            <X className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Occasion</DialogTitle>
            <DialogDescription>
              {selectedDate ? `Date: ${format(selectedDate, 'yyyy-MM-dd')}` : 'Select a date first.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="occasionTitle">Occasion Title</Label>
              <Input id="occasionTitle" value={occasionTitle} onChange={(e) => setOccasionTitle(e.target.value)} placeholder="e.g. National holiday, team event" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Mark as Holiday</p>
                <p className="text-xs text-muted-foreground">Turn off for non-holiday occasions.</p>
              </div>
              <Switch checked={isHoliday} onCheckedChange={setIsHoliday} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditorOpen(false)}>Cancel</Button>
            <Button onClick={saveOccasion}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
