import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImportResult {
  success: boolean;
  message: string;
  created?: number;
  assigned?: number;
  unassigned?: number;
  failed?: number;
  errors?: string[];
  warnings?: string[];
}

interface ImportOverlayProps {
  isImporting: boolean;
  importResult: ImportResult | null;
  onClose: () => void;
}

// Semi truck and trailer animation - Freedom Transportation
function AnimatedTruck() {
  return (
    <div className="relative w-full max-w-xl h-48 overflow-hidden rounded-xl bg-gradient-to-b from-sky-400 via-sky-300 to-sky-200">
      {/* Sun */}
      <div className="absolute top-3 right-10 w-10 h-10 bg-yellow-300 rounded-full shadow-lg shadow-yellow-300/50" />

      {/* Clouds - scrolling slowly */}
      <div className="absolute top-4 animate-clouds-scroll" style={{ width: '200%' }}>
        <div className="flex">
          <div className="w-1/2 flex gap-24">
            <div className="w-20 h-6 bg-white/80 rounded-full blur-[2px]" />
            <div className="w-14 h-5 bg-white/60 rounded-full blur-[2px] mt-2" />
            <div className="w-24 h-7 bg-white/70 rounded-full blur-[2px]" />
          </div>
          <div className="w-1/2 flex gap-24">
            <div className="w-20 h-6 bg-white/80 rounded-full blur-[2px]" />
            <div className="w-14 h-5 bg-white/60 rounded-full blur-[2px] mt-2" />
            <div className="w-24 h-7 bg-white/70 rounded-full blur-[2px]" />
          </div>
        </div>
      </div>

      {/* Distant hills */}
      <div className="absolute bottom-16 left-0 right-0">
        <svg viewBox="0 0 400 30" className="w-full h-8">
          <path d="M0 30 Q50 15 100 25 Q150 10 200 20 Q250 5 300 18 Q350 8 400 22 L400 30 Z" className="fill-green-700/30" />
        </svg>
      </div>

      {/* Road */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gray-600">
        {/* Road shoulder */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gray-500" />
        {/* Road edge lines */}
        <div className="absolute top-2 left-0 right-0 h-1 bg-white/70" />
        <div className="absolute bottom-1 left-0 right-0 h-0.5 bg-white/40" />

        {/* Center line dashes - animated slowly */}
        <div className="absolute top-1/2 -translate-y-1/2 left-0 overflow-hidden w-full h-1">
          <div className="animate-road-scroll flex" style={{ width: '200%' }}>
            {[...Array(30)].map((_, i) => (
              <div key={i} className="w-12 h-1 bg-yellow-400 mx-8 flex-shrink-0" />
            ))}
          </div>
        </div>
      </div>

      {/* Semi Truck - swaying side to side as it drives */}
      <div className="absolute bottom-12 left-1/2 animate-truck-sway">
        <svg width="180" height="80" viewBox="0 0 180 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Shadow */}
          <ellipse cx="95" cy="77" rx="85" ry="4" className="fill-black/25" />

          {/* === TRAILER === */}
          {/* Trailer body - white with silver trim */}
          <rect x="2" y="15" width="100" height="42" rx="2" className="fill-slate-50" stroke="#94A3B8" strokeWidth="1" />

          {/* Trailer roof highlight */}
          <rect x="2" y="15" width="100" height="3" rx="1" className="fill-slate-200" />

          {/* Trailer ribbing (vertical lines) */}
          {[12, 25, 38, 51, 64, 77, 90].map((x, i) => (
            <line key={i} x1={x} y1="18" x2={x} y2="55" className="stroke-slate-300" strokeWidth="1" />
          ))}

          {/* Company branding - Freedom Transportation */}
          <rect x="10" y="24" width="85" height="24" rx="2" className="fill-red-700" />
          {/* Blue accent stripe */}
          <rect x="10" y="42" width="85" height="4" rx="1" className="fill-blue-800" />
          {/* Company name */}
          <text x="52" y="35" textAnchor="middle" className="fill-white" fontSize="8" fontWeight="bold">FREEDOM</text>
          <text x="52" y="41" textAnchor="middle" className="fill-red-200" fontSize="4">TRANSPORTATION, INC.</text>

          {/* Trailer rear lights */}
          <rect x="0" y="28" width="3" height="7" rx="1" className="fill-red-600" />
          <rect x="0" y="37" width="3" height="5" rx="1" className="fill-amber-500" />
          <rect x="0" y="44" width="3" height="4" rx="1" className="fill-white" stroke="#CBD5E1" strokeWidth="0.5" />

          {/* Trailer undercarriage */}
          <rect x="5" y="57" width="95" height="4" rx="1" className="fill-gray-800" />

          {/* Trailer wheels (tandem axle) - Rear axle (at very back of trailer) */}
          <g>
            {/* Outer tire */}
            <circle cx="18" cy="66" r="9" className="fill-gray-900" />
            {/* Tire tread */}
            <circle cx="18" cy="66" r="8" className="fill-gray-800" />
            {/* Inner tire wall */}
            <circle cx="18" cy="66" r="6" className="fill-gray-700" />
            {/* Hub */}
            <circle cx="18" cy="66" r="3.5" className="fill-gray-400" />
            {/* Center cap */}
            <circle cx="18" cy="66" r="2" className="fill-gray-500" />
            {/* Lug nuts */}
            <circle cx="18" cy="63" r="0.6" className="fill-gray-600" />
            <circle cx="20.5" cy="65" r="0.6" className="fill-gray-600" />
            <circle cx="20.5" cy="67" r="0.6" className="fill-gray-600" />
            <circle cx="18" cy="69" r="0.6" className="fill-gray-600" />
            <circle cx="15.5" cy="67" r="0.6" className="fill-gray-600" />
            <circle cx="15.5" cy="65" r="0.6" className="fill-gray-600" />
          </g>

          {/* Trailer wheels - Second tandem axle */}
          <g>
            <circle cx="35" cy="66" r="9" className="fill-gray-900" />
            <circle cx="35" cy="66" r="8" className="fill-gray-800" />
            <circle cx="35" cy="66" r="6" className="fill-gray-700" />
            <circle cx="35" cy="66" r="3.5" className="fill-gray-400" />
            <circle cx="35" cy="66" r="2" className="fill-gray-500" />
            <circle cx="35" cy="63" r="0.6" className="fill-gray-600" />
            <circle cx="37.5" cy="65" r="0.6" className="fill-gray-600" />
            <circle cx="37.5" cy="67" r="0.6" className="fill-gray-600" />
            <circle cx="35" cy="69" r="0.6" className="fill-gray-600" />
            <circle cx="32.5" cy="67" r="0.6" className="fill-gray-600" />
            <circle cx="32.5" cy="65" r="0.6" className="fill-gray-600" />
          </g>

          {/* Mud flaps */}
          <rect x="8" y="64" width="6" height="10" rx="1" className="fill-gray-900" />
          <rect x="43" y="64" width="6" height="10" rx="1" className="fill-gray-900" />

          {/* === TRACTOR (SINGLE CAB - Day Cab, Short Hood) === */}
          {/* Main cab body - blue */}
          <path d="M102 22 L102 57 L135 57 L135 38 L125 22 Z" className="fill-blue-600" />

          {/* Cab roof fairing */}
          <path d="M102 22 L102 15 L125 15 L125 22 Z" className="fill-blue-700" />

          {/* Windshield */}
          <path d="M106 24 L106 40 L128 40 L128 35 L120 24 Z" className="fill-sky-200" />
          {/* Windshield glare */}
          <path d="M108 26 L108 34 L116 34 L116 29 L113 26 Z" className="fill-white/40" />

          {/* Door */}
          <rect x="106" y="42" width="22" height="13" rx="1" className="fill-blue-700" />
          <circle cx="124" cy="50" r="2" className="fill-gray-400" />

          {/* Door window */}
          <rect x="108" y="44" width="18" height="7" rx="1" className="fill-sky-200" />

          {/* Hood (engine compartment) - shorter nose */}
          <rect x="135" y="40" width="18" height="17" rx="2" className="fill-blue-600" />

          {/* Hood details - vents */}
          <rect x="137" y="44" width="13" height="2" rx="0.5" className="fill-blue-800" />
          <rect x="137" y="48" width="13" height="2" rx="0.5" className="fill-blue-800" />

          {/* Grille */}
          <rect x="151" y="42" width="5" height="12" rx="1" className="fill-gray-300" />
          {[44, 48, 52].map((y, i) => (
            <rect key={i} x="152" y={y} width="3" height="2" rx="0.5" className="fill-gray-500" />
          ))}

          {/* Headlights */}
          <circle cx="154" cy="46" r="2.5" className="fill-yellow-200">
            <animate attributeName="opacity" values="0.8;1;0.8" dur="1.5s" repeatCount="indefinite"/>
          </circle>
          <rect x="152" y="50" width="3" height="2" rx="0.5" className="fill-amber-400" />

          {/* Front bumper - chrome */}
          <rect x="151" y="55" width="7" height="4" rx="1" className="fill-gray-400" />

          {/* Exhaust stack - single */}
          <rect x="130" y="8" width="4" height="14" rx="1" className="fill-gray-400" />
          <ellipse cx="132" cy="8" rx="2.5" ry="1.5" className="fill-gray-500" />
          {/* Exhaust smoke puffs */}
          <g className="animate-exhaust-1">
            <circle cx="132" cy="4" r="2.5" className="fill-gray-400/50" />
          </g>
          <g className="animate-exhaust-2">
            <circle cx="131" cy="0" r="2" className="fill-gray-400/30" />
          </g>
          <g className="animate-exhaust-3">
            <circle cx="133" cy="-3" r="1.5" className="fill-gray-400/20" />
          </g>

          {/* Mirrors */}
          <rect x="103" y="28" width="3" height="10" rx="0.5" className="fill-gray-800" />
          <rect x="103.5" y="29" width="2" height="8" className="fill-sky-200" />

          {/* Fuel tank */}
          <ellipse cx="118" cy="56" rx="6" ry="3" className="fill-gray-600" />
          <ellipse cx="118" cy="55" rx="4" ry="2" className="fill-gray-500" />

          {/* Steps */}
          <rect x="128" y="52" width="8" height="3" rx="0.5" className="fill-gray-500" />
          <rect x="129" y="56" width="6" height="3" rx="0.5" className="fill-gray-600" />

          {/* Fifth wheel coupling */}
          <rect x="105" y="55" width="10" height="4" rx="1" className="fill-gray-800" />

          {/* Drive wheel (rear axle) - under fifth wheel coupling */}
          <g>
            {/* Outer tire */}
            <circle cx="108" cy="66" r="9" className="fill-gray-900" />
            {/* Tire tread */}
            <circle cx="108" cy="66" r="8" className="fill-gray-800" />
            {/* Inner tire wall */}
            <circle cx="108" cy="66" r="6" className="fill-gray-700" />
            {/* Hub - chrome */}
            <circle cx="108" cy="66" r="3.5" className="fill-gray-300" />
            {/* Center cap */}
            <circle cx="108" cy="66" r="2" className="fill-gray-400" />
            {/* Lug nuts */}
            <circle cx="108" cy="63" r="0.6" className="fill-gray-500" />
            <circle cx="110.5" cy="65" r="0.6" className="fill-gray-500" />
            <circle cx="110.5" cy="67" r="0.6" className="fill-gray-500" />
            <circle cx="108" cy="69" r="0.6" className="fill-gray-500" />
            <circle cx="105.5" cy="67" r="0.6" className="fill-gray-500" />
            <circle cx="105.5" cy="65" r="0.6" className="fill-gray-500" />
          </g>

          {/* Steer wheel (front) - same size as other wheels */}
          <g>
            <circle cx="148" cy="66" r="9" className="fill-gray-900" />
            <circle cx="148" cy="66" r="8" className="fill-gray-800" />
            <circle cx="148" cy="66" r="6" className="fill-gray-700" />
            {/* Chrome hub */}
            <circle cx="148" cy="66" r="3.5" className="fill-gray-300" />
            <circle cx="148" cy="66" r="2" className="fill-gray-400" />
            {/* Lug nuts */}
            <circle cx="148" cy="63" r="0.6" className="fill-gray-500" />
            <circle cx="150.5" cy="65" r="0.6" className="fill-gray-500" />
            <circle cx="150.5" cy="67" r="0.6" className="fill-gray-500" />
            <circle cx="148" cy="69" r="0.6" className="fill-gray-500" />
            <circle cx="145.5" cy="67" r="0.6" className="fill-gray-500" />
            <circle cx="145.5" cy="65" r="0.6" className="fill-gray-500" />
          </g>
        </svg>
      </div>
    </div>
  );
}

export function ImportOverlay({ isImporting, importResult, onClose }: ImportOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [pendingResult, setPendingResult] = useState<ImportResult | null>(null);

  // When import starts, show loading for minimum 2.5 seconds
  useEffect(() => {
    if (isImporting) {
      setIsVisible(true);
      setShowLoading(true);
      setMinTimeElapsed(false);
      setPendingResult(null);

      // Minimum display time for truck animation
      const timer = setTimeout(() => {
        setMinTimeElapsed(true);
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [isImporting]);

  // When result comes in, wait for minimum time before showing
  useEffect(() => {
    if (importResult && !isImporting) {
      setPendingResult(importResult);
    }
  }, [importResult, isImporting]);

  // Show result only after minimum time elapsed
  useEffect(() => {
    if (pendingResult && minTimeElapsed) {
      setShowLoading(false);
    }
  }, [pendingResult, minTimeElapsed]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for fade out
  };

  if (!isVisible) return null;

  // Use pendingResult for display once loading is done
  const displayResult = showLoading ? null : pendingResult;
  const isSuccess = displayResult?.success && (!displayResult.failed || displayResult.failed === 0);
  const isPartial = displayResult?.success && displayResult.failed && displayResult.failed > 0;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl p-8 max-w-lg w-full mx-4 transform transition-all duration-300">
        {showLoading ? (
          /* Loading State */
          <div className="flex flex-col items-center gap-6">
            <AnimatedTruck />

            <div className="text-center">
              <h2 className="text-xl font-bold text-foreground mb-2">
                Importing Schedule...
              </h2>
              <p className="text-muted-foreground text-sm">
                Processing Excel file and assigning drivers
              </p>
            </div>

            {/* Progress dots */}
            <div className="flex gap-2">
              <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : displayResult ? (
          /* Result State */
          <div className="flex flex-col items-center gap-6">
            {/* Status Icon */}
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
              isSuccess ? "bg-green-500/20" : isPartial ? "bg-amber-500/20" : "bg-red-500/20"
            }`}>
              {isSuccess ? (
                <CheckCircle className="w-12 h-12 text-green-500" />
              ) : isPartial ? (
                <AlertTriangle className="w-12 h-12 text-amber-500" />
              ) : (
                <XCircle className="w-12 h-12 text-red-500" />
              )}
            </div>

            {/* Title */}
            <div className="text-center">
              <h2 className={`text-2xl font-bold mb-2 ${
                isSuccess ? "text-green-500" : isPartial ? "text-amber-500" : "text-red-500"
              }`}>
                {isSuccess ? "Import Successful!" : isPartial ? "Partial Import" : "Import Failed"}
              </h2>
              <p className="text-muted-foreground">
                {displayResult.message}
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 w-full">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-foreground">
                  {displayResult.created || 0}
                </div>
                <div className="text-xs text-muted-foreground">Shifts Created</div>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <div className="text-2xl font-bold text-green-500">
                  {displayResult.assigned || 0}
                </div>
                <div className="text-xs text-muted-foreground">Assigned</div>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <div className="text-2xl font-bold text-red-500">
                  {displayResult.failed || 0}
                </div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>

            {/* Errors */}
            {displayResult.errors && displayResult.errors.length > 0 && (
              <div className="w-full max-h-32 overflow-y-auto bg-red-500/10 rounded-lg p-3">
                <div className="text-sm font-medium text-red-500 mb-2">Errors:</div>
                <ul className="text-xs text-red-400 space-y-1">
                  {displayResult.errors.slice(0, 5).map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                  {displayResult.errors.length > 5 && (
                    <li className="text-red-300">...and {displayResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {displayResult.warnings && displayResult.warnings.length > 0 && !displayResult.errors?.length && (
              <div className="w-full max-h-32 overflow-y-auto bg-amber-500/10 rounded-lg p-3">
                <div className="text-sm font-medium text-amber-500 mb-2">Warnings:</div>
                <ul className="text-xs text-amber-400 space-y-1">
                  {displayResult.warnings.slice(0, 3).map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                  {displayResult.warnings.length > 3 && (
                    <li className="text-amber-300">...and {displayResult.warnings.length - 3} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Close Button */}
            <Button onClick={handleClose} className="w-full">
              Continue
            </Button>
          </div>
        ) : null}
      </div>

      {/* Custom styles for animations */}
      <style>{`
        @keyframes road-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        @keyframes clouds-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        @keyframes truck-sway {
          0% { transform: translateX(-50%) translateY(0) rotate(0deg); }
          20% { transform: translateX(-50%) translateY(-1px) rotate(0.3deg); }
          40% { transform: translateX(-50%) translateY(0) rotate(-0.2deg); }
          60% { transform: translateX(-50%) translateY(-2px) rotate(0.4deg); }
          80% { transform: translateX(-50%) translateY(-1px) rotate(-0.3deg); }
          100% { transform: translateX(-50%) translateY(0) rotate(0deg); }
        }

        @keyframes wheel-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes exhaust-1 {
          0% { opacity: 0.6; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px) translateX(-2px); }
        }

        @keyframes exhaust-2 {
          0% { opacity: 0.4; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-12px) translateX(2px); }
        }

        @keyframes exhaust-3 {
          0% { opacity: 0.2; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px) translateX(-1px); }
        }

        .animate-road-scroll {
          animation: road-scroll 4s linear infinite;
        }

        .animate-clouds-scroll {
          animation: clouds-scroll 40s linear infinite;
        }

        .animate-truck-sway {
          animation: truck-sway 3s ease-in-out infinite;
        }

        .animate-wheel-rotate {
          transform-origin: center;
          animation: wheel-rotate 1.5s linear infinite;
        }

        .animate-exhaust-1 {
          animation: exhaust-1 1.2s ease-out infinite;
        }

        .animate-exhaust-2 {
          animation: exhaust-2 1.5s ease-out infinite;
          animation-delay: 0.3s;
        }

        .animate-exhaust-3 {
          animation: exhaust-3 1.8s ease-out infinite;
          animation-delay: 0.6s;
        }
      `}</style>
    </div>
  );
}
