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
    <div className="min-h-screen bg-background relative">
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 50%) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(195 100% 50%) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
          filter: 'drop-shadow(0 0 8px hsl(195 100% 50% / 0.3))'
        }}></div>
      </div>

      <div className="absolute inset-0 opacity-[0.06] pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 45%) 2px, transparent 2px),
            linear-gradient(to bottom, hsl(195 100% 45%) 2px, transparent 2px)
          `,
          backgroundSize: '400px 400px',
          filter: 'drop-shadow(0 0 20px hsl(195 100% 45% / 0.4))'
        }}></div>
      </div>

      <div className="relative z-10">
        <Navbar />
        
        <Hero />

        <FeatureSection
          title="An Evolution in Intelligence"
          description="Milo isn't software—it's a self-adapting AI that evolves with your operation. Talk naturally, make decisions faster, and watch complexity transform into simplicity."
          image={aiChatImage}
          imageAlt="Milo AI chat interface showing scheduling conversation"
          features={[
            "Self-adapting AI that learns your patterns",
            "Natural conversation replaces complex interfaces",
            "Instant conflict resolution and optimization",
            "Spectacular speed meets effortless control"
          ]}
        />

        <FeatureSection
          title="Instant Import"
          description="Drag and drop your CSV or Excel files. Milo automatically parses, validates, and performs bench alignment checking to ensure perfect data accuracy."
          image={dragDropImage}
          imageAlt="Drag and drop file upload interface"
          features={[
            "CSV and Excel support",
            "Automatic Operator ID parsing",
            "Bench alignment validation",
            "Carryover trip recognition"
          ]}
          reverse
        />

        <FeatureGrid
          title="Evolution in Every Feature"
          features={[
            {
              icon: Calendar,
              title: "Intelligent Scheduling",
              description: "Self-adapting AI transforms complex block assignments into effortless decisions with spectacular speed."
            },
            {
              icon: FileUp,
              title: "Rapid Import",
              description: "Upload files instantly with automatic parsing, validation, and bench alignment checking."
            },
            {
              icon: Shield,
              title: "DOT Compliance",
              description: "Automated validation of 34-hour resets, rolling 6-day patterns, and rest requirements."
            },
            {
              icon: Brain,
              title: "Evolving Intelligence",
              description: "Machine learning that adapts, predicts, and optimizes—getting smarter with every decision."
            },
            {
              icon: Users,
              title: "Protected Drivers",
              description: "Enforce custom driver rules and preferences automatically without manual oversight."
            },
            {
              icon: TrendingUp,
              title: "Analytics",
              description: "Duty-day heatmaps, utilization metrics, and actionable insights for better planning."
            }
          ]}
        />

        <FeatureSection
          title="Compliance Simplified"
          description="Milo continuously monitors rolling-6 day patterns, rest periods, and reset requirements to keep your fleet compliant with federal regulations."
          image={complianceImage}
          imageAlt="Compliance dashboard showing duty-day heatmap"
          features={[
            "Rolling-6 day pattern tracking",
            "34-hour reset validation",
            "10-hour rest monitoring",
            "Duty-day projection heatmaps"
          ]}
        />

        <CTASection />
        
        <Footer />
      </div>
    </div>
  );
}
