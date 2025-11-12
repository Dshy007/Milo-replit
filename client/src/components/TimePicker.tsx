import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

type TimeMode = "AM" | "PM" | "24h";

export function TimePicker({ value, onChange, placeholder = "Select time", className, testId }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TimeMode>("24h");
  const [hour, setHour] = useState<number>(0);
  const [minute, setMinute] = useState<number>(0);

  useEffect(() => {
    if (value && value.includes(":")) {
      const [h, m] = value.split(":").map(Number);
      setHour(h);
      setMinute(m);
      
      if (h === 0) {
        setMode("AM");
      } else if (h < 12) {
        setMode("AM");
      } else if (h === 12) {
        setMode("PM");
      } else {
        setMode("PM");
      }
    }
  }, [value]);

  const formatTime = (h: number, m: number, currentMode: TimeMode): string => {
    const paddedMinute = m.toString().padStart(2, "0");
    
    if (currentMode === "24h") {
      return `${h.toString().padStart(2, "0")}:${paddedMinute}`;
    } else {
      const display12h = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${display12h}:${paddedMinute} ${currentMode}`;
    }
  };

  const convertTo24h = (h: number, m: number, currentMode: TimeMode): string => {
    let hour24 = h;
    
    if (currentMode === "AM") {
      if (h === 12) hour24 = 0;
    } else if (currentMode === "PM") {
      if (h !== 12) hour24 = h + 12;
    }
    
    return `${hour24.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  };

  const handleHourClick = (clickedHour: number) => {
    setHour(clickedHour);
    const time24h = convertTo24h(clickedHour, minute, mode);
    onChange(time24h);
  };

  const handleMinuteClick = (clickedMinute: number) => {
    setMinute(clickedMinute);
    const time24h = convertTo24h(hour, clickedMinute, mode);
    onChange(time24h);
  };

  const handleModeChange = (newMode: TimeMode) => {
    setMode(newMode);
    let newHour = hour;
    
    if (newMode === "24h") {
      if (mode === "AM") {
        if (hour === 12) newHour = 0;
      } else if (mode === "PM") {
        if (hour !== 12) newHour = hour + 12;
      }
    } else if (newMode === "AM" || newMode === "PM") {
      if (mode === "24h") {
        if (hour === 0) {
          newHour = 12;
        } else if (hour > 12) {
          newHour = hour - 12;
        }
      } else {
        if (hour === 12 && newMode === "AM" && mode === "PM") {
          newHour = 12;
        } else if (hour === 12 && newMode === "PM" && mode === "AM") {
          newHour = 12;
        }
      }
    }
    
    setHour(newHour);
    const time24h = convertTo24h(newHour, minute, newMode);
    onChange(time24h);
  };

  const displayValue = value ? formatTime(hour, minute, mode) : "";
  
  const getHours = () => {
    if (mode === "24h") {
      return Array.from({ length: 24 }, (_, i) => i);
    }
    return Array.from({ length: 12 }, (_, i) => i + 1);
  };

  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-start text-left font-normal", className)}
          data-testid={testId}
        >
          <Clock className="mr-2 h-4 w-4" />
          {displayValue || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          <div className="flex gap-2 justify-center">
            <Button
              size="sm"
              variant={mode === "AM" ? "default" : "outline"}
              onClick={() => handleModeChange("AM")}
              className="flex-1"
              data-testid="button-mode-am"
            >
              AM
            </Button>
            <Button
              size="sm"
              variant={mode === "PM" ? "default" : "outline"}
              onClick={() => handleModeChange("PM")}
              className="flex-1"
              data-testid="button-mode-pm"
            >
              PM
            </Button>
            <Button
              size="sm"
              variant={mode === "24h" ? "default" : "outline"}
              onClick={() => handleModeChange("24h")}
              className="flex-1"
              data-testid="button-mode-24h"
            >
              24h
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium mb-2 text-center">Hour</div>
              <div className="grid grid-cols-6 gap-2">
                {getHours().map((h) => (
                  <Button
                    key={h}
                    size="sm"
                    variant={hour === h ? "default" : "outline"}
                    onClick={() => handleHourClick(h)}
                    className="h-8"
                    data-testid={`button-hour-${h}`}
                  >
                    {mode === "24h" ? h.toString().padStart(2, "0") : h === 0 ? 12 : h}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2 text-center">Minute</div>
              <div className="grid grid-cols-6 gap-2">
                {minutes.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={minute === m ? "default" : "outline"}
                    onClick={() => handleMinuteClick(m)}
                    className="h-8"
                    data-testid={`button-minute-${m}`}
                  >
                    {m.toString().padStart(2, "0")}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center pt-2 border-t">
            <div className="text-sm text-muted-foreground">Selected Time</div>
            <div className="text-lg font-semibold" data-testid="text-selected-time">
              {displayValue || "-- : --"}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
