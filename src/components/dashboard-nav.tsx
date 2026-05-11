import { Calendar, Users, Settings, BarChart3, Info, History, LayoutDashboard, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

export type NavItem = 'dashboard' | 'roster' | 'staff' | 'history' | 'fairness' | 'settings' | 'data';

interface DashboardNavProps {
  active: NavItem;
  onSelect: (item: NavItem) => void;
}

const NLCLogo = () => (
  <Image
    src="/branding/Asset-2.png"
    alt="NorthernLAND Holiday Rentals"
    width={982}
    height={280}
    priority
    className="w-full h-auto"
  />
);

export function DashboardNav({ active, onSelect }: DashboardNavProps) {
  const items = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'roster' as const, label: 'Active Roster', icon: Calendar },
    { id: 'history' as const, label: 'History', icon: History },
    { id: 'staff' as const, label: 'Staff', icon: Users },
    { id: 'fairness' as const, label: 'Analytics', icon: BarChart3 },
    { id: 'settings' as const, label: 'Config', icon: Settings },
    { id: 'data' as const, label: 'Data Mgmt', icon: Database },
  ];

  return (
    <nav className="sticky top-0 self-start flex flex-col gap-2 p-4 bg-white border-r h-screen w-64 shrink-0 overflow-y-auto no-print">
      <div className="flex flex-col items-center px-2 mb-6 mt-2">
        <div className="w-full max-w-[220px]">
          <NLCLogo />
        </div>
      </div>
      
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group",
              active === item.id 
                ? "bg-accent text-primary font-semibold shadow-sm" 
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Icon className={cn("w-5 h-5", active === item.id ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span className="text-sm font-body">{item.label}</span>
          </button>
        );
      })}

      <div className="mt-auto p-4 bg-accent/50 rounded-xl border border-primary/10">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-primary mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-primary">Need Help?</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-1">
              Finalized rosters are moved to History for long-term storage.
            </p>
          </div>
        </div>
      </div>
    </nav>
  );
}
