import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { Calendar, Truck, ArrowRight, Brain, MessageSquare, Shield, Zap, Menu, X, Users, Clock, CheckCircle } from 'lucide-react';

// Typing effect hook
function useTypingEffect(text: string, speed: number = 50, startDelay: number = 500) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText('');
    setIsComplete(false);

    const startTimeout = setTimeout(() => {
      let index = 0;
      const interval = setInterval(() => {
        if (index < text.length) {
          setDisplayedText(text.slice(0, index + 1));
          index++;
        } else {
          setIsComplete(true);
          clearInterval(interval);
        }
      }, speed);

      return () => clearInterval(interval);
    }, startDelay);

    return () => clearTimeout(startTimeout);
  }, [text, speed, startDelay]);

  return { displayedText, isComplete };
}

// Animated counter hook
function useCountUp(end: number, duration: number = 2000, startOnView: boolean = true) {
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startOnView) {
      setHasStarted(true);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasStarted) {
          setHasStarted(true);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasStarted, startOnView]);

  useEffect(() => {
    if (!hasStarted) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));

      if (progress >= 1) {
        clearInterval(interval);
      }
    }, 16);

    return () => clearInterval(interval);
  }, [hasStarted, end, duration]);

  return { count, ref };
}

// Scroll animation hook
function useScrollAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

// Demo conversation messages
const demoConversation = [
  { type: 'user', text: "John called me at the last minute, he's not feeling well. Who can cover his route?" },
  { type: 'milo', text: "John is a Solo1 driver. Checking other Solo1 drivers for HOS compliance... Smith, Williams, and Davis can cover. All three have had their required 10 hours off since their last shift and are within their 70-hour weekly limits. Who would you like to assign?" },
  { type: 'user', text: "Ok, assign it to Smith." },
  { type: 'milo', text: "Done! I've assigned John's route to Smith and notified him. By the way, would you like me to check how many times John has called in sick in the last 6 weeks?" },
];

