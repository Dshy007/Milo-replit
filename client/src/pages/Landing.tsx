import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeatureSection from "@/components/FeatureSection";
import FeatureGrid from "@/components/FeatureGrid";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";
import { Calendar, FileUp, Shield, Brain, Users, TrendingUp } from "lucide-react";
import aiChatImage from "@assets/generated_images/AI_chat_feature_showcase_4b227a38.png";
import dragDropImage from "@assets/generated_images/Drag_drop_upload_feature_b5e469a9.png";
import complianceImage from "@assets/generated_images/Compliance_dashboard_feature_dac05b17.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <Hero />

      <FeatureSection
        title="Meet Milo, Your AI Assistant"
        description="Talk to Milo in plain English. No complex interfaces or training required. Ask about driver availability, schedule conflicts, or DOT compliance in natural language."
        image={aiChatImage}
        imageAlt="Milo AI chat interface showing scheduling conversation"
        features={[
          "Natural language scheduling commands",
          "Real-time driver availability queries",
          "Automatic conflict detection and resolution",
          "Smart recommendations for optimal assignments"
        ]}
      />

      <FeatureSection
        title="Drag & Drop File Import"
        description="Upload your CSV or Excel files with a simple drag and drop. Milo automatically parses, validates, and performs bench alignment checking to ensure data accuracy."
        image={dragDropImage}
        imageAlt="Drag and drop file upload interface"
        features={[
          "Support for CSV and Excel formats",
          "Automatic Operator ID parsing",
          "Bench alignment validation with reason codes",
          "Carryover trip recognition for weekly files"
        ]}
        reverse
      />

      <FeatureGrid
        title="Everything You Need for Fleet Operations"
        features={[
          {
            icon: Calendar,
            title: "Smart Scheduling",
            description: "AI-powered block assignment with automatic conflict detection and rolling-6 day compliance validation for all drivers."
          },
          {
            icon: FileUp,
            title: "Instant Import",
            description: "Upload CSV or Excel files instantly with automatic parsing, validation, and bench alignment checking built-in."
          },
          {
            icon: Shield,
            title: "DOT Compliance",
            description: "Automated validation of 34-hour reset, rolling 6-day patterns, and 10-hour rest requirements for every assignment."
          },
          {
            icon: Brain,
            title: "ML Predictions",
            description: "Forecast block availability and optimize driver assignments using machine learning models trained on historical data."
          },
          {
            icon: Users,
            title: "Protected Drivers",
            description: "Enforce custom driver rules and preferences automatically. Never assign Isaac on Fridays or override Firas's schedule."
          },
          {
            icon: TrendingUp,
            title: "Analytics Dashboard",
            description: "Duty-day heatmaps, utilization metrics, and actionable insights help you plan better and avoid violations."
          }
        ]}
      />

      <FeatureSection
        title="DOT Compliance Made Simple"
        description="Milo continuously monitors rolling-6 day patterns, rest periods, and reset requirements to keep your fleet compliant with federal regulations."
        image={complianceImage}
        imageAlt="Compliance dashboard showing duty-day heatmap"
        features={[
          "Rolling-6 day pattern tracking",
          "34-hour reset validation",
          "10-hour rest period monitoring",
          "Duty-day projection heatmaps"
        ]}
      />

      <CTASection />
      
      <Footer />
    </div>
  );
}
