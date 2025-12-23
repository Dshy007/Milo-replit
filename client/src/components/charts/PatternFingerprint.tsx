import React, { useMemo } from 'react';
import { ResponsiveCalendar } from '@nivo/calendar';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

interface HistoryItem {
  day: string; // YYYY-MM-DD format
  value: number; // 1 for worked, could be 2+ for multiple blocks
}

interface PatternFingerprintProps {
  history: HistoryItem[];
  months?: number; // How many months to show (default 6)
}

export function PatternFingerprint({ history, months = 6 }: PatternFingerprintProps) {
  // Calculate date range
  const { fromDate, toDate, calendarData } = useMemo(() => {
    if (!history || history.length === 0) {
      const now = new Date();
      return {
        fromDate: format(subMonths(startOfMonth(now), months - 1), 'yyyy-MM-dd'),
        toDate: format(endOfMonth(now), 'yyyy-MM-dd'),
        calendarData: [],
      };
    }

    // Sort history by date
    const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));

    // Calculate range
    const endDate = new Date();
    const startDate = subMonths(startOfMonth(endDate), months - 1);

    return {
      fromDate: format(startDate, 'yyyy-MM-dd'),
      toDate: format(endOfMonth(endDate), 'yyyy-MM-dd'),
      calendarData: sorted.filter(h => h.day >= format(startDate, 'yyyy-MM-dd')),
    };
  }, [history, months]);

  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <p>No work history available</p>
      </div>
    );
  }

  // Calculate stats
  const totalDays = calendarData.length;
  const totalBlocks = calendarData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div>
      {/* Stats Row */}
      <div className="flex gap-4 mb-4">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-2">
          <div className="text-2xl font-bold text-foreground">{totalDays}</div>
          <div className="text-xs text-muted-foreground">Days Worked</div>
        </div>
        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-2">
          <div className="text-2xl font-bold text-foreground">{totalBlocks}</div>
          <div className="text-xs text-muted-foreground">Total Blocks</div>
        </div>
        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-2">
          <div className="text-2xl font-bold text-foreground">
            {totalDays > 0 ? (totalBlocks / totalDays).toFixed(1) : 0}
          </div>
          <div className="text-xs text-muted-foreground">Blocks/Day</div>
        </div>
      </div>

      {/* Calendar Heatmap */}
      <div style={{ height: '200px' }}>
        <ResponsiveCalendar
          data={calendarData}
          from={fromDate}
          to={toDate}
          emptyColor="#f1f5f9"
          colors={['#c7d2fe', '#818cf8', '#6366f1', '#4f46e5']}
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          yearSpacing={40}
          monthBorderColor="#ffffff"
          monthBorderWidth={2}
          dayBorderWidth={2}
          dayBorderColor="#ffffff"
          legends={[
            {
              anchor: 'bottom-right',
              direction: 'row',
              translateY: 36,
              itemCount: 4,
              itemWidth: 42,
              itemHeight: 36,
              itemsSpacing: 14,
              itemDirection: 'right-to-left',
            },
          ]}
          tooltip={({ day, value }) => (
            <div className="bg-slate-900 text-white px-3 py-2 rounded shadow-lg text-sm">
              <strong>{format(new Date(day), 'MMM d, yyyy')}</strong>
              <br />
              {value} block{value !== 1 ? 's' : ''} worked
            </div>
          )}
        />
      </div>
    </div>
  );
}

// Weekly pattern visualization - shows which days driver typically works
interface WeeklyPatternProps {
  dayList: string[];
  typicalDays: number;
}

export function WeeklyPatternVisualization({ dayList, typicalDays }: WeeklyPatternProps) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const normalizedDayList = dayList.map(d => d.toLowerCase());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Typical Pattern</span>
        <span className="text-sm font-medium">{typicalDays} days/week</span>
      </div>

      <div className="flex gap-2">
        {days.map((day, index) => {
          const isActive = normalizedDayList.includes(fullDays[index]);
          return (
            <div
              key={day}
              className={`
                flex-1 py-3 rounded-lg text-center text-sm font-medium transition-all
                ${isActive
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-muted-foreground'
                }
              `}
            >
              {day}
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground text-center">
        Driver typically works on highlighted days
      </div>
    </div>
  );
}
