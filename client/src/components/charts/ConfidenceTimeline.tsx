import React from 'react';
import { ResponsiveLine } from '@nivo/line';

interface ConfidenceDataPoint {
  x: string; // Week label like "Week 1" or date
  y: number; // Confidence score 0-1
}

interface ConfidenceTimelineProps {
  data: ConfidenceDataPoint[];
  currentConfidence?: number;
}

export function ConfidenceTimeline({ data, currentConfidence }: ConfidenceTimelineProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-muted-foreground">
        <p>No confidence history available</p>
      </div>
    );
  }

  const chartData = [{
    id: 'Confidence',
    color: '#8b5cf6',
    data: data,
  }];

  // Calculate trend
  const firstValue = data[0]?.y || 0;
  const lastValue = data[data.length - 1]?.y || 0;
  const trend = lastValue - firstValue;
  const trendPercent = firstValue > 0 ? ((trend / firstValue) * 100).toFixed(1) : 0;

  return (
    <div>
      {/* Current confidence and trend */}
      <div className="flex gap-4 mb-4">
        <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg px-4 py-2 border border-violet-200 dark:border-violet-800">
          <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">
            {currentConfidence !== undefined
              ? `${Math.round(currentConfidence * 100)}%`
              : `${Math.round(lastValue * 100)}%`
            }
          </div>
          <div className="text-xs text-violet-600/80 dark:text-violet-400/80">Current Confidence</div>
        </div>
        <div className={`rounded-lg px-4 py-2 border ${
          trend >= 0
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        }`}>
          <div className={`text-2xl font-bold ${
            trend >= 0
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {trend >= 0 ? '+' : ''}{trendPercent}%
          </div>
          <div className={`text-xs ${
            trend >= 0
              ? 'text-green-600/80 dark:text-green-400/80'
              : 'text-red-600/80 dark:text-red-400/80'
          }`}>
            Trend
          </div>
        </div>
      </div>

      {/* Line chart */}
      <div style={{ height: '200px' }}>
        <ResponsiveLine
          data={chartData}
          margin={{ top: 20, right: 20, bottom: 50, left: 60 }}
          xScale={{ type: 'point' }}
          yScale={{
            type: 'linear',
            min: 0,
            max: 1,
            stacked: false,
            reverse: false,
          }}
          curve="monotoneX"
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: -45,
            legend: '',
            legendOffset: 36,
            legendPosition: 'middle',
          }}
          axisLeft={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: 'Confidence',
            legendOffset: -50,
            legendPosition: 'middle',
            format: (value) => `${Math.round(Number(value) * 100)}%`,
          }}
          enableGridX={false}
          colors={['#8b5cf6']}
          lineWidth={3}
          pointSize={8}
          pointColor="#ffffff"
          pointBorderWidth={2}
          pointBorderColor={{ from: 'serieColor' }}
          enableArea={true}
          areaOpacity={0.15}
          useMesh={true}
          tooltip={({ point }) => (
            <div className="bg-slate-900 text-white px-3 py-2 rounded shadow-lg text-sm">
              <strong>{point.data.x}</strong>
              <br />
              Confidence: {Math.round(Number(point.data.y) * 100)}%
            </div>
          )}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center mt-2">
        Confidence score shows how reliable the AI's predictions are for this driver
      </p>
    </div>
  );
}

// Simple confidence gauge component
interface ConfidenceGaugeProps {
  confidence: number; // 0-1
  label?: string;
}

export function ConfidenceGauge({ confidence, label = 'Pattern Confidence' }: ConfidenceGaugeProps) {
  const percentage = Math.round(confidence * 100);
  const getColor = () => {
    if (percentage >= 70) return 'bg-green-500';
    if (percentage >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getTextColor = () => {
    if (percentage >= 70) return 'text-green-600 dark:text-green-400';
    if (percentage >= 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`text-lg font-bold ${getTextColor()}`}>{percentage}%</span>
      </div>
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor()} transition-all duration-500 ease-out rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {percentage >= 70
          ? 'High confidence - Reliable predictions'
          : percentage >= 40
            ? 'Medium confidence - Reasonably reliable'
            : 'Low confidence - Limited data available'
        }
      </p>
    </div>
  );
}
