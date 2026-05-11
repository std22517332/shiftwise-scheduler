'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  getAssignmentMutationMeta,
  getMutationOriginRingClass,
  type ShiftMutationMeta,
} from '@/lib/roster-mutation-meta';

const DOT_CLASS_MAP = {
  generator: 'bg-zinc-500',
  manual_override: 'bg-blue-500',
  pattern_swap: 'bg-violet-500',
  pair_swap: 'bg-violet-500',
  auto_repair: 'bg-amber-500',
  future_propagation: 'bg-teal-500',
} as const;

function MutationTooltipBody({ meta }: { meta: ShiftMutationMeta }) {
  const line = (label: string, value: string | undefined) =>
    value === undefined || value === '' ? null : (
      <div className="flex gap-1.5">
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <span className="min-w-0 break-words font-medium text-foreground">{value}</span>
      </div>
    );

  const boolLine = (label: string, v: boolean | undefined) =>
    v === undefined ? null : line(label, v ? 'yes' : 'no');

  return (
    <div className="max-w-[280px] space-y-1 text-left text-[11px] leading-snug">
      {line('Origin', meta.origin)}
      {line('Timestamp', meta.timestamp)}
      {boolLine('Affects future', meta.affectsFuture)}
      {boolLine('Propagated', meta.propagated)}
      {meta.relatedStaff?.length
        ? line('Related staff', meta.relatedStaff.join(', '))
        : null}
      {meta.actor ? line('Actor', meta.actor) : null}
      {meta.linkedPatternId ? line('Pattern id', meta.linkedPatternId) : null}
      {meta.notes ? line('Notes', meta.notes) : null}
    </div>
  );
}

export type RosterShiftMutationDropdownCellProps = {
  assignment: unknown;
  showMutationMeta: boolean;
  /** Pre-built shift surface classes (colors, typography). */
  triggerClassName: string;
  shiftLabel: string;
  showChevron?: boolean;
  chevronClassName?: string;
  menuContent: React.ReactNode;
};

/**
 * Single roster grid cell: dropdown + optional mutation dot/ring + hover tooltip (when debug on and meta exists).
 */
export function RosterShiftMutationDropdownCell({
  assignment,
  showMutationMeta,
  triggerClassName,
  shiftLabel,
  showChevron,
  chevronClassName,
  menuContent,
}: RosterShiftMutationDropdownCellProps) {
  const meta = getAssignmentMutationMeta(assignment);
  const accent = !!(showMutationMeta && meta);

  const inner = (
    <div
      className={cn(
        'group relative',
        triggerClassName,
        accent && meta && getMutationOriginRingClass(meta.origin)
      )}
    >
      {accent && meta && (
        <span
          className={cn(
            'pointer-events-none absolute right-0.5 top-0.5 h-3 w-3 shrink-0 rounded-full border border-black/30',
            DOT_CLASS_MAP[meta.origin]
          )}
          aria-hidden
        />
      )}
      <span>{shiftLabel}</span>
      {showChevron ? (
        <ChevronDown
          className={cn('absolute bottom-0 right-0 h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100', chevronClassName)}
          aria-hidden
        />
      ) : null}
    </div>
  );

  const trigger = accent && meta ? (
    <Tooltip delayDuration={280}>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>{inner}</DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" className="border-border/80 bg-popover px-3 py-2 shadow-md">
        <MutationTooltipBody meta={meta} />
      </TooltipContent>
    </Tooltip>
  ) : (
    <DropdownMenuTrigger asChild>{inner}</DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {trigger}
      {menuContent}
    </DropdownMenu>
  );
}
