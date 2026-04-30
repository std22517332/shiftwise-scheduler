'use client';

import React, { useState, useEffect } from 'react';
import { DashboardNav, NavItem } from '@/components/dashboard-nav';
import { StaffView } from '@/components/staff-view';
import { RosterView } from '@/components/roster-view';
import { ConfigView } from '@/components/config-view';
import { AnalyticsView } from '@/components/analytics-view';
import { HistoryView } from '@/components/history-view';
import { DashboardOverview } from '@/components/dashboard-overview';
import { DataManagementView } from '@/components/data-management-view';
import { useUser, useAuth } from '@/firebase';
import { signInAnonymously, signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { LogIn, LogOut, Loader2, ShieldAlert } from 'lucide-react';

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<NavItem>('dashboard');
  const { user, isUserLoading } = useUser();
  const auth = useAuth();

  const handleSignIn = () => {
    signInAnonymously(auth);
  };

  const handleSignOut = () => {
    signOut(auth);
  };

  if (isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl border bg-white p-8 shadow-xl text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
            <LogIn className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-headline font-bold text-primary">NLC Employee</h1>
          <p className="text-muted-foreground">Sign in to manage your team's operational roster.</p>
          <Button onClick={handleSignIn} className="w-full h-12 text-lg font-bold bg-primary shadow-lg shadow-primary/20">
            Sign In as Administrator
          </Button>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
            Secure Manager Access Required
          </p>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch(activeView) {
      case 'dashboard': return <DashboardOverview />;
      case 'staff': return <StaffView />;
      case 'roster': return <RosterView />;
      case 'history': return <HistoryView />;
      case 'settings': return <ConfigView />;
      case 'fairness': return <AnalyticsView />;
      case 'data': return <DataManagementView />;
      default: return <DashboardOverview />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background font-body">
      <DashboardNav active={activeView} onSelect={setActiveView} />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          <header className="mb-8 flex justify-between items-end no-print">
            <div className="space-y-1">
              <h2 className="text-3xl font-headline font-bold text-primary tracking-tight">NLC Employee</h2>
              <p className="text-muted-foreground">Intelligent roster management for rental holiday business.</p>
            </div>
            <div className="flex items-center gap-4 bg-white p-2 rounded-xl border shadow-sm px-4">
              <div className="text-right">
                <p className="text-xs font-bold text-foreground">Admin Session</p>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Master Scheduler</p>
              </div>
              <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign Out" className="h-10 w-10 rounded-full hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </header>

          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
            {renderView()}
          </section>
        </div>
      </main>
    </div>
  );
}
