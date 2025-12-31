/**
 * Twilio Voice Service
 *
 * Handles automated voice calls to drivers using Twilio with Google TTS.
 * Voice: Google.en-US-Chirp3-HD-Aoede (Google Neural Voice)
 */

import Twilio from 'twilio';
import { db } from './db';
import { voiceBroadcasts, drivers, trips, facilityCodes } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

// Twilio credentials from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Google TTS voice configuration
const TTS_VOICE = 'Google.en-US-Chirp3-HD-Aoede';

interface TwilioServiceConfig {
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

interface CallResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

interface WeatherBroadcastParams {
  driverId: string;
  driverPhone: string;
  tripId?: string;
  destination: string;
  weatherConditions: string;
  temperature: string;
  alerts?: string[];
  windSpeed?: string;
  visibility?: string;
}

interface SafetyAlertBroadcastParams {
  driverId: string;
  driverPhone: string;
  alertType: string;
  severity: string;
  description: string;
  location?: string;
  driverName?: string;
}

interface CustomBroadcastParams {
  driverId: string;
  driverPhone: string;
  message: string;
  broadcastType?: string;
}

class TwilioVoiceService {
  private client: Twilio.Twilio | null = null;
  private phoneNumber: string | null = null;
  private baseUrl: string;
  private isConfigured: boolean = false;

