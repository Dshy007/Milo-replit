import FeatureGrid from '../FeatureGrid';
import { Calendar, FileUp, Shield, Brain, Users, TrendingUp } from 'lucide-react';

export default function FeatureGridExample() {
  return (
    <FeatureGrid
      title="Everything You Need"
      description="Comprehensive tools for modern trucking operations"
      features={[
        {
          icon: Calendar,
          title: "Smart Scheduling",
          description: "AI-powered block assignment with automatic conflict detection and rolling-6 day compliance validation."
        },
        {
          icon: FileUp,
          title: "Drag & Drop Import",
          description: "Upload CSV or Excel files instantly. Automatic parsing, validation, and bench alignment checking."
        },
        {
          icon: Shield,
          title: "DOT Compliance",
          description: "Automated validation of 34-hour reset, rolling 6-day patterns, and 10-hour rest requirements."
        },
        {
          icon: Brain,
          title: "ML Predictions",
          description: "Forecast block availability and optimize driver assignments based on historical patterns."
        },
        {
          icon: Users,
          title: "Protected Drivers",
          description: "Enforce custom driver rules and preferences automatically without manual oversight."
        },
        {
          icon: TrendingUp,
          title: "Analytics & Insights",
          description: "Duty-day heatmaps, utilization metrics, and actionable insights for better planning."
        }
      ]}
    />
  );
}
