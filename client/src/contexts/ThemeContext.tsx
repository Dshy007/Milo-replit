import { createContext, useContext, useState, useMemo, ReactNode } from 'react';

export type ThemeMode = 'night' | 'day' | 'retro' | 'cyberpunk';

interface ThemeStyles {
  background: string;
  color: string;
  accentColor: string;
}

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  themeStyles: ThemeStyles;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('app-theme');
    return (saved as ThemeMode) || 'day';
  });

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem('app-theme', mode);
  };

  const getThemeStyles = (): ThemeStyles => {
    switch (themeMode) {
      case 'night':
        return {
          background: '#000000',
          color: '#ffffff',
          accentColor: '#60a5fa',
        };
      case 'retro':
        return {
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#fef3c7',
          accentColor: '#fbbf24',
        };
      case 'cyberpunk':
        return {
          background: 'linear-gradient(135deg, #0a0e27 0%, #1a1a2e 50%, #16213e 100%)',
          color: '#00ffff',
          accentColor: '#ff00ff',
        };
      case 'day':
      default:
        return {
          background: 'linear-gradient(to bottom, #f8fafc 0%, #e2e8f0 100%)',
          color: '#1e293b',
          accentColor: '#3b82f6',
        };
    }
  };

  const themeStyles = useMemo(() => getThemeStyles(), [themeMode]);

  const value = {
    themeMode,
    setThemeMode,
    themeStyles,
  };

  // Apply dark class to night, retro, and cyberpunk themes
  // Apply cyberpunk class for special effects
  const getThemeClasses = () => {
    const classes = ['min-h-screen', 'transition-all', 'duration-500'];

    // Apply dark mode variables to all dark themes
    if (themeMode === 'night' || themeMode === 'retro' || themeMode === 'cyberpunk') {
      classes.push('dark');
    }

    // Apply special cyberpunk class for neon effects
    if (themeMode === 'cyberpunk') {
      classes.push('cyberpunk');
    }

    return classes.join(' ');
  };

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={getThemeClasses()}
        style={{ background: themeStyles.background, color: themeStyles.color }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
};
