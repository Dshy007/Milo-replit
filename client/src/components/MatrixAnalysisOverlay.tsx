import { useEffect, useRef, useState } from "react";

interface MatrixAnalysisOverlayProps {
  isAnalyzing: boolean;
  analysisProgress?: number; // 0-100
  analysisMessage?: string;
}

export function MatrixAnalysisOverlay({
  isAnalyzing,
  analysisProgress = 0,
  analysisMessage = "Analyzing compliance..."
}: MatrixAnalysisOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Fade in/out effect
  useEffect(() => {
    if (isAnalyzing) {
      setIsVisible(true);
    } else {
      // Delay hiding to allow fade out
      const timer = setTimeout(() => setIsVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isAnalyzing]);

  // Matrix rain effect
  useEffect(() => {
    if (!isAnalyzing || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to window size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Matrix characters - mix of katakana, numbers, and symbols
    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]|/\\";
    const charArray = chars.split("");

    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);

    // Array to track Y position of each column
    const drops: number[] = Array(columns).fill(1);

    // Animation
    let animationId: number;

    const draw = () => {
      // Semi-transparent black to create fade effect
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Green text with glow
      ctx.fillStyle = "#00ff41";
      ctx.font = `${fontSize}px monospace`;
      ctx.shadowBlur = 2;
      ctx.shadowColor = "#00ff41";

      for (let i = 0; i < drops.length; i++) {
        // Random character
        const char = charArray[Math.floor(Math.random() * charArray.length)];

        // Vary the green color slightly for depth
        const brightness = Math.random() * 50 + 50;
        ctx.fillStyle = `rgb(0, ${155 + brightness}, ${65 + brightness * 0.3})`;

        ctx.fillText(char, i * fontSize, drops[i] * fontSize);

        // Reset drop to top randomly after it goes off screen
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, [isAnalyzing]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500 ${
        isAnalyzing ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Matrix canvas background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.9)" }}
      />

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center gap-6 p-8 rounded-lg bg-black/60 border border-green-500/30 backdrop-blur-sm max-w-md">
        {/* Spinning CPU icon */}
        <div className="relative">
          <div className="w-20 h-20 border-4 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
        </div>

        {/* Analysis text */}
        <div className="text-center">
          <h2 className="text-xl font-bold text-green-400 mb-2 font-mono">
            {analysisMessage}
          </h2>
          <p className="text-green-300/70 text-sm font-mono">
            Running HOS compliance & bump analysis...
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full">
          <div className="h-2 bg-green-900/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-300 ease-out"
              style={{ width: `${analysisProgress}%` }}
            />
          </div>
          <p className="text-green-400/70 text-xs font-mono mt-2 text-center">
            {analysisProgress}% complete
          </p>
        </div>

        {/* Scrolling analysis log */}
        <div className="w-full h-24 bg-black/50 rounded border border-green-500/20 overflow-hidden">
          <div className="animate-scroll-up p-2 text-xs font-mono text-green-400/60 space-y-1">
            <p>&gt; Initializing compliance scan...</p>
            <p>&gt; Loading driver assignments...</p>
            <p>&gt; Calculating duty hours (24h/48h windows)...</p>
            <p>&gt; Checking Solo1 14-hour limits...</p>
            <p>&gt; Checking Solo2 20-hour limits...</p>
            <p>&gt; Validating protected driver rules...</p>
            <p>&gt; Comparing scheduled vs canonical times...</p>
            <p>&gt; Detecting time bumps (+/- from contract)...</p>
            <p>&gt; Flagging critical deviations (&gt;2h bump)...</p>
            <p>&gt; Generating compliance report...</p>
            <p>&gt; Analysis complete.</p>
          </div>
        </div>
      </div>

      {/* Scan lines effect */}
      <div
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 65, 0.03) 2px, rgba(0, 255, 65, 0.03) 4px)"
        }}
      />
    </div>
  );
}