// Demo Modal Component with typing animation
function DemoModal({ onClose, onTryDemo }: { onClose: () => void; onTryDemo: () => void }) {
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const [currentText, setCurrentText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(true);

  useEffect(() => {
    if (visibleMessages >= demoConversation.length) {
      setIsTyping(false);
      return;
    }

    const message = demoConversation[visibleMessages];
    let charIndex = 0;
    setCurrentText('');
    setIsTyping(true);

    const typingSpeed = message.type === 'milo' ? 40 : 55; // Slower typing for readability

    const typeInterval = setInterval(() => {
      if (charIndex < message.text.length) {
        setCurrentText(message.text.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval(typeInterval);
        // Pause before next message
        setTimeout(() => {
          setVisibleMessages(prev => prev + 1);
        }, message.type === 'user' ? 800 : 1200);
      }
    }, typingSpeed);

    return () => clearInterval(typeInterval);
  }, [visibleMessages]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl p-6 md:p-8 max-w-2xl w-full mx-4 border border-slate-700 max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-xl md:text-2xl font-bold text-white">Milo in Action</h3>
          <div className="ml-auto flex items-center gap-2 text-green-400 text-sm">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Live Demo
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-6 flex-1 overflow-y-auto min-h-[300px]">
          <div className="space-y-4">
            {/* Completed messages */}
            {demoConversation.slice(0, visibleMessages).map((msg, i) => (
              <div key={i} className={`flex items-start gap-3 ${msg.type === 'user' ? '' : ''}`}>
                {msg.type === 'user' ? (
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">U</div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={`rounded-xl px-4 py-2 text-slate-200 text-sm md:text-base ${
                  msg.type === 'user'
                    ? 'bg-slate-700'
                    : 'bg-blue-500/20 border border-blue-500/30'
                }`}>
                  {msg.type === 'milo' ? highlightNames(msg.text) : msg.text}
                </div>
              </div>
            ))}

            {/* Currently typing message */}
            {visibleMessages < demoConversation.length && (
              <div className="flex items-start gap-3">
                {demoConversation[visibleMessages].type === 'user' ? (
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">U</div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={`rounded-xl px-4 py-2 text-slate-200 text-sm md:text-base flex items-start ${
                  demoConversation[visibleMessages].type === 'user'
                    ? 'bg-slate-700'
                    : 'bg-blue-500/20 border border-blue-500/30'
                }`}>
                  <span className="flex-1">{demoConversation[visibleMessages].type === 'milo' ? highlightNames(currentText) : currentText}</span>
                  <span className="inline-block w-0.5 h-4 bg-blue-400 ml-1 animate-blink flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Typing indicator when waiting for next message */}
            {!isTyping && visibleMessages < demoConversation.length && (
              <div className="flex items-center gap-2 text-slate-500 text-sm pl-11">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={onTryDemo}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl text-center hover:from-blue-500 hover:to-purple-500 transition-all"
          >
            Try Milo Now
          </button>
          <Link href="/login">
            <a className="flex-1 px-6 py-3 bg-slate-700 text-white font-semibold rounded-xl text-center hover:bg-slate-600 transition-all">
              Sign In
            </a>
          </Link>
        </div>
      </div>
    </div>
  );
}

// Helper function to highlight driver names in Milo's responses
function highlightNames(text: string): React.ReactNode {
  const names = ['Smith', 'Williams', 'Davis', 'Johnson', 'Brown', 'Jones', 'Miller', 'John'];
  let result: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliestMatch = { index: -1, name: '', length: 0 };

    for (const name of names) {
      const index = remaining.indexOf(name);
      if (index !== -1 && (earliestMatch.index === -1 || index < earliestMatch.index)) {
        earliestMatch = { index, name, length: name.length };
      }
    }

    if (earliestMatch.index === -1) {
      result.push(remaining);
      break;
    }

    if (earliestMatch.index > 0) {
      result.push(remaining.slice(0, earliestMatch.index));
    }
    result.push(
      <span key={key++} className="text-green-400 font-medium">
        {earliestMatch.name}
      </span>
    );
    remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
  }

  return result;
}

// CSS-based 3D Landing Page - Full screen calendar background with Milo AI theme
export default function Landing3DCSS() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showDemo, setShowDemo] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, setLocation] = useLocation();

  // Typing effect for subtitle (60ms per char = 50% slower)
  const subtitleText = "Your intelligent scheduling assistant that understands natural language. Talk to Milo like a colleague—get instant answers, optimize routes, and manage your fleet effortlessly.";
  const { displayedText, isComplete } = useTypingEffect(subtitleText, 60, 800);

  // Stats counters
  const schedulesCounter = useCountUp(10000, 2500);
  const driversCounter = useCountUp(500, 2000);
  const hoursCounter = useCountUp(99, 1800);

  // Scroll animations for sections
  const featuresAnimation = useScrollAnimation();
  const statsAnimation = useScrollAnimation();
  const aboutAnimation = useScrollAnimation();

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Generate calendar days with assignments - memoized
  const calendarDays = useMemo(() => Array.from({ length: 42 }, (_, i) => ({
    day: i < 5 ? '' : i - 4,
    hasAssignment: [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 27, 28, 29, 30].includes(i - 4),
    driver: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Davis', 'Miller'][i % 7]
  })), []);

  // Memoize particle positions to prevent re-randomization
  const particles = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: 5 + Math.random() * 10,
      delay: Math.random() * 5
    })), []);

  // Demo login handler
  const handleDemoLogin = async () => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo123' }),
        credentials: 'include'
      });

      if (response.ok) {
        setLocation('/dashboard');
      } else {
        // If demo account doesn't exist, go to login page
        setLocation('/login');
      }
    } catch {
      setLocation('/login');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 overflow-hidden relative">
      {/* Full screen calendar background */}
      <div className="fixed inset-0 overflow-hidden">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-blue-950/80 to-slate-950/95 z-10" />

        {/* Animated grid lines */}
        <div className="absolute inset-0 z-0">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `
                linear-gradient(rgba(59, 130, 246, 0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(59, 130, 246, 0.3) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
              transform: `translate(${mousePosition.x * 0.5}px, ${mousePosition.y * 0.5}px)`
            }}
          />
        </div>

        {/* Large background calendar */}
        <div
          className="absolute inset-0 flex items-center justify-center z-5"
          style={{
            transform: `translate(${mousePosition.x * 0.3}px, ${mousePosition.y * 0.3}px) scale(1.2)`,
            opacity: 0.15
          }}
        >
          <div className="grid grid-cols-7 gap-3 p-8 w-full max-w-6xl">
            {calendarDays.map((cell, i) => (
              <div
                key={i}
                className={`
                  aspect-square rounded-xl flex items-center justify-center text-4xl font-bold
                  ${cell.hasAssignment
                    ? 'bg-gradient-to-br from-blue-500/40 to-purple-500/30 text-blue-300'
                    : 'bg-slate-800/30 text-slate-600'
                  }
                `}
              >
                {cell.day}
              </div>
            ))}
          </div>
        </div>

        {/* Floating AI particles - memoized positions */}
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-2 h-2 bg-blue-400/30 rounded-full"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animation: `float-particle ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`
            }}
          />
        ))}

        {/* Glowing orbs */}
        <div
          className="absolute w-[600px] h-[600px] bg-blue-500/20 rounded-full blur-[120px]"
          style={{
            left: '20%',
            top: '30%',
            transform: `translate(${mousePosition.x * 2}px, ${mousePosition.y * 2}px)`
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] bg-purple-500/15 rounded-full blur-[100px]"
          style={{
            right: '10%',
            bottom: '20%',
            transform: `translate(${-mousePosition.x * 1.5}px, ${-mousePosition.y * 1.5}px)`
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-20">
        {/* Navbar */}
        <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 py-4 backdrop-blur-xl bg-slate-900/60 border-b border-white/10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <Link href="/">
              <a className="flex items-center gap-2 md:gap-3 text-xl md:text-2xl font-bold text-white">
                <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <Brain className="w-5 h-5 md:w-6 md:h-6 text-white" />
                </div>
                <span>Milo</span>
                <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">AI</span>
              </a>
            </Link>

            {/* Desktop menu */}
            <div className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-slate-300 hover:text-white transition-colors">Features</a>
              <a href="#stats" className="text-slate-300 hover:text-white transition-colors">Stats</a>
              <a href="#about" className="text-slate-300 hover:text-white transition-colors">About</a>
              <button
                onClick={handleDemoLogin}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Try Demo
              </button>
              <Link href="/login">
                <a className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl transition-all transform hover:scale-105 font-medium">
                  Sign In
                </a>
              </Link>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-white"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden absolute top-full left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-b border-white/10 py-4 px-4">
              <div className="flex flex-col gap-4">
                <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-slate-300 hover:text-white transition-colors py-2">Features</a>
                <a href="#stats" onClick={() => setMobileMenuOpen(false)} className="text-slate-300 hover:text-white transition-colors py-2">Stats</a>
                <a href="#about" onClick={() => setMobileMenuOpen(false)} className="text-slate-300 hover:text-white transition-colors py-2">About</a>
                <button
                  onClick={() => { handleDemoLogin(); setMobileMenuOpen(false); }}
                  className="text-left text-slate-300 hover:text-white transition-colors py-2"
                >
                  Try Demo
                </button>
                <Link href="/login">
                  <a className="px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl text-center font-medium">
                    Sign In
                  </a>
                </Link>
              </div>
            </div>
          )}
        </nav>

        {/* Hero section */}
        <section className="min-h-screen flex items-center justify-center pt-20 px-4 md:px-8">
          <div className="max-w-5xl mx-auto text-center">
            {/* AI Badge */}
            <div
              className="inline-flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full text-blue-300 text-xs md:text-sm border border-blue-500/30 mb-6 md:mb-8"
              style={{
                transform: `translateY(${mousePosition.y * 0.1}px)`
              }}
            >
              <Brain className="w-4 h-4" />
              <span>AI-Powered Trucking Operations Assistant</span>
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            </div>

            {/* Main heading */}
            <h1
              className="text-5xl sm:text-6xl md:text-8xl font-bold text-white leading-tight mb-6 md:mb-8"
              style={{
                transform: `translateY(${mousePosition.y * 0.05}px)`
              }}
            >
              Meet{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 animate-gradient">
                Milo
              </span>
            </h1>

            {/* Animated Subtitle */}
            <div
              className="text-lg md:text-xl lg:text-2xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10 md:mb-12 min-h-[80px] md:min-h-[60px]"
              style={{
                transform: `translateY(${mousePosition.y * 0.03}px)`
              }}
            >
              {displayedText}
              {!isComplete && <span className="inline-block w-0.5 h-6 bg-blue-400 ml-1 animate-blink" />}
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4 mb-12 md:mb-16">
              <Link href="/login">
                <a className="group px-8 md:px-10 py-4 md:py-5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-2xl transition-all transform hover:scale-105 shadow-lg shadow-blue-500/25 flex items-center justify-center gap-3 text-base md:text-lg">
                  <MessageSquare className="w-5 h-5" />
                  Start Chatting with Milo
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </a>
              </Link>
              <button
                onClick={() => setShowDemo(true)}
                className="px-8 md:px-10 py-4 md:py-5 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-2xl backdrop-blur-sm transition-all border border-white/20 hover:border-white/30 flex items-center justify-center gap-3 text-base md:text-lg"
              >
                <Zap className="w-5 h-5 text-yellow-400" />
                Watch Demo
              </button>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-3 md:gap-4">
              {[
                { icon: Calendar, text: 'Smart Scheduling' },
                { icon: Shield, text: 'DOT Compliance' },
                { icon: Truck, text: 'Fleet Management' },
                { icon: Brain, text: 'AI Learning' }
              ].map((feature, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-slate-800/50 rounded-full text-slate-300 text-xs md:text-sm border border-slate-700/50 backdrop-blur-sm"
                  style={{
                    animation: `fade-in 0.5s ease-out ${i * 0.1}s both`
                  }}
                >
                  <feature.icon className="w-4 h-4 text-blue-400" />
                  {feature.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats section */}
        <section
          id="stats"
          ref={statsAnimation.ref}
          className={`py-20 md:py-32 px-4 md:px-8 relative transition-all duration-1000 ${
            statsAnimation.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { counter: schedulesCounter, label: 'Schedules Optimized', suffix: '+', icon: Calendar },
                { counter: driversCounter, label: 'Drivers Managed', suffix: '+', icon: Users },
                { counter: hoursCounter, label: 'Uptime', suffix: '%', icon: Clock }
              ].map((stat, i) => (
                <div
                  key={i}
                  ref={i === 0 ? stat.counter.ref : undefined}
                  className="text-center p-8 bg-slate-800/20 backdrop-blur-xl rounded-2xl border border-slate-700/30"
                  style={{
                    animation: statsAnimation.isVisible ? `fade-in 0.6s ease-out ${i * 0.2}s both` : 'none'
                  }}
                >
                  <stat.icon className="w-10 h-10 text-blue-400 mx-auto mb-4" />
                  <div className="text-4xl md:text-5xl font-bold text-white mb-2">
                    {stat.counter.count.toLocaleString()}{stat.suffix}
                  </div>
                  <div className="text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features section */}
        <section
          id="features"
          ref={featuresAnimation.ref}
          className={`py-20 md:py-32 px-4 md:px-8 relative transition-all duration-1000 ${
            featuresAnimation.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12 md:mb-16">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 md:mb-6">
                AI That Evolves With You
              </h2>
              <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto">
                Milo learns your patterns, understands your preferences, and gets smarter with every interaction.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 md:gap-8">
              {[
                {
                  icon: MessageSquare,
                  title: 'Natural Conversation',
                  description: 'Talk to Milo like you would a dispatcher. Ask questions, make changes, get insights—all through natural language.'
                },
                {
                  icon: Calendar,
                  title: 'Intelligent Scheduling',
                  description: 'Automatically optimize driver assignments, handle conflicts, and ensure compliance with DOT regulations.'
                },
                {
                  icon: Brain,
                  title: 'Continuous Learning',
                  description: 'Milo learns from your decisions and preferences, becoming more helpful and accurate over time.'
                }
              ].map((feature, i) => (
                <div
                  key={i}
                  className="p-6 md:p-8 bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/50 hover:border-blue-500/50 transition-all group"
                  style={{
                    animation: featuresAnimation.isVisible ? `fade-in 0.6s ease-out ${i * 0.15}s both` : 'none'
                  }}
                >
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-5 md:mb-6 group-hover:scale-110 transition-transform">
                    <feature.icon className="w-6 h-6 md:w-7 md:h-7 text-blue-400" />
                  </div>
                  <h3 className="text-lg md:text-xl font-semibold text-white mb-3">{feature.title}</h3>
                  <p className="text-slate-400 leading-relaxed text-sm md:text-base">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* About section */}
        <section
          id="about"
          ref={aboutAnimation.ref}
          className={`py-20 md:py-32 px-4 md:px-8 relative transition-all duration-1000 ${
            aboutAnimation.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
        >
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 md:mb-6">
              Built for Freedom Transportation
            </h2>
            <p className="text-lg md:text-xl text-slate-400 leading-relaxed mb-8">
              Milo was designed specifically for trucking operations—understanding the unique challenges of scheduling drivers,
              managing DOT compliance, and keeping your fleet running smoothly. It's not just software, it's your AI partner.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {['DOT Compliant', '24/7 Available', 'Real-time Updates', 'Secure & Private'].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500/10 rounded-full text-green-400 text-sm border border-green-500/20"
                >
                  <CheckCircle className="w-4 h-4" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-4 md:px-8 border-t border-slate-800">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <span className="text-white font-semibold">Milo AI</span>
              </div>
              <div className="text-slate-500 text-sm text-center">
                © {new Date().getFullYear()} Freedom Transportation. All rights reserved.
              </div>
              <div className="flex gap-6 text-sm">
                <a href="#" className="text-slate-400 hover:text-white transition-colors">Privacy</a>
                <a href="#" className="text-slate-400 hover:text-white transition-colors">Terms</a>
                <a href="#" className="text-slate-400 hover:text-white transition-colors">Contact</a>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Demo Modal */}
      {showDemo && (
        <DemoModal
          onClose={() => setShowDemo(false)}
          onTryDemo={() => { handleDemoLogin(); setShowDemo(false); }}
        />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          50% { transform: translateY(-30px) translateX(20px); opacity: 0.6; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }
        .animate-blink {
          animation: blink 1s infinite;
        }
      `}</style>
    </div>
  );
}
