import { describe, it, expect } from 'vitest';
import { blockToAssignmentSubject, shiftOccurrenceToAssignmentSubject } from '../rolling6-calculator.js';
import type { Block, ShiftOccurrence, ShiftTemplate } from '../../shared/schema.js';

describe('AssignmentSubject Adapters', () => {
  describe('blockToAssignmentSubject', () => {
    it('should convert a block to AssignmentSubject with normalized duration', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T08:00:00Z'),
        endTimestamp: new Date('2025-11-10T18:30:00Z'),
        duration: 10.5,
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);

      expect(result).toEqual({
        startTimestamp: new Date('2025-11-10T08:00:00Z'),
        endTimestamp: new Date('2025-11-10T18:30:00Z'),
        duration: 10.5,
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      });
    });

    it('should normalize floating-point duration to 4 decimals', () => {
      const block = {
        startTimestamp: new Date('2025-11-11T00:00:00Z'),
        endTimestamp: new Date('2025-11-11T13:30:00Z'),
        duration: 13.499999999999998, // Floating-point residue
        soloType: 'd2',
        cycleId: 'wedSat:2025-11-11',
        patternGroup: 'wedSat',
      } as Block;

      const result = blockToAssignmentSubject(block);

      expect(result.duration).toBe(13.5); // Should round to 13.5, not 13.499999
    });

    it('should preserve all required metadata fields', () => {
      const block = {
        startTimestamp: new Date('2025-11-12T10:00:00Z'),
        endTimestamp: new Date('2025-11-12T22:00:00Z'),
        duration: 12.0,
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-12',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);

      expect(result.soloType).toBe('d1');
      expect(result.cycleId).toBe('sunWed:2025-11-12');
      expect(result.patternGroup).toBe('sunWed');
    });

    it('should handle very short durations without precision loss', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T08:00:00Z'),
        endTimestamp: new Date('2025-11-10T08:15:00Z'),
        duration: 0.25, // 15 minutes
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);
      expect(result.duration).toBe(0.25);
    });

    it('should handle very long durations (14+ hours)', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T00:00:00Z'),
        endTimestamp: new Date('2025-11-10T15:30:00Z'),
        duration: 15.5, // Should trigger warning in validation
        soloType: 'd2',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);
      expect(result.duration).toBe(15.5);
    });
  });

  describe('shiftOccurrenceToAssignmentSubject', () => {
    it('should convert shift occurrence + template to AssignmentSubject', () => {
      const template = {
        soloType: 'd2',
        operatorId: 'FTIM_MKC_Solo1_Tractor_2_d2',
      } as ShiftTemplate;

      const occurrence = {
        scheduledStart: new Date('2025-11-07T21:46:00Z'),
        scheduledEnd: new Date('2025-11-08T02:28:00Z'),
        patternGroup: 'sunWed',
        cycleId: 'sunWed:2025-11-09',
      } as ShiftOccurrence;

      const result = shiftOccurrenceToAssignmentSubject(occurrence, template);

      expect(result.startTimestamp).toEqual(new Date('2025-11-07T21:46:00Z'));
      expect(result.endTimestamp).toEqual(new Date('2025-11-08T02:28:00Z'));
      expect(result.soloType).toBe('d2');
      expect(result.cycleId).toBe('sunWed:2025-11-09');
      expect(result.patternGroup).toBe('sunWed');
    });

    it('should calculate duration in hours with 4-decimal precision', () => {
      const template = {
        soloType: 'd1',
        operatorId: 'FTIM_MKC_Solo2_Tractor_2_d1',
      } as ShiftTemplate;

      const occurrence = {
        scheduledStart: new Date('2025-11-08T00:06:00Z'),
        scheduledEnd: new Date('2025-11-08T00:44:00Z'),
        patternGroup: 'wedSat',
        cycleId: 'wedSat:2025-11-07',
      } as ShiftOccurrence;

      const result = shiftOccurrenceToAssignmentSubject(occurrence, template);

      // 38 minutes = 0.6333 hours
      expect(result.duration).toBeCloseTo(0.6333, 4);
    });

    it('should handle overnight shifts correctly', () => {
      const template = {
        soloType: 'd1',
        operatorId: 'OVERNIGHT_SHIFT',
      } as ShiftTemplate;

      const occurrence = {
        scheduledStart: new Date('2025-11-10T22:00:00Z'),
        scheduledEnd: new Date('2025-11-11T06:00:00Z'),
        patternGroup: 'sunWed',
        cycleId: 'sunWed:2025-11-10',
      } as ShiftOccurrence;

      const result = shiftOccurrenceToAssignmentSubject(occurrence, template);

      expect(result.duration).toBe(8.0);
      expect(result.startTimestamp.getTime()).toBeLessThan(result.endTimestamp.getTime());
    });

    it('should normalize floating-point duration residue from millisecond calculations', () => {
      const template = {
        soloType: 'd2',
        operatorId: 'FLOAT_TEST',
      } as ShiftTemplate;

      const occurrence = {
        scheduledStart: new Date('2025-11-15T01:30:00Z'),
        scheduledEnd: new Date('2025-11-15T15:30:00Z'),
        patternGroup: 'wedSat',
        cycleId: 'wedSat:2025-11-15',
      } as ShiftOccurrence;

      const result = shiftOccurrenceToAssignmentSubject(occurrence, template);

      // 14 hours exactly, no floating-point residue
      expect(result.duration).toBe(14.0);
    });

    it('should handle null/undefined pattern fields gracefully', () => {
      const template = {
        soloType: 'd1',
        operatorId: 'NO_PATTERN',
        patternGroup: null,
      } as ShiftTemplate;

      const occurrence = {
        scheduledStart: new Date('2025-11-10T08:00:00Z'),
        scheduledEnd: new Date('2025-11-10T16:00:00Z'),
        patternGroup: null,
        cycleId: null,
      } as ShiftOccurrence;

      const result = shiftOccurrenceToAssignmentSubject(occurrence, template);

      expect(result.duration).toBe(8.0);
      // Adapter converts null to empty string for cycleId
      expect(result.cycleId).toBe("");
    });
  });

  describe('Duration Precision Edge Cases', () => {
    it('should handle 13.5 hours without rounding to 14', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T00:00:00Z'),
        endTimestamp: new Date('2025-11-10T13:30:00Z'),
        duration: 13.5,
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);
      expect(result.duration).toBe(13.5); // Must not round to 14
    });

    it('should normalize 13.499999999 to 13.5', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T00:00:00Z'),
        endTimestamp: new Date('2025-11-10T13:30:00Z'),
        duration: 13.499999999999998,
        soloType: 'd1',
        cycleId: 'sunWed:2025-11-10',
        patternGroup: 'sunWed',
      } as Block;

      const result = blockToAssignmentSubject(block);
      expect(result.duration).toBe(13.5); // toFixed(4) should round to 13.5
    });

    it('should preserve exact durations like 14.0', () => {
      const block = {
        startTimestamp: new Date('2025-11-10T00:00:00Z'),
        endTimestamp: new Date('2025-11-10T14:00:00Z'),
        duration: 14.0,
        soloType: 'd2',
        cycleId: 'wedSat:2025-11-10',
        patternGroup: 'wedSat',
      } as Block;

      const result = blockToAssignmentSubject(block);
      expect(result.duration).toBe(14.0);
    });
  });
});
