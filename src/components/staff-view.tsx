import React, { useState, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Edit2, Trash2, ShieldCheck, Shield } from 'lucide-react';

export function StaffView() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  useEffect(() => {
    setStaffList(getStore().staff);
  }, []);

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newStaff: Staff = {
      id: editingStaff?.id || Math.random().toString(36).substr(2, 9),
      name: formData.get('name') as string,
      department: formData.get('department') as any,
      shiftPreference: formData.get('shiftPreference') as any,
      isSenior: formData.get('isSenior') === 'on',
      defaultOffDay: formData.get('defaultOffDay') as string,
    };

    const updatedList = editingStaff 
      ? staffList.map(s => s.id === editingStaff.id ? newStaff : s)
      : [...staffList, newStaff];

    setStaffList(updatedList);
    updateStaff(updatedList);
    setIsAddOpen(false);
    setEditingStaff(null);
  };

  const removeStaff = (id: string) => {
    const updated = staffList.filter(s => s.id !== id);
    setStaffList(updated);
    updateStaff(updated);
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
            <Button onClick={() => setEditingStaff(null)} className="gap-2 bg-primary hover:bg-primary/90">
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
                <Input id="name" name="name" defaultValue={editingStaff?.name} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select name="department" defaultValue={editingStaff?.department || "Reservation"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select dept" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Reservation">Reservation</SelectItem>
                      <SelectItem value="QualityControl">Quality Control</SelectItem>
                      <SelectItem value="Contracts">Contracts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shiftPreference">Shift Type</Label>
                  <Select name="shiftPreference" defaultValue={editingStaff?.shiftPreference || "Rotational"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Day">Day</SelectItem>
                      <SelectItem value="Night">Night</SelectItem>
                      <SelectItem value="Rotational">Rotational</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="font-semibold">Department</TableHead>
              <TableHead className="font-semibold">Seniority</TableHead>
              <TableHead className="font-semibold">Shift Pref</TableHead>
              <TableHead className="font-semibold">Default Off</TableHead>
              <TableHead className="text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staffList.map((staff) => (
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
                <TableCell>{staff.defaultOffDay}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => { setEditingStaff(staff); setIsAddOpen(true); }} className="h-8 w-8 hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeStaff(staff.id)} className="h-8 w-8 hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
