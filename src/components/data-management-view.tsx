
'use client';

import React, { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { exportStoreData, importStoreData, resetSchedulingData } from '@/lib/store';
import { Download, Upload, Trash2, AlertTriangle, FileJson, CheckCircle2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from 'date-fns';

export function DataManagementView() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetEmployees, setResetEmployees] = useState(false);
  const [resetConfig, setResetConfig] = useState(false);

  const handleExport = () => {
    try {
      const data = exportStoreData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = format(new Date(), 'yyyy-MM-dd_HHmm');
      link.href = url;
      link.download = `shiftwise_backup_${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Backup Created",
        description: "Scheduling data exported successfully.",
      });
    } catch (error) {
      toast({
        title: "Backup Failed",
        description: "An error occurred while creating the backup.",
        variant: "destructive",
      });
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const success = importStoreData(content);
      
      if (success) {
        toast({
          title: "Restore Successful",
          description: "Data has been restored. Reloading application...",
        });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast({
          title: "Restore Failed",
          description: "The file provided is invalid or corrupted.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (resetConfirmation !== 'RESET') {
      toast({
        title: "Invalid Confirmation",
        description: "Please type 'RESET' exactly as shown.",
        variant: "destructive",
      });
      return;
    }

    resetSchedulingData({
      resetEmployees,
      resetConfig
    });

    toast({
      title: "Data Reset Complete",
      description: "Generated schedules have been cleared. Reloading...",
    });
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-bold text-foreground text-primary">Data Management</h2>
          <p className="text-muted-foreground text-sm font-medium">Backup, restore, and maintain your local scheduling database.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backup Card */}
        <Card className="shadow-sm border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" /> Backup Data
            </CardTitle>
            <CardDescription>
              Download a complete snapshot of all employees, rosters, and settings to your computer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-xl border border-dashed flex flex-col items-center justify-center text-center space-y-2">
              <FileJson className="w-10 h-10 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">Exports all generated schedules, revisions, and swaps.</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleExport} className="w-full bg-primary gap-2">
              <Download className="w-4 h-4" /> Export JSON Backup
            </Button>
          </CardFooter>
        </Card>

        {/* Restore Card */}
        <Card className="shadow-sm border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-600" /> Restore Data
            </CardTitle>
            <CardDescription>
              Upload a previously exported backup file to restore your entire database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/30 rounded-xl border border-dashed flex flex-col items-center justify-center text-center space-y-2">
              <RotateCcw className="w-10 h-10 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">Warning: This will overwrite all current browser data.</p>
            </div>
            <input 
              type="file" 
              accept=".json" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImport}
            />
          </CardContent>
          <CardFooter>
            <Button 
              variant="outline" 
              className="w-full border-emerald-600/20 text-emerald-700 hover:bg-emerald-50 gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" /> Select Backup File
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Danger Zone */}
      <Card className="border-destructive/20 shadow-sm bg-destructive/5 overflow-hidden">
        <div className="p-1 bg-destructive text-white text-[10px] font-bold uppercase tracking-widest text-center">
          Administrative Danger Zone
        </div>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" /> Reset Generated Data
          </CardTitle>
          <CardDescription>
            Clear specific data sets from your current local storage. This action is permanent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border">
              <Checkbox 
                id="employees" 
                checked={resetEmployees} 
                onCheckedChange={(checked) => setResetEmployees(!!checked)}
              />
              <div className="grid gap-1.5 leading-none">
                <label htmlFor="employees" className="text-sm font-bold">Reset employees too</label>
                <p className="text-xs text-muted-foreground">Deletes all staff profiles and restores default list.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border">
              <Checkbox 
                id="config" 
                checked={resetConfig} 
                onCheckedChange={(checked) => setResetConfig(!!checked)}
              />
              <div className="grid gap-1.5 leading-none">
                <label htmlFor="config" className="text-sm font-bold">Reset app configuration</label>
                <p className="text-xs text-muted-foreground">Clears all defined holidays and peak season dates.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
              <div className="text-xs text-amber-900 font-medium">
                This will delete all generated schedule data, history, and assignments from this browser. Please create a backup first.
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-4">
          <div className="w-full space-y-2">
            <Label htmlFor="confirmation" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Type <span className="text-destructive">RESET</span> to confirm
            </Label>
            <div className="flex gap-3">
              <Input 
                id="confirmation" 
                placeholder="RESET" 
                value={resetConfirmation}
                onChange={(e) => setResetConfirmation(e.target.value)}
                className="bg-white"
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    className="px-8 font-bold"
                    disabled={resetConfirmation !== 'RESET'}
                  >
                    Wipe Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete your active roster and all archived history blocks. 
                      {resetEmployees && " All custom staff profiles will also be deleted."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-destructive text-white hover:bg-destructive/90">
                      Confirm Wipe
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
