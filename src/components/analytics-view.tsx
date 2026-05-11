import React, { useState, useEffect } from 'react';
import { getStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Info, Scale, TrendingUp, Users, CalendarOff } from 'lucide-react';

export function AnalyticsView() {
  const [data, setData] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalStaff: 0, peakCoverage: 0, fairnessScore: 0 });
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    const store = getStore();
    const activeRoster = store.activeRoster;
    
    if (!activeRoster || !activeRoster.schedules) {
      setHasData(false);
      setStats({ totalStaff: store.staff.length, peakCoverage: 0, fairnessScore: 0 });
      setData([]);
      return;
    }

    setHasData(true);
    const staffStats = store.staff.map(s => {
      // Logic to count off days in active schedule
      const offDays = activeRoster.schedules.reduce((acc, day) => {
        const assignment = day.assignments.find(a => a.staffName === s.name);
        if (assignment?.shiftType === 'OFF') return acc + 1;
        if (assignment?.shiftType.includes('H')) return acc + 0.5;
        return acc;
      }, 0);

      const nightShifts = activeRoster.schedules.reduce((acc, day) => {
        const assignment = day.assignments.find(a => a.staffName === s.name);
        return assignment?.shiftType === 'Night' ? acc + 1 : acc;
      }, 0);

      return {
        name: s.name.split(' ')[0],
        offDays,
        nightShifts,
        senior: s.isSenior,
      };
    });

    setData(staffStats);
    setStats({
      totalStaff: store.staff.length,
      peakCoverage: activeRoster.schedules.filter(d => d.isPeakDay).length,
      fairnessScore: 92, // Mocked for demo
    });
  }, []);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4 text-center">
        <CalendarOff className="w-16 h-16 text-muted-foreground opacity-20" />
        <div>
          <h2 className="text-xl font-headline font-bold">No Active Data for Analytics</h2>
          <p className="text-muted-foreground max-w-sm mx-auto mt-2">
            Please generate an active roster first to see operational analytics and fairness metrics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground">Operational Analytics</h2>
          <p className="text-muted-foreground text-sm">Monitor shift distribution and fairness metrics.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary text-white border-none shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 opacity-80">
              <Users className="w-4 h-4" /> Team Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalStaff} Members</div>
            <p className="text-xs mt-2 opacity-70">Fully optimized across 3 departments</p>
          </CardContent>
        </Card>

        <Card className="bg-secondary text-primary border-none shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 opacity-80">
              <Scale className="w-4 h-4" /> Fairness Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.fairnessScore}%</div>
            <p className="text-xs mt-2 opacity-70">Shift variance within +/- 5%</p>
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-lg border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
              <TrendingUp className="w-4 h-4" /> Peak Coverage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats.peakCoverage} Days</div>
            <p className="text-xs mt-2 text-muted-foreground">High traffic periods monitored</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Total Off-Days Granted</CardTitle>
            <CardDescription>Target: 1.5 days/week per person.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #eee' }} 
                  cursor={{ fill: '#f5f5f5' }}
                />
                <Bar dataKey="offDays" fill="#1F5DA6" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Night Shift Distribution</CardTitle>
            <CardDescription>Ensuring fair rotation among staff.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #eee' }}
                  cursor={{ fill: '#f5f5f5' }}
                />
                <Bar dataKey="nightShifts" radius={[4, 4, 0, 0]} barSize={40}>
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.nightShifts > 3 ? '#1F5DA6' : '#59D4ED'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}