/**
 * Scheduled Calls Processor
 *
 * Background service that checks for scheduled calls and executes them when due.
 * Runs every minute to check for pending calls that should be made.
 */

import { db } from './db';
import { voiceBroadcasts } from '@shared/schema';
import { eq, and, lte } from 'drizzle-orm';
import { twilioService } from './twilio-service';

const CHECK_INTERVAL = 60 * 1000; // Check every minute

let isProcessing = false;

/**
 * Process pending scheduled calls
 */
async function processScheduledCalls() {
  if (isProcessing) {
    console.log('[ScheduledCalls] Already processing, skipping...');
    return;
  }

  isProcessing = true;

  try {
    const now = new Date();

    // Find all pending scheduled calls that are due
    const dueCalls = await db.select()
      .from(voiceBroadcasts)
      .where(
        and(
          eq(voiceBroadcasts.broadcastType, 'scheduled_call'),
          eq(voiceBroadcasts.status, 'pending'),
          lte(voiceBroadcasts.scheduledFor, now)
        )
      );

    if (dueCalls.length === 0) {
      isProcessing = false;
      return;
    }

    console.log(`[ScheduledCalls] Processing ${dueCalls.length} scheduled calls...`);

    for (const call of dueCalls) {
      try {
        // Mark as in progress
        await db.update(voiceBroadcasts)
          .set({
            status: 'in_progress',
            lastAttemptAt: new Date(),
            attemptCount: call.attemptCount + 1
          })
          .where(eq(voiceBroadcasts.id, call.id));

        // Check if Twilio is configured
        if (!twilioService.isReady()) {
          console.error('[ScheduledCalls] Twilio not configured, marking as failed');
          await db.update(voiceBroadcasts)
            .set({
              status: 'failed',
              errorMessage: 'Twilio service not configured'
            })
            .where(eq(voiceBroadcasts.id, call.id));
          continue;
        }

        // Make the call
        const driverName = (call.metadata as any)?.driverName || 'Unknown Driver';
        console.log(`[ScheduledCalls] Calling ${driverName} at ${call.phoneNumber}...`);

        const result = await twilioService.makeCall(call.phoneNumber, call.message);

        if (result.success) {
          await db.update(voiceBroadcasts)
            .set({
              status: 'queued',
              twilioCallSid: result.callSid
            })
            .where(eq(voiceBroadcasts.id, call.id));
          console.log(`[ScheduledCalls] Call initiated: ${result.callSid}`);
        } else {
          await db.update(voiceBroadcasts)
            .set({
              status: 'failed',
              errorMessage: result.error
            })
            .where(eq(voiceBroadcasts.id, call.id));
          console.error(`[ScheduledCalls] Call failed: ${result.error}`);
        }

      } catch (error: any) {
        console.error(`[ScheduledCalls] Error processing call ${call.id}:`, error);
        await db.update(voiceBroadcasts)
          .set({
            status: 'failed',
            errorMessage: error.message
          })
          .where(eq(voiceBroadcasts.id, call.id));
      }
    }

  } catch (error) {
    console.error('[ScheduledCalls] Processor error:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the scheduled calls processor
 */
export function startScheduledCallsProcessor() {
  console.log('[ScheduledCalls] Starting processor (checking every minute)...');

  // Run immediately once
  processScheduledCalls();

  // Then run every minute
  setInterval(processScheduledCalls, CHECK_INTERVAL);
}
