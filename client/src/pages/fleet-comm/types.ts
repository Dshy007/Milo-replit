/**
 * Fleet Communication Types
 */

export interface DriverWithStatus {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  email: string | null;
  domicile: string | null;
  isOnline: boolean;
  lastSeen: string | null;
}

export interface ActiveCall {
  driverId: string;
  driverName: string;
  phoneNumber: string;
  callSid: string | null;
  status: "dialing" | "ringing" | "in-progress" | "completed" | "failed";
  startedAt: Date;
}

export interface WSMessage {
  type: string;
  payload?: any;
}

export interface ActiveDropIn {
  driverId: string;
  driverName: string;
  roomName: string;
  startedAt: Date;
}

export interface ScheduledCall {
  id: string;
  driverId: string;
  driverName: string;
  phoneNumber: string;
  scheduledFor: string;
  message: string;
  status: "pending" | "completed" | "failed" | "cancelled";
}

export interface GeneratedScript {
  driverId: string;
  driverName: string;
  phoneNumber: string;
  script: string;
  approved: boolean;
  editing: boolean;
  scheduledDate: string;
  scheduledTime: string;
  variationNumber?: number;
}

// API Response types
export interface DriversResponse {
  success: boolean;
  drivers: DriverWithStatus[];
  onlineCount: number;
  totalCount: number;
}

export interface ScheduledCallsResponse {
  success: boolean;
  scheduledCalls: ScheduledCall[];
}
