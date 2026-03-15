import { useState, useEffect, useCallback } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Sidebar, { type Section } from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import BottomNav from './components/layout/BottomNav';
import Portfolio from './components/Portfolio';
import Trades from './components/Trades';
import CashFlow from './components/CashFlow';
import Settings from './components/Settings';
import { Toaster } from './components/ui/toaster';
import { dashboardApi } from './services/api';
import { cn } from './lib/utils';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  const [activeSection, setActiveSection] = useState<Section>('portfolio');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    // Default to dark mode for Obsidian Finance theme
    return saved === null ? true : saved === 'true';
  });
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [, /* setSidebarExpanded */] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('darkMode', String(next));
      return next;
    });
  }, []);

  // Fetch dashboard summary for topbar badges
  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary-topbar', selectedAccountId],
    queryFn: () => dashboardApi.getSummary({
      account_id: selectedAccountId || undefined,
    }).then((res) => res.data),
    refetchInterval: 60000,
    retry: 1,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.altKey) {
        switch (e.key) {
          case '1': e.preventDefault(); setActiveSection('portfolio'); break;
          case '2': e.preventDefault(); setActiveSection('trades'); break;
          case '3': e.preventDefault(); setActiveSection('cashflow'); break;
          case '4': e.preventDefault(); setActiveSection('settings'); break;
          case 'd': case 'D': e.preventDefault(); toggleDarkMode(); break;
          case 'r': case 'R': e.preventDefault(); window.location.reload(); break;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleDarkMode]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar active={activeSection} onChange={setActiveSection} />

      <div className={cn(
        'transition-all duration-300',
        'md:ml-[var(--sidebar-width)]'
      )}>
        <TopBar
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          selectedAccountId={selectedAccountId}
          onAccountChange={setSelectedAccountId}
          fxRate={summary?.fx_rate_usd_krw}
          fearGreed={summary?.fear_greed_index ? {
            value: summary.fear_greed_index.value,
            classification: summary.fear_greed_index.classification,
          } : undefined}
        />

        <main className="px-4 md:px-6 lg:px-8 py-5 md:py-6 pb-20 md:pb-6">
          <div className={cn(
            'transition-opacity duration-200',
            'max-w-[1600px] mx-auto'
          )}>
            {activeSection === 'portfolio' && <Portfolio accountId={selectedAccountId} />}
            {activeSection === 'trades' && <Trades accountId={selectedAccountId} />}
            {activeSection === 'cashflow' && <CashFlow accountId={selectedAccountId} />}
            {activeSection === 'settings' && <Settings />}
          </div>
        </main>
      </div>

      <BottomNav active={activeSection} onChange={setActiveSection} />
      <Toaster />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
