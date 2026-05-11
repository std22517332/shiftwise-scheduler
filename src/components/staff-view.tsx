import React, { useState, useEffect, useMemo } from 'react';
import { Staff } from '@/lib/types';
import { getStore, updateStaff } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Edit2, Trash2, ShieldCheck, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type SortField = 'department' | 'shiftPreference' | 'name';

type DepartmentFilterKey = '__all__' | Staff['department'];
type ShiftFilterKey = '__all__' | Staff['shiftPreference'];

const DEPARTMENT_FILTER_ALL: DepartmentFilterKey = '__all__';
const SHIFT_FILTER_ALL: ShiftFilterKey = '__all__';

const DEPARTMENT_LABELS: Record<Staff['department'], string> = {
  Reservation: 'Reservation',
  Housekeeping: 'Housekeeping',
  QualityControl: 'Quality Control',
  Contracts: 'Contracts',
};

const SHIFT_LABELS: Record<Staff['shiftPreference'], string> = {
  Day: 'Day',
  Night: 'Night',
  Rotational: 'Rotational',
  StudentFixed: 'Student (Fixed Weekly)',
};

const DEPARTMENT_ORDER: Staff['department'][] = ['Reservation', 'Housekeeping', 'QualityControl', 'Contracts'];
const SHIFT_ORDER: Staff['shiftPreference'][] = ['Day', 'Rotational', 'Night', 'StudentFixed'];

