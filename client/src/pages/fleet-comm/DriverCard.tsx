/**
 * Driver Card - Individual driver display with action buttons
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, PhoneCall, CalendarClock, Mic } from "lucide-react";
import type { DriverWithStatus } from "./types";

interface DriverCardProps {
  driver: DriverWithStatus;
  isOnCall: boolean;
  onCall: (driver: DriverWithStatus) => void;
  onSchedule: (driver: DriverWithStatus) => void;
  onDropIn: (driver: DriverWithStatus) => void;
}

export function DriverCard({
  driver,
  isOnCall,
  onCall,
  onSchedule,
  onDropIn,
}: DriverCardProps) {
  return (
    <Card
      className={`relative overflow-hidden transition-all hover:shadow-md ${
        driver.isOnline ? "border-green-200 bg-green-50/30" : ""
      }`}
    >
      {/* Online indicator */}
      {driver.isOnline && (
        <div className="absolute top-2 right-2">
          <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        </div>
      )}

      <CardContent className="p-4">
        {/* Driver Name */}
        <div className="mb-3">
          <h3 className="font-semibold text-lg leading-tight">
            {driver.firstName}
          </h3>
          <p className="text-muted-foreground text-sm">
            {driver.lastName}
          </p>
        </div>

        {/* Domicile */}
        {driver.domicile && (
          <p className="text-xs text-muted-foreground mb-3">
            {driver.domicile}
          </p>
        )}

        {/* Phone Number */}
        <p className="text-xs font-mono text-muted-foreground mb-4 truncate">
          {driver.phoneNumber || "No phone"}
        </p>

        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Primary Call Button */}
          <Button
            className="w-full h-12 text-base"
            onClick={() => onCall(driver)}
            disabled={!driver.phoneNumber || isOnCall}
          >
            {isOnCall ? (
              <>
                <PhoneCall className="h-5 w-5 mr-2 animate-pulse" />
                On Call
              </>
            ) : (
              <>
                <Phone className="h-5 w-5 mr-2" />
                Call
              </>
            )}
          </Button>

          {/* Schedule Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onSchedule(driver)}
            disabled={!driver.phoneNumber}
          >
            <CalendarClock className="h-4 w-4 mr-2" />
            Schedule
          </Button>

          {/* Drop-In Button (only for online drivers) */}
          {driver.isOnline && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onDropIn(driver)}
            >
              <Mic className="h-4 w-4 mr-2" />
              Drop-In
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
