import { Moon, Sun, DollarSign, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AccountSelector from '@/components/AccountSelector';

interface TopBarProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  selectedAccountId: number | null;
  onAccountChange: (id: number | null) => void;
  fxRate?: number;
  fearGreed?: { value: number; classification: string };
}

export default function TopBar({
  darkMode,
  onToggleDarkMode,
  selectedAccountId,
  onAccountChange,
  fxRate,
  fearGreed,
}: TopBarProps) {
  const fgColor = fearGreed
    ? fearGreed.value <= 25 ? 'text-loss bg-loss/10 border-loss/20'
    : fearGreed.value <= 45 ? 'text-orange-500 bg-orange-500/10 border-orange-500/20'
    : fearGreed.value <= 55 ? 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20'
    : fearGreed.value <= 75 ? 'text-profit bg-profit/10 border-profit/20'
    : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    : '';

  const fgLabel = fearGreed
    ? fearGreed.value <= 25 ? '극단적 공포'
    : fearGreed.value <= 45 ? '공포'
    : fearGreed.value <= 55 ? '중립'
    : fearGreed.value <= 75 ? '탐욕'
    : '극단적 탐욕'
    : '';

  return (
    <header className="h-[var(--topbar-height)] border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center px-4 md:px-6 lg:px-8 gap-3 sticky top-0 z-50">
      {/* Mobile logo */}
      <div className="md:hidden flex items-center gap-2 mr-auto">
        <div className="w-8 h-8 rounded-lg gold-gradient flex items-center justify-center shadow-glow-gold">
          <span className="text-xs font-bold text-white">US</span>
        </div>
        <span className="text-sm font-semibold text-gold">Stock Manager</span>
      </div>

      {/* Spacer for desktop */}
      <div className="hidden md:block flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* Account selector */}
        <AccountSelector
          value={selectedAccountId}
          onChange={onAccountChange}
          showAllOption={true}
          className="min-w-[120px]"
        />

        {/* FX Rate badge */}
        {fxRate && (
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-secondary/50 text-xs font-medium">
            <DollarSign className="w-3 h-3 text-primary" />
            <span className="font-numeric text-foreground">{Math.round(fxRate).toLocaleString()}</span>
          </div>
        )}

        {/* Fear & Greed badge */}
        {fearGreed && (
          <div className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold ${fgColor}`}>
            <Activity className="w-3 h-3" />
            <span className="font-numeric">{fearGreed.value}</span>
            <span className="hidden lg:inline opacity-75 font-medium">{fgLabel}</span>
          </div>
        )}

        {/* Dark mode */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleDarkMode}
          className="w-9 h-9 rounded-lg"
          aria-label={darkMode ? "라이트 모드" : "다크 모드"}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