export function StaffView() {
  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [selectedShiftPreference, setSelectedShiftPreference] = useState<Staff['shiftPreference']>('Rotational');
  const [selectedDepartment, setSelectedDepartment] = useState<Staff['department']>('Reservation');
  const [nameError, setNameError] = useState('');
  const [primarySort, setPrimarySort] = useState<SortField>('department');
  /** When primary is department: filter/group by chosen department(s). All = sort every dept in order. */
  const [departmentSubgroup, setDepartmentSubgroup] = useState<DepartmentFilterKey>(DEPARTMENT_FILTER_ALL);
  /** When primary is shift preference: filter by chosen shift type. */
  const [shiftSubgroup, setShiftSubgroup] = useState<ShiftFilterKey>(SHIFT_FILTER_ALL);
  /** Final tie-break sort key after applying primary (+ optional subgroup filter). */
  const [thenSortBy, setThenSortBy] = useState<SortField>('shiftPreference');
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);
  const { toast } = useToast();
  const selectedOffDays = editingStaff?.weeklyOffDays ?? (selectedDepartment === 'Housekeeping' ? 1 : 1.5);

  useEffect(() => {
    setStaffList(getStore().staff);
  }, []);

  const filteredStaffList = useMemo(() => {
    if (primarySort === 'department' && departmentSubgroup !== DEPARTMENT_FILTER_ALL) {
      return staffList.filter((s) => s.department === departmentSubgroup);
    }
    if (primarySort === 'shiftPreference' && shiftSubgroup !== SHIFT_FILTER_ALL) {
      return staffList.filter((s) => s.shiftPreference === shiftSubgroup);
    }
    return staffList;
  }, [staffList, primarySort, departmentSubgroup, shiftSubgroup]);

  const sortedStaffList = useMemo(() => {
    const compareByField = (a: Staff, b: Staff, field: SortField) => {
      if (field === 'department') return DEPARTMENT_ORDER.indexOf(a.department) - DEPARTMENT_ORDER.indexOf(b.department);
      if (field === 'shiftPreference') return SHIFT_ORDER.indexOf(a.shiftPreference) - SHIFT_ORDER.indexOf(b.shiftPreference);
      return a.name.localeCompare(b.name);
    };

    let tertiary = thenSortBy;
    if (tertiary === primarySort) {
      const fallbacks = (['department', 'shiftPreference', 'name'] as SortField[]).filter((f) => f !== primarySort);
      tertiary = fallbacks[0]!;
    }

    return [...filteredStaffList].sort((a, b) => {
      const primaryCompare = compareByField(a, b, primarySort);
      if (primaryCompare !== 0) return primaryCompare;

      const tertiaryCompare = compareByField(a, b, tertiary);
      if (tertiaryCompare !== 0) return tertiaryCompare;

      const leftover = (['department', 'shiftPreference', 'name'] as SortField[]).filter(
        (f) => f !== primarySort && f !== tertiary
      )[0]!;
      const leftoverCompare = compareByField(a, b, leftover);
      if (leftoverCompare !== 0) return leftoverCompare;

      return a.name.localeCompare(b.name);
    });
  }, [filteredStaffList, primarySort, thenSortBy]);

  const getWeeklyOffDays = (staff: Staff): 1 | 1.5 => {
    if (staff.weeklyOffDays === 1 || staff.weeklyOffDays === 1.5) return staff.weeklyOffDays;
    return staff.department === 'Housekeeping' ? 1 : 1.5;
  };

  const primarySortOptions: { value: SortField; label: string }[] = [
    { value: 'department', label: 'Department' },
    { value: 'shiftPreference', label: 'Shift preference type' },
    { value: 'name', label: 'Name' },
  ];

  const tertiaryOptionsForPrimary = (primary: SortField): SortField[] => {
    if (primary === 'department') return ['shiftPreference', 'name'];
    if (primary === 'shiftPreference') return ['department', 'name'];
    return ['department', 'shiftPreference'];
  };

  const handlePrimarySortChange = (nextPrimary: SortField) => {
    setPrimarySort(nextPrimary);
    if (nextPrimary === 'department') {
      setDepartmentSubgroup(DEPARTMENT_FILTER_ALL);
      setThenSortBy('shiftPreference');
    } else if (nextPrimary === 'shiftPreference') {
      setShiftSubgroup(SHIFT_FILTER_ALL);
      setThenSortBy('department');
    } else {
      setThenSortBy('department');
    }
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameError('');
    const formData = new FormData(e.currentTarget);
    const normalizeName = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const staffName = String(formData.get('name') ?? '').trim();

    if (!staffName) {
      setNameError('Full name is required.');
      toast({
        title: 'خطا',
        description: 'نام را وارد کنید',
        variant: 'destructive',
      });
      return;
    }

    const isDuplicateName = staffList.some((staff) => {
      if (!staff || typeof staff !== 'object') return false;
      const isSameName = normalizeName((staff as Partial<Staff>).name) === normalizeName(staffName);
      if (!isSameName) return false;

      if (!editingStaff) return true;
      return (staff as Partial<Staff>).id !== editingStaff.id;
    });

    if (isDuplicateName) {
      setNameError('This name is taken');
      toast({
        title: 'خطا',
        description: 'نام درج شده تکراری هست',
        variant: 'destructive',
      });
      return;
    }

    const department = formData.get('department') as Staff['department'];
    const rawShiftPreference = formData.get('shiftPreference') as Staff['shiftPreference'];
    const weeklyOffDaysInput = Number(formData.get('weeklyOffDays'));
    const weeklyOffDays: 1 | 1.5 = weeklyOffDaysInput === 1 ? 1 : 1.5;
    const shiftPreference: Staff['shiftPreference'] = rawShiftPreference;

    const guaranteedOffFrequency = ((formData.get('guaranteedOffFrequency') as any) || 'none') as Staff['guaranteedOffFrequency'];

    const newStaff: Staff = {
      id: editingStaff?.id || Math.random().toString(36).substr(2, 9),
      name: staffName,
      department,
      shiftPreference,
      isSenior: formData.get('isSenior') === 'on',
      defaultOffDay: formData.get('defaultOffDay') as string,
      guaranteedOffFrequency,
      guaranteedOffDay:
        guaranteedOffFrequency === 'none'
          ? undefined
          : ((formData.get('guaranteedOffDay') as Staff['guaranteedOffDay']) || 'Sunday'),
      weeklyOffDays,
      studentPatternMode: shiftPreference === 'StudentFixed' ? ((formData.get('studentPatternMode') as any) || 'academic') : undefined,
      studentWeeklyPattern: shiftPreference === 'StudentFixed'
        ? weekDays.reduce((acc, day) => {
            const v = formData.get(`student_${day}`) as 'Day' | 'Night' | null;
            if (v) acc[day] = v;
            return acc;
          }, {} as any)
        : undefined,
    };

    const updatedList = editingStaff 
      ? staffList.map((s) => (s?.id === editingStaff.id ? newStaff : s))
      : [...staffList, newStaff];

    setStaffList(updatedList);
    updateStaff(updatedList);
    setIsAddOpen(false);
    setEditingStaff(null);
    setNameError('');
  };

  const removeStaff = (staff: Staff) => {
    const updated = staffList.filter(s => s.id !== staff.id);
    setStaffList(updated);
    updateStaff(updated);
    setStaffToDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground">Staff Directory</h2>
          <p className="text-muted-foreground text-sm">Manage your team profiles and preferences.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingStaff(null); setSelectedShiftPreference('Rotational'); setSelectedDepartment('Reservation'); setNameError(''); }} className="gap-2 bg-primary hover:bg-primary/90">
              <UserPlus className="w-4 h-4" /> Add Staff Member
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingStaff ? 'Edit Staff Profile' : 'Add Staff Member'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingStaff?.name}
                  required
                  onChange={() => {
                    if (nameError) setNameError('');
                  }}
                  className={nameError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
                {nameError ? <p className="text-sm text-red-600">{nameError}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select
                    name="department"
                    defaultValue={editingStaff?.department || "Reservation"}
                    onValueChange={(value) => setSelectedDepartment(value as Staff['department'])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select dept" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Reservation">Reservation</SelectItem>
                      <SelectItem value="QualityControl">Quality Control</SelectItem>
                      <SelectItem value="Contracts">Contracts</SelectItem>
                      <SelectItem value="Housekeeping">Housekeeping</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shiftPreference">Shift Type</Label>
                  <Select
                    name="shiftPreference"
                    defaultValue={editingStaff?.shiftPreference || "Rotational"}
                    onValueChange={(value) => setSelectedShiftPreference(value as Staff['shiftPreference'])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Day">Day</SelectItem>
                      <SelectItem value="Night">Night</SelectItem>
                      <SelectItem value="Rotational">Rotational</SelectItem>
                      <SelectItem value="StudentFixed">Student (Fixed Weekly)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {selectedDepartment === 'Housekeeping' && (
                <p className="text-xs text-muted-foreground rounded-md border border-primary/20 bg-primary/5 p-2">
                  Housekeeping staff can use any shift type selected above. You can also choose 1 or 1.5 OFF days per week.
                </p>
              )}
              {selectedDepartment !== 'Housekeeping' && selectedShiftPreference === 'StudentFixed' && (
                <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                  <div className="space-y-2">
                    <Label htmlFor="studentPatternMode">Student Mode</Label>
                    <Select name="studentPatternMode" defaultValue={editingStaff?.studentPatternMode || "academic"}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="academic">Academic Term</SelectItem>
                        <SelectItem value="summer">Summer (Day only)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {weekDays.map((day) => (
                      <div key={day} className="space-y-1">
                        <Label htmlFor={`student_${day}`} className="text-xs">{day}</Label>
                        <Select name={`student_${day}`} defaultValue={editingStaff?.studentWeeklyPattern?.[day] || 'Day'}>
                          <SelectTrigger>
                            <SelectValue placeholder="Shift" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Day">Day</SelectItem>
                            <SelectItem value="Night">Night</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="defaultOffDay">Preferred Default Off Day</Label>
                <Select name="defaultOffDay" defaultValue={editingStaff?.defaultOffDay || "Sunday"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                      <SelectItem key={day} value={day}>{day}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="weeklyOffDays">OFF Days Per Week</Label>
                <Select name="weeklyOffDays" defaultValue={String(selectedOffDays)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select weekly OFF" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="1.5">1.5 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="guaranteedOffFrequency">Guaranteed OFF Rule</Label>
                  <Select name="guaranteedOffFrequency" defaultValue={editingStaff?.guaranteedOffFrequency || "none"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select rule" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="weekly">Weekly (always)</SelectItem>
                      <SelectItem value="monthly">Monthly (once)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guaranteedOffDay">Guaranteed OFF Day</Label>
                  <Select name="guaranteedOffDay" defaultValue={editingStaff?.guaranteedOffDay || "Sunday"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                    <SelectContent>
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <input type="checkbox" id="isSenior" name="isSenior" defaultChecked={editingStaff?.isSenior} className="rounded border-input text-primary focus:ring-primary" />
                <Label htmlFor="isSenior" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Senior Experience (Expert)
                </Label>
              </div>
              <Button type="submit" className="w-full bg-primary mt-4">Save Staff Member</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-muted/20 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[220px] min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Primary sort</Label>
              <Select value={primarySort} onValueChange={(value) => handlePrimarySortChange(value as SortField)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {primarySortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {primarySort === 'department' && (
              <div className="w-[220px] min-w-[180px]">
                <Label className="text-xs text-muted-foreground">By department</Label>
                <Select
                  value={departmentSubgroup}
                  onValueChange={(v) => setDepartmentSubgroup(v as DepartmentFilterKey)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEPARTMENT_FILTER_ALL}>All departments</SelectItem>
                    {DEPARTMENT_ORDER.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {DEPARTMENT_LABELS[dept]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {primarySort === 'shiftPreference' && (
              <div className="w-[220px] min-w-[180px]">
                <Label className="text-xs text-muted-foreground">By shift type</Label>
                <Select value={shiftSubgroup} onValueChange={(v) => setShiftSubgroup(v as ShiftFilterKey)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHIFT_FILTER_ALL}>All shift types</SelectItem>
                    {SHIFT_ORDER.map((pref) => (
                      <SelectItem key={pref} value={pref}>
                        {SHIFT_LABELS[pref]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="w-[220px] min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Then sort by</Label>
              <Select
                value={
                  tertiaryOptionsForPrimary(primarySort).includes(thenSortBy)
                    ? thenSortBy
                    : tertiaryOptionsForPrimary(primarySort)[0]!
                }
                onValueChange={(v) => setThenSortBy(v as SortField)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tertiaryOptionsForPrimary(primarySort).map((field) => (
                    <SelectItem key={field} value={field}>
                      {field === 'department' && 'Department'}
                      {field === 'shiftPreference' && 'Shift preference type'}
                      {field === 'name' && 'Name'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug max-w-3xl">
            {primarySort === 'department' &&
              'Choose all departments or one department above, then use “Then sort by” for shift preference or name order within each group.'}
            {primarySort === 'shiftPreference' &&
              'Choose all shifts or one shift type, then sort ties by department or name.'}
            {primarySort === 'name' && 'Alphabetical by name first, then by department or shift as second key.'}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="font-semibold">Department</TableHead>
              <TableHead className="font-semibold">Seniority</TableHead>
              <TableHead className="font-semibold">Shift Pref</TableHead>
              <TableHead className="font-semibold">OFF/Week</TableHead>
              <TableHead className="font-semibold">Default Off</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedStaffList.map((staff) => (
              <TableRow key={staff.id} className="hover:bg-muted/10 transition-colors">
                <TableCell className="font-medium">{staff.name}</TableCell>
                <TableCell>{staff.department}</TableCell>
                <TableCell>
                  {staff.isSenior ? (
                    <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
                      <ShieldCheck className="w-3 h-3 mr-1" /> Senior
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-muted text-muted-foreground border-transparent">
                       <Shield className="w-3 h-3 mr-1" /> Junior
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{staff.shiftPreference}</TableCell>
                <TableCell>{getWeeklyOffDays(staff)}</TableCell>
                <TableCell>{staff.defaultOffDay}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => { setEditingStaff(staff); setSelectedShiftPreference(staff.shiftPreference); setSelectedDepartment(staff.department); setNameError(''); setIsAddOpen(true); }} className="h-8 w-8 hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setStaffToDelete(staff)} className="h-8 w-8 hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!staffToDelete} onOpenChange={(open) => { if (!open) setStaffToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Staff Member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {staffToDelete?.name ? `"${staffToDelete.name}"` : 'this staff member'}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (staffToDelete) removeStaff(staffToDelete); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
