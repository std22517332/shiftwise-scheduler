import React, { useState, useEffect } from 'react';
import { getStore, updateHolidays, updateExtraPeakDays } from '@/lib/store';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarDays, Plane, Plus, X } from 'lucide-react';
import { format } from 'date-fns';

export function ConfigView() {
  const [holidays, setHolidays] = useState<string[]>([]);
  const [extraPeak, setExtraPeak] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  useEffect(() => {
    const store = getStore();
    setHolidays(store.holidays);
    setExtraPeak(store.extraPeakDays);
  }, []);

  const addHoliday = () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    if (holidays.includes(dateStr)) return;
    const updated = [...holidays, dateStr];
    setHolidays(updated);
    updateHolidays(updated);
  };

  const addPeak = () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    if (extraPeak.includes(dateStr)) return;
    const updated = [...extraPeak, dateStr];
    setExtraPeak(updated);
    updateExtraPeakDays(updated);
  };

  const removeDate = (date: string, type: 'holiday' | 'peak') => {
    if (type === 'holiday') {
      const updated = holidays.filter(d => d !== date);
      setHolidays(updated);
      updateHolidays(updated);
    } else {
      const updated = extraPeak.filter(d => d !== date);
      setExtraPeak(updated);
      updateExtraPeakDays(updated);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground">Scheduling Config</h2>
          <p className="text-muted-foreground text-sm">Define holidays and seasonal traffic peaks.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 shadow-sm border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg">Date Picker</CardTitle>
            <CardDescription>Select a date to define its status.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="rounded-md border mx-auto"
            />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Button onClick={addHoliday} className="bg-primary gap-2">
                <Plus className="w-4 h-4" /> Holiday
              </Button>
              <Button onClick={addPeak} variant="secondary" className="gap-2 bg-secondary text-primary">
                <Plus className="w-4 h-4" /> Peak Day
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-primary" /> Company Holidays
                </CardTitle>
                <CardDescription>Staff gain extra priority for off-days on these dates.</CardDescription>
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20">{holidays.length} Dates</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {holidays.length === 0 && <p className="text-sm text-muted-foreground italic">No holidays defined.</p>}
                {holidays.map(date => (
                  <Badge key={date} variant="outline" className="pl-3 pr-1 py-1 gap-2 border-primary/20 bg-primary/5">
                    {date}
                    <button onClick={() => removeDate(date, 'holiday')} className="p-0.5 hover:bg-primary/20 rounded-full">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Plane className="w-5 h-5 text-secondary" /> Extra Peak Traffic
                </CardTitle>
                <CardDescription>Reservation capacity is automatically maximized on these dates.</CardDescription>
              </div>
               <Badge variant="secondary" className="bg-secondary/10 text-primary border-secondary/20">{extraPeak.length} Dates</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {extraPeak.length === 0 && <p className="text-sm text-muted-foreground italic">No extra peak days defined.</p>}
                {extraPeak.map(date => (
                  <Badge key={date} variant="outline" className="pl-3 pr-1 py-1 gap-2 border-secondary/20 bg-secondary/5">
                    {date}
                    <button onClick={() => removeDate(date, 'peak')} className="p-0.5 hover:bg-secondary/20 rounded-full">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