  constructor(config?: TwilioServiceConfig) {
    const accountSid = config?.accountSid || TWILIO_ACCOUNT_SID;
    const authToken = config?.authToken || TWILIO_AUTH_TOKEN;
    this.phoneNumber = config?.phoneNumber || TWILIO_PHONE_NUMBER || null;

    // Base URL for TwiML endpoints (will be configured via env or webhook)
    this.baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL || 'https://your-domain.com';

    if (accountSid && authToken) {
      this.client = Twilio(accountSid, authToken);
      this.isConfigured = true;
      console.log('[TwilioService] Initialized with account:', accountSid.substring(0, 8) + '...');
    } else {
      console.warn('[TwilioService] Not configured - missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }
  }

  /**
   * Check if the service is properly configured
   */
  isReady(): boolean {
    return this.isConfigured && this.client !== null && this.phoneNumber !== null;
  }

  /**
   * Generate TwiML for a voice message using Google TTS
   */
  generateTwiML(message: string, options?: { voice?: string; language?: string }): string {
    const voice = options?.voice || TTS_VOICE;
    const language = options?.language || 'en-US';

    // Escape special XML characters
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="${voice}" language="${language}">
        ${escapedMessage}
    </Say>
</Response>`;
  }

  /**
   * Generate a weather broadcast message
   */
  generateWeatherMessage(params: WeatherBroadcastParams): string {
    let message = `Hello, this is Milo from Freedom Transportation with a weather update for your trip to ${params.destination}. `;
    message += `Current conditions: ${params.weatherConditions}. `;
    message += `Temperature: ${params.temperature}. `;

    if (params.windSpeed) {
      message += `Wind speed: ${params.windSpeed}. `;
    }

    if (params.visibility) {
      message += `Visibility: ${params.visibility}. `;
    }

    if (params.alerts && params.alerts.length > 0) {
      message += `Weather alerts: ${params.alerts.join('. ')}. `;
      message += `Please drive carefully and stay alert. `;
    }

    message += `Have a safe trip. Goodbye.`;

    return message;
  }

  /**
   * Generate a safety alert message
   */
  generateSafetyAlertMessage(params: SafetyAlertBroadcastParams): string {
    const greeting = params.driverName
      ? `Hi ${params.driverName}, this is Milo from Freedom Transportation`
      : `Hello, this is Milo from Freedom Transportation`;

    const severityIntro = params.severity === 'critical'
      ? ` with an URGENT safety alert.`
      : params.severity === 'high'
      ? ` with an important safety notification.`
      : ` with a safety notification.`;

    let message = greeting + severityIntro + ' ';
    message += params.description + ' ';

    if (params.location) {
      message += `This occurred at ${params.location}. `;
    }

    message += 'Please acknowledge and take appropriate action. ';
    message += 'If you have questions, contact dispatch immediately. ';
    message += 'Stay safe. Goodbye.';

    return message;
  }

  /**
   * Make a voice call with a TwiML message
   */
  async makeCall(
    toPhoneNumber: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<CallResult> {
    if (!this.isReady()) {
      return {
        success: false,
        error: 'Twilio service not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.'
      };
    }

    try {
      // Format phone number (ensure E.164 format)
      const formattedPhone = this.formatPhoneNumber(toPhoneNumber);
      if (!formattedPhone) {
        return {
          success: false,
          error: `Invalid phone number format: ${toPhoneNumber}`
        };
      }

      // Generate TwiML
      const twiml = this.generateTwiML(message);

      // Create the call
      const call = await this.client!.calls.create({
        to: formattedPhone,
        from: this.phoneNumber!,
        twiml: twiml,
        statusCallback: `${this.baseUrl}/api/twilio/status-callback`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      console.log(`[TwilioService] Call initiated: ${call.sid} to ${formattedPhone}`);

      return {
        success: true,
        callSid: call.sid
      };
    } catch (error: any) {
      console.error('[TwilioService] Call failed:', error.message);
      return {
        success: false,
        error: error.message || 'Unknown error making call'
      };
    }
  }

  /**
   * Make a call with direct TwiML (no formatting)
   */
  async makeCallWithTwiML(
    toPhoneNumber: string,
    twiml: string
  ): Promise<CallResult> {
    if (!this.isReady()) {
      return {
        success: false,
        error: 'Twilio service not configured'
      };
    }

    try {
      const formattedPhone = this.formatPhoneNumber(toPhoneNumber);
      if (!formattedPhone) {
        return {
          success: false,
          error: `Invalid phone number format: ${toPhoneNumber}`
        };
      }

      const call = await this.client!.calls.create({
        to: formattedPhone,
        from: this.phoneNumber!,
        twiml: twiml,
      });

      console.log(`[TwilioService] Call initiated: ${call.sid}`);

      return {
        success: true,
        callSid: call.sid
      };
    } catch (error: any) {
      console.error('[TwilioService] Call failed:', error.message);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Format phone number to E.164 format
   */
  private formatPhoneNumber(phone: string): string | null {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Handle US numbers
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    // Already in E.164 with +
    if (phone.startsWith('+') && digits.length >= 10) {
      return `+${digits}`;
    }

    return null;
  }

  /**
   * Send a weather broadcast to a driver
   */
  async sendWeatherBroadcast(
    tenantId: string,
    params: WeatherBroadcastParams
  ): Promise<{ success: boolean; broadcastId?: string; callSid?: string; error?: string }> {
    try {
      const message = this.generateWeatherMessage(params);

      // Create broadcast record
      const [broadcast] = await db.insert(voiceBroadcasts).values({
        tenantId,
        driverId: params.driverId,
        tripId: params.tripId,
        broadcastType: 'weather',
        phoneNumber: params.driverPhone,
        message,
        status: 'pending',
        metadata: {
          destination: params.destination,
          weatherConditions: params.weatherConditions,
          temperature: params.temperature,
          windSpeed: params.windSpeed,
          visibility: params.visibility,
          alerts: params.alerts || []
        }
      }).returning();

      // Make the call
      const result = await this.makeCall(params.driverPhone, message);

      // Update broadcast with result
      await db.update(voiceBroadcasts)
        .set({
          status: result.success ? 'queued' : 'failed',
          twilioCallSid: result.callSid,
          errorMessage: result.error,
          attemptCount: 1,
          lastAttemptAt: new Date()
        })
        .where(eq(voiceBroadcasts.id, broadcast.id));

      return {
        success: result.success,
        broadcastId: broadcast.id,
        callSid: result.callSid,
        error: result.error
      };
    } catch (error: any) {
      console.error('[TwilioService] Weather broadcast failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send a safety alert broadcast to a driver
   */
  async sendSafetyAlertBroadcast(
    tenantId: string,
    params: SafetyAlertBroadcastParams
  ): Promise<{ success: boolean; broadcastId?: string; callSid?: string; error?: string }> {
    try {
      const message = this.generateSafetyAlertMessage(params);

      // Create broadcast record
      const [broadcast] = await db.insert(voiceBroadcasts).values({
        tenantId,
        driverId: params.driverId,
        broadcastType: 'safety_alert',
        phoneNumber: params.driverPhone,
        message,
        status: 'pending',
        metadata: {
          alertType: params.alertType,
          severity: params.severity,
          location: params.location
        }
      }).returning();

      // Make the call
      const result = await this.makeCall(params.driverPhone, message);

      // Update broadcast with result
      await db.update(voiceBroadcasts)
        .set({
          status: result.success ? 'queued' : 'failed',
          twilioCallSid: result.callSid,
          errorMessage: result.error,
          attemptCount: 1,
          lastAttemptAt: new Date()
        })
        .where(eq(voiceBroadcasts.id, broadcast.id));

      return {
        success: result.success,
        broadcastId: broadcast.id,
        callSid: result.callSid,
        error: result.error
      };
    } catch (error: any) {
      console.error('[TwilioService] Safety alert broadcast failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send a custom broadcast to a driver
   */
  async sendCustomBroadcast(
    tenantId: string,
    params: CustomBroadcastParams
  ): Promise<{ success: boolean; broadcastId?: string; callSid?: string; error?: string }> {
    try {
      // Create broadcast record
      const [broadcast] = await db.insert(voiceBroadcasts).values({
        tenantId,
        driverId: params.driverId,
        broadcastType: params.broadcastType || 'custom',
        phoneNumber: params.driverPhone,
        message: params.message,
        status: 'pending',
        metadata: {}
      }).returning();

      // Make the call
      const result = await this.makeCall(params.driverPhone, params.message);

      // Update broadcast with result
      await db.update(voiceBroadcasts)
        .set({
          status: result.success ? 'queued' : 'failed',
          twilioCallSid: result.callSid,
          errorMessage: result.error,
          attemptCount: 1,
          lastAttemptAt: new Date()
        })
        .where(eq(voiceBroadcasts.id, broadcast.id));

      return {
        success: result.success,
        broadcastId: broadcast.id,
        callSid: result.callSid,
        error: result.error
      };
    } catch (error: any) {
      console.error('[TwilioService] Custom broadcast failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle Twilio status callback webhook
   */
  async handleStatusCallback(data: {
    CallSid: string;
    CallStatus: string;
    CallDuration?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
  }): Promise<void> {
    const { CallSid, CallStatus, CallDuration, ErrorCode, ErrorMessage } = data;

    console.log(`[TwilioService] Status callback: ${CallSid} -> ${CallStatus}`);

    // Map Twilio status to our status
    let status: string;
    switch (CallStatus) {
      case 'queued':
      case 'ringing':
        status = 'queued';
        break;
      case 'in-progress':
        status = 'in_progress';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'busy':
      case 'no-answer':
      case 'failed':
      case 'canceled':
        status = 'failed';
        break;
      default:
        status = CallStatus;
    }

    // Update broadcast record
    const updateData: Record<string, unknown> = { status };

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    if (ErrorCode || ErrorMessage) {
      updateData.errorMessage = `${ErrorCode}: ${ErrorMessage}`;
    }

    await db.update(voiceBroadcasts)
      .set(updateData as any)
      .where(eq(voiceBroadcasts.twilioCallSid, CallSid));
  }

  /**
   * Retry a failed broadcast
   */
  async retryBroadcast(broadcastId: string): Promise<{ success: boolean; error?: string }> {
    const [broadcast] = await db.select()
      .from(voiceBroadcasts)
      .where(eq(voiceBroadcasts.id, broadcastId))
      .limit(1);

    if (!broadcast) {
      return { success: false, error: 'Broadcast not found' };
    }

    if (broadcast.status === 'completed') {
      return { success: false, error: 'Broadcast already completed' };
    }

    if (broadcast.attemptCount >= 3) {
      return { success: false, error: 'Maximum retry attempts reached' };
    }

    // Make the call again
    const result = await this.makeCall(broadcast.phoneNumber, broadcast.message);

    // Update broadcast with result
    await db.update(voiceBroadcasts)
      .set({
        status: result.success ? 'queued' : 'failed',
        twilioCallSid: result.callSid,
        errorMessage: result.error,
        attemptCount: broadcast.attemptCount + 1,
        lastAttemptAt: new Date()
      })
      .where(eq(voiceBroadcasts.id, broadcastId));

    return { success: result.success, error: result.error };
  }

  /**
   * Get broadcast history for a driver
   */
  async getDriverBroadcasts(tenantId: string, driverId: string) {
    return db.select()
      .from(voiceBroadcasts)
      .where(and(
        eq(voiceBroadcasts.tenantId, tenantId),
        eq(voiceBroadcasts.driverId, driverId)
      ))
      .orderBy(voiceBroadcasts.createdAt);
  }

  /**
   * Get call status from Twilio
   */
  async getCallStatus(callSid: string): Promise<{ status: string; duration?: number; error?: string }> {
    if (!this.client) {
      return { status: 'unknown', error: 'Twilio not configured' };
    }

    try {
      const call = await this.client.calls(callSid).fetch();
      return {
        status: call.status,
        duration: call.duration ? parseInt(call.duration) : undefined
      };
    } catch (error: any) {
      return { status: 'unknown', error: error.message };
    }
  }
}

// Export singleton instance
export const twilioService = new TwilioVoiceService();

// Export class for testing
export { TwilioVoiceService };
