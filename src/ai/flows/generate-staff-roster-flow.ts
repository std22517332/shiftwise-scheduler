'use server';
/**
 * @fileOverview A Genkit flow for generating weekly, monthly, or yearly staff rosters based on detailed constraints.
 *
 * - generateStaffRoster - A function that handles the staff roster generation process.
 * - GenerateStaffRosterInput - The input type for the generateStaffRoster function.
 * - GenerateStaffRosterOutput - The return type for the generateStaffRoster function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

// Define Staff Profile Schema
const StaffProfileSchema = z.object({
  name: z.string().describe('The full name of the staff member.'),
  department: z.enum(['Reservation', 'QualityControl', 'Contracts']).describe('The department the staff member belongs to.'),
  shiftPreference: z.enum(['Day', 'Night', 'Rotational']).describe('The preferred general shift type for the staff member.'),
  isSenior: z.boolean().describe('True if the staff member is senior, false if junior.'),
  defaultOffDay: z.string().optional().describe('The preferred default day of the week for a full day off (e.g., "Monday", "Sunday").'),
});
export type StaffProfile = z.infer<typeof StaffProfileSchema>;

// Define input for roster generation
const GenerateStaffRosterInputSchema = z.object({
  staffProfiles: z.array(StaffProfileSchema).describe('A list of all staff members with their profiles.'),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).describe('An array of dates (YYYY-MM-DD) marked as official holidays.'),
  extraPeakDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).describe('Additional dates (YYYY-MM-DD) marked as high-traffic days, besides weekends and holidays.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The start date for generating the roster (YYYY-MM-DD).'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The end date for generating the roster (YYYY-MM-DD).'),
});
export type GenerateStaffRosterInput = z.infer<typeof GenerateStaffRosterInputSchema>;

// Define individual shift assignment
const ShiftAssignmentSchema = z.object({
  staffName: z.string().describe('The name of the staff member assigned to this shift.'),
  department: z.enum(['Reservation', 'QualityControl', 'Contracts']).describe('The department of the staff member.'),
  isSenior: z.boolean().describe('Whether the staff member is senior.'),
  shiftType: z.enum(['DayShift', 'NightShift', 'FullDayOff', 'HalfDayOffMorning', 'HalfDayOffAfternoon']).describe(
    'The type of activity assigned for the day. ' +
    '"DayShift" (works 8:30-18:00), "NightShift" (works 15:00-24:00). ' +
    '"FullDayOff" means the staff member is off all day (counts as 1 day off). ' +
    '"HalfDayOffMorning" means the staff member is off from 8:30-13:00 and works from 13:00-18:00 (counts as 0.5 days off). ' +
    '"HalfDayOffAfternoon" means the staff member works from 8:30-13:00 and is off from 13:00-18:00 (counts as 0.5 days off).'
  ),
});
export type ShiftAssignment = z.infer<typeof ShiftAssignmentSchema>;

// Define daily schedule
const DailyScheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date of the schedule entry (YYYY-MM-DD).'),
  dayOfWeek: z.string().describe('The day of the week (e.g., "Sunday", "Monday").'),
  isPeakDay: z.boolean().describe('True if this day is a peak traffic day (Friday, Saturday, Sunday, or a defined holiday/extra peak day).'),
  assignments: z.array(ShiftAssignmentSchema).describe('A list of shift assignments for this specific day.'),
});
export type DailySchedule = z.infer<typeof DailyScheduleSchema>;

// Define output for roster generation
const GenerateStaffRosterOutputSchema = z.object({
  generatedSchedule: z.array(DailyScheduleSchema).describe('The generated staff roster, day by day.'),
  warnings: z.array(z.string()).optional().describe('Any warnings or issues encountered during schedule generation, e.g., if certain constraints could not be fully met.'),
});
export type GenerateStaffRosterOutput = z.infer<typeof GenerateStaffRosterOutputSchema>;

export async function generateStaffRoster(input: GenerateStaffRosterInput): Promise<GenerateStaffRosterOutput> {
  return generateStaffRosterFlow(input);
}

const promptTemplate = ai.definePrompt({
  name: 'generateStaffRosterPrompt',
  input: {schema: GenerateStaffRosterInputSchema},
  output: {schema: GenerateStaffRosterOutputSchema},
  prompt: `You are an expert staff scheduling assistant for a rental holiday business. Your goal is to generate a detailed staff roster based on the provided staff profiles, holiday information, and a set of complex scheduling rules.

The schedule must cover the period from {{{startDate}}} to {{{endDate}}}. Iterate through each day in the period and assign shifts to staff.

## Staff Profiles:
Each staff member has a name, department, shift preference (Day, Night, Rotational), experience level (Senior/Junior), and an optional default day off.

Staff List:
{{#each staffProfiles}}
- Name: {{{name}}}, Dept: {{{department}}}, Shift Pref: {{{shiftPreference}}}, Senior: {{{isSenior}}}, Default Off: {{{defaultOffDay}}}
{{/each}}

## Critical Dates:
- **Holidays**: [{{{holidays}}}]
- **Extra Peak Days**: [{{{extraPeakDays}}}]
- **Peak Traffic Days**: Fridays, Saturdays, Sundays, all specified holidays, and all specified extra peak days are considered high-traffic days. You must determine if a day is a peak day based on its date and day of week.

## Scheduling Rules:

1.  **1.5 Days Off Per Week**: Every staff member must receive an average of 1.5 days off per working week (Monday-Sunday) over the entire schedule period.
    *   A 'FullDayOff' counts as 1 day off.
    *   'HalfDayOffMorning' (off 8:30-13:00, works 13:00-18:00) counts as 0.5 days off.
    *   'HalfDayOffAfternoon' (works 8:30-13:00, off 13:00-18:00) counts as 0.5 days off.
    *   'DayShift' and 'NightShift' count as 0 days off.

2.  **Shift Timings (for reference)**:
    *   **DayShift**: 8:30 - 18:00
    *   **NightShift**: 15:00 - 24:00
    *   **HalfDayOffMorning**: Off 8:30 - 13:00; Works 13:00 - 18:00
    *   **HalfDayOffAfternoon**: Works 8:30 - 13:00; Off 13:00 - 18:00

3.  **Peak Day Staffing (Reservation Department Criticality)**:
    *   On all Peak Traffic Days, the Reservation department must NEVER have a shortage of staff. Ensure a robust number of Reservation staff for optimal coverage.
    *   Prioritize assigning 'FullDayOff' and 'HalfDayOff' on non-peak days as much as possible, especially for Reservation staff.

4.  **Minimum Staff Levels & Seniority**: 
    *   **Night Shift**: Must have a minimum of two (2) rotational staff members present.
    *   **All Shifts (Day/Night)**: At least one (1) Senior staff member is REQUIRED to be present for each type of shift (DayShift, NightShift) where staff are working.
    *   **Day Shift**: Should generally have the maximum possible number of staff compared to the Night Shift.

5.  **Rotational Staff Specifics**:
    *   **Post-Night Shift Off**: If a rotational staff member works a 'NightShift', they must receive either a 'HalfDayOffMorning', 'HalfDayOffAfternoon', or a 'FullDayOff' the very next day. They cannot work a 'DayShift' or 'NightShift' immediately after a 'NightShift'.
    *   **Fair Night Shift Distribution**: Night shifts must be distributed fairly and equitably among rotational staff members throughout the schedule period. Avoid assigning the same rotational staff member consecutive night shifts.

6.  **Fairness for Off-Days (especially Peak Days)**:
    *   Off-days, especially on Peak Traffic Days (Sundays, Fridays, Saturdays), must be distributed equitably among ALL staff members.
    *   If there are 7 staff members, a staff member should ideally not get a Sunday off more frequently than every 6-7 weeks (after all others have had their turn). Apply this principle to all peak days and distribute 'FullDayOff' and 'HalfDayOff' types fairly over time.
    *   Distribute the staff's 'defaultOffDay' preferences as much as possible, unless it conflicts with other critical rules or fairness requirements.

7.  **Flexibility with Staff Numbers**: The system should adapt to the provided number of staff. If there are fewer staff, the frequency of night shifts or working on peak days will naturally increase for individuals, and vice-versa if there are more staff. The rules (like minimum senior staff, minimum rotational staff on night shift) are hard constraints.

## Output Format:
Generate the schedule as a JSON array of daily entries, where each entry specifies the date, day of the week, whether it's a peak day, and an array of staff assignments for that day. Each staff assignment must include staff name, department, seniority, and the assigned shift type.

Strictly adhere to all rules. If any rule cannot be met due to insufficient staff or conflicting constraints, provide a detailed warning in the \`warnings\` array within the output, but still attempt to create the most compliant schedule possible.
The generated schedule should be reasonable, practical, and prioritize operational needs while maintaining fairness.
`,
});

const generateStaffRosterFlow = ai.defineFlow(
  {
    name: 'generateStaffRosterFlow',
    inputSchema: GenerateStaffRosterInputSchema,
    outputSchema: GenerateStaffRosterOutputSchema,
  },
  async (input) => {
    // The LLM is instructed to identify peak days based on the provided holidays, extra peak days, and knowledge of weekends.
    // The prompt explicitly requests the `isPeakDay` boolean for each daily entry.
    const {output} = await promptTemplate(input);
    return output!;
  }
);