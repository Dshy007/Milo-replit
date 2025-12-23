import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { format, subWeeks, parseISO } from 'date-fns';
import {
  Dna, User, Calendar, Clock, Truck, ArrowLeft, AlertCircle,
  TrendingUp, Target, Sparkles, BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PatternFingerprint, WeeklyPatternVisualization } from '@/components/charts/PatternFingerprint';
import { ConfidenceTimeline, ConfidenceGauge } from '@/components/charts/ConfidenceTimeline';
import { ContractTypeBadge } from '@/components/ContractTypeBadge';
import { DNAPatternBadge } from '@/components/DNAPatternBadge';
import type { Driver, DriverDnaProfile } from '@shared/schema';

interface DriverDnaData {
  driver: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    daysOff: string[];
  };
  dnaProfile: DriverDnaProfile | null;
  history: Array<{ day: string; value: number }>;
  confidenceHistory: Array<{ x: string; y: number }>;
  stats: {
    totalAssignments: number;
    uniqueBlocks: number;
    avgBlocksPerWeek: number;
    mostFrequentTractor: string | null;
    mostFrequentTime: string | null;
  };
}

export default function DriverDnaDashboard() {
  // Extract driver ID from URL
  const [match, params] = useRoute('/drivers/:driverId/dna');
  const [, navigate] = useLocation();
  const driverId = params?.driverId;

  // Fetch driver DNA data
  const { data, isLoading, error } = useQuery<DriverDnaData>({
    queryKey: ['/api/drivers', driverId, 'dna'],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/dna`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch driver DNA data');
      }
      return response.json();
    },
    enabled: !!driverId,
  });

  if (!driverId) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium">No driver selected</p>
            <p className="text-muted-foreground mt-2">
              Please select a driver to view their DNA profile
            </p>
            <Button onClick={() => navigate('/driver-profiles')} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Driver Profiles
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mx-auto" />
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mx-auto" />
              <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <p className="text-lg font-medium text-red-600">Failed to load driver DNA</p>
            <p className="text-muted-foreground mt-2">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
            <Button onClick={() => navigate('/driver-profiles')} variant="outline" className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Driver Profiles
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { driver, dnaProfile, history, confidenceHistory, stats } = data;
  const driverName = `${driver.firstName} ${driver.lastName}`;

  return (
    <div className="container mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/driver-profiles')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <User className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  {driverName}
                  <Dna className="w-6 h-6 text-violet-500" />
                </h1>
                <p className="text-muted-foreground">Driver DNA Profile</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {dnaProfile && (
            <>
              <DNAPatternBadge pattern={dnaProfile.patternGroup} size="default" />
              <ContractTypeBadge contractType={dnaProfile.preferredContractType} size="default" />
            </>
          )}
          <Badge variant={driver.status === 'active' ? 'default' : 'secondary'}>
            {driver.status}
          </Badge>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.totalAssignments}</div>
                <div className="text-xs text-muted-foreground">Total Assignments</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.avgBlocksPerWeek.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">Avg Blocks/Week</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold truncate">{stats.mostFrequentTractor || '-'}</div>
                <div className="text-xs text-muted-foreground">Primary Tractor</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <Clock className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.mostFrequentTime || '-'}</div>
                <div className="text-xs text-muted-foreground">Usual Start Time</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pattern Fingerprint */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-500" />
              Work History Fingerprint
            </CardTitle>
            <CardDescription>
              Visual representation of all days worked in the past 6 months
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PatternFingerprint history={history} months={6} />
          </CardContent>
        </Card>

        {/* Weekly Pattern */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-500" />
              Weekly Pattern
            </CardTitle>
            <CardDescription>
              Days this driver typically works
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dnaProfile ? (
              <WeeklyPatternVisualization
                dayList={dnaProfile.preferredDays || []}
                typicalDays={dnaProfile.preferredDays?.length || 0}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No pattern data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confidence Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-violet-500" />
              Confidence Evolution
            </CardTitle>
            <CardDescription>
              How AI prediction confidence has changed over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfidenceTimeline
              data={confidenceHistory}
              currentConfidence={dnaProfile?.consistencyScore ? parseFloat(dnaProfile.consistencyScore) : undefined}
            />
          </CardContent>
        </Card>

        {/* Pattern Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-500" />
              Pattern Details
            </CardTitle>
            <CardDescription>
              Detailed breakdown of driver preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {dnaProfile ? (
              <>
                <ConfidenceGauge
                  confidence={dnaProfile.consistencyScore ? parseFloat(dnaProfile.consistencyScore) : 0}
                  label="Overall Pattern Confidence"
                />

                <div className="space-y-3 pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Preferred Contract</span>
                    <ContractTypeBadge contractType={dnaProfile.preferredContractType} size="sm" />
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Typical Days/Week</span>
                    <Badge variant="outline">{dnaProfile.preferredDays?.length || 0} days</Badge>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Weeks Analyzed</span>
                    <Badge variant="outline">
                      {dnaProfile.weeksAnalyzed || 0} weeks
                    </Badge>
                  </div>

                  {dnaProfile.preferredStartTimes && dnaProfile.preferredStartTimes.length > 0 && (
                    <div className="pt-2">
                      <span className="text-sm text-muted-foreground">Preferred Start Times</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {dnaProfile.preferredStartTimes.map((time, i) => (
                          <Badge key={i} variant="secondary" className="font-mono">
                            {time}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No DNA profile available. Run analysis from the Schedules page.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Days Off Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Days Off Configuration
            </CardTitle>
            <CardDescription>
              Hard constraints - driver will not be scheduled on these days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {driver.daysOff && driver.daysOff.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {driver.daysOff.map((day) => (
                  <Badge key={day} variant="destructive" className="capitalize">
                    {day}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                No days off configured
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              onClick={() => navigate('/driver-profiles')}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Configure Days Off
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
