/**
 * Gemini Scout Agent
 *
 * The real-time perception layer of the Milo Neural Intelligence System.
 * Handles weather, traffic, and environmental data gathering.
 *
 * "I see what is happening NOW. I report what I see. I do not decide - I illuminate."
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  BaseAgent,
  AgentRequest,
  AgentResponse,
  AgentContext,
  ThoughtBranch
} from "./base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              SAFETY ALERT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type AlertSeverity = "advisory" | "warning" | "critical";

export interface WeatherCondition {
  type: "fog" | "ice" | "snow" | "storm" | "wind" | "rain" | "clear" | "hazmat";
  severity: AlertSeverity;
  description: string;
  visibility?: number; // miles
  windSpeed?: number; // mph
  precipitation?: number; // inches
  temperature?: number;
  timestamp: Date;
}

export interface SafetyAlert {
  condition: WeatherCondition;
  recommendation: string;
  affectedRoutes?: string[];
  validUntil: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              GEMINI SCOUT
// ═══════════════════════════════════════════════════════════════════════════════

export class GeminiScout extends BaseAgent {
  private client: GoogleGenerativeAI;
  private geminiModel: any; // Gemini model instance

  constructor() {
    super("scout");
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  }

  /**
   * Initialize with Gemini model
   */
  async initialize(): Promise<void> {
    await super.initialize();
    this.geminiModel = this.client.getGenerativeModel({
      model: "gemini-1.5-flash" // Using flash for faster responses
    });
  }

  /**
   * Process a request as the Scout
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Build prompt with system context
      const systemPrompt = this.formatSystemPrompt(request.context);
      const fullPrompt = `${systemPrompt}\n\n---\n\nUser Query: ${request.input}\n\nProvide observations with confidence levels. Format weather or condition data clearly. Flag any safety concerns.`;

      // Call Gemini API
      const result = await this.geminiModel.generateContent(fullPrompt);
      const response = result.response;
      const responseText = response.text();

      // Extract confidence from response
      const confidence = this.extractScoutConfidence(responseText);

      // Parse any safety alerts
      const safetyAlerts = this.parseSafetyAlerts(responseText);

      // Create thought record
      const thoughtId = await this.createThought(
        request.context.tenantId,
        "observation",
        responseText,
        confidence,
        {
          parentId: request.parentThoughtId,
          sessionId: request.context.sessionId,
          evidence: safetyAlerts.length > 0 ? { safetyAlerts } : undefined,
          metadata: {
            model: "gemini-1.5-pro",
            responseTimeMs: Date.now() - startTime
          }
        }
      );

      // Log routing
      await this.logRouting(
        request.context.tenantId,
        request.input,
        this.classifyIntent(request.input),
        "Scout gathering real-time data",
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: true
        }
      );

      return {
        output: responseText,
        confidence,
        thoughtId,
        suggestedNextAgent: "architect", // Always return to Architect after scouting
        shouldConverge: false, // Scout never converges - just reports
        metadata: {
          model: "gemini-1.5-pro",
          responseTimeMs: Date.now() - startTime,
          safetyAlerts
        }
      };
    } catch (error) {
      console.error("Gemini Scout error:", error);

      // Log the failure
      await this.logRouting(
        request.context.tenantId,
        request.input,
        "error",
        "Scout encountered an error",
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        }
      );

      throw error;
    }
  }

  /**
   * Check if this agent can handle the given input
   */
  canHandle(input: string, _context: AgentContext): boolean {
    const scoutKeywords = [
      "weather", "forecast", "temperature", "rain", "snow", "fog", "ice",
      "traffic", "road conditions", "visibility", "wind",
      "current conditions", "right now", "today",
      "location", "geocode", "route", "distance"
    ];

    const lowerInput = input.toLowerCase();
    return scoutKeywords.some(keyword => lowerInput.includes(keyword));
  }

  /**
   * Get weather conditions for a location
   * Note: In production, this would call actual weather APIs
   */
  async getWeatherConditions(location: string): Promise<WeatherCondition[]> {
    // This is a placeholder - in production, integrate with:
    // - OpenWeatherMap API
    // - National Weather Service API
    // - Google Weather API

    const prompt = `Analyze the weather conditions for ${location}.
    Consider: temperature, precipitation, wind, visibility, and any hazardous conditions.
    Format your response as structured data with severity levels (advisory/warning/critical).`;

    const result = await this.geminiModel.generateContent(prompt);
    const responseText = result.response.text();

    // Parse the response into structured weather conditions
    return this.parseWeatherResponse(responseText, location);
  }

  /**
   * Check for safety alerts affecting routes
   */
  async checkSafetyAlerts(routes: string[]): Promise<SafetyAlert[]> {
    const alerts: SafetyAlert[] = [];

    for (const route of routes) {
      const prompt = `Check for any safety concerns or hazardous conditions on route: ${route}.
      Include: weather hazards, traffic incidents, road closures, construction.
      Rate severity as: advisory (be aware), warning (use caution), critical (avoid if possible).`;

      const result = await this.geminiModel.generateContent(prompt);
      const responseText = result.response.text();

      const routeAlerts = this.parseSafetyAlerts(responseText);
      alerts.push(...routeAlerts.map(alert => ({
        ...alert,
        affectedRoutes: [route]
      })));
    }

    return alerts;
  }

  /**
   * Extract confidence from Scout response
   */
  private extractScoutConfidence(response: string): number {
    const lowerResponse = response.toLowerCase();

    // Scout reports data confidence, not decision confidence
    let confidence = 60; // Base confidence for real-time data

    // High confidence indicators (reliable data sources)
    const highIndicators = [
      "confirmed", "official report", "verified",
      "current as of", "real-time data shows",
      "national weather service", "official forecast"
    ];

    // Low confidence indicators (uncertain data)
    const lowIndicators = [
      "estimated", "approximately", "likely",
      "unable to confirm", "no data available",
      "outdated", "may be inaccurate"
    ];

    for (const indicator of highIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence += 10;
      }
    }

    for (const indicator of lowIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence -= 10;
      }
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Parse safety alerts from response text
   */
  private parseSafetyAlerts(response: string): SafetyAlert[] {
    const alerts: SafetyAlert[] = [];
    const lowerResponse = response.toLowerCase();

    // Check for critical conditions
    if (lowerResponse.includes("ice") || lowerResponse.includes("icy")) {
      alerts.push({
        condition: {
          type: "ice",
          severity: "critical",
          description: "Ice detected on roadways",
          timestamp: new Date()
        },
        recommendation: "Delay dispatch or assign experienced winter drivers only",
        validUntil: new Date(Date.now() + 6 * 60 * 60 * 1000) // 6 hours
      });
    }

    if (lowerResponse.includes("fog") && (lowerResponse.includes("dense") || lowerResponse.includes("heavy"))) {
      alerts.push({
        condition: {
          type: "fog",
          severity: "warning",
          description: "Dense fog reducing visibility",
          visibility: 0.5,
          timestamp: new Date()
        },
        recommendation: "Delay dispatch until visibility improves above 1 mile",
        validUntil: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      });
    }

    if (lowerResponse.includes("storm") || lowerResponse.includes("severe thunderstorm")) {
      alerts.push({
        condition: {
          type: "storm",
          severity: "warning",
          description: "Severe storm activity",
          timestamp: new Date()
        },
        recommendation: "Avoid open highways, monitor conditions",
        validUntil: new Date(Date.now() + 3 * 60 * 60 * 1000) // 3 hours
      });
    }

    if (lowerResponse.match(/wind.*?(\d+)\s*mph/i)) {
      const windMatch = lowerResponse.match(/wind.*?(\d+)\s*mph/i);
      const windSpeed = windMatch ? parseInt(windMatch[1], 10) : 0;

      if (windSpeed >= 40) {
        alerts.push({
          condition: {
            type: "wind",
            severity: windSpeed >= 50 ? "critical" : "warning",
            description: `High wind gusts of ${windSpeed} mph`,
            windSpeed,
            timestamp: new Date()
          },
          recommendation: "Extreme caution for high-profile vehicles",
          validUntil: new Date(Date.now() + 4 * 60 * 60 * 1000)
        });
      }
    }

    return alerts;
  }

  /**
   * Parse weather response into structured data
   */
  private parseWeatherResponse(response: string, _location: string): WeatherCondition[] {
    const conditions: WeatherCondition[] = [];

    // This is simplified parsing - in production use proper NLP or structured API responses
    const lowerResponse = response.toLowerCase();

    // Detect condition types
    if (lowerResponse.includes("rain")) {
      conditions.push({
        type: "rain",
        severity: lowerResponse.includes("heavy") ? "warning" : "advisory",
        description: "Rain expected",
        timestamp: new Date()
      });
    }

    if (lowerResponse.includes("snow")) {
      conditions.push({
        type: "snow",
        severity: lowerResponse.includes("heavy") ? "critical" : "warning",
        description: "Snow expected",
        timestamp: new Date()
      });
    }

    if (lowerResponse.includes("clear") || lowerResponse.includes("sunny")) {
      conditions.push({
        type: "clear",
        severity: "advisory",
        description: "Clear conditions",
        timestamp: new Date()
      });
    }

    return conditions;
  }

  /**
   * Classify the intent of user input
   */
  private classifyIntent(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("weather") || lowerInput.includes("forecast")) {
      return "weather";
    }
    if (lowerInput.includes("traffic") || lowerInput.includes("road")) {
      return "traffic";
    }
    if (lowerInput.includes("location") || lowerInput.includes("route")) {
      return "location";
    }

    return "real_time_general";
  }
}

// Export singleton instance
let scoutInstance: GeminiScout | null = null;

export async function getScout(): Promise<GeminiScout> {
  if (!scoutInstance) {
    scoutInstance = new GeminiScout();
    await scoutInstance.initialize();
  }
  return scoutInstance;
}
