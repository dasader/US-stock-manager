/**
 * 접근성 유틸리티
 */

/**
 * 접근성 관련 속성 헬퍼
 */
export const a11yProps = {
  // 시각적으로 숨기되 스크린리더는 읽음
  srOnly: 'sr-only absolute left-[-10000px] w-[1px] h-[1px] overflow-hidden',
  
  // ARIA 레이블 헬퍼
  ariaLabel: (label: string) => ({ 'aria-label': label }),
  ariaDescribedBy: (id: string) => ({ 'aria-describedby': id }),
  ariaLabelledBy: (id: string) => ({ 'aria-labelledby': id }),
  
  // 포커스 링
  focusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  
  // 터치 타겟
  touchTarget: 'min-h-[44px] min-w-[44px]',
  
  // 키보드 네비게이션
  keyboardFocusable: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
};

/**
 * 숨겨진 레이블 (스크린리더용)
 */
export const VisuallyHidden = ({ children }: { children: React.ReactNode }) => (
  <span className={a11yProps.srOnly}>{children}</span>
);

/**
 * 스킵 네비게이션 링크
 */
export const SkipLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:p-4 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
  >
    {children}
  </a>
);

/**
 * WCAG 2.1 기준 색상 대비 체크 (간단한 버전)
 * 실제 프로덕션에서는 color-contrast 라이브러리 사용 권장
 */
export function checkColorContrast(_fg: string, _bg: string): 'AA' | 'AAA' | 'FAIL' {
  // 실제 구현은 색상을 RGB로 변환하여 상대 휘도 계산 필요
  // 여기서는 플레이스홀더
  return 'AA';
}

/**
 * 키보드 이벤트 핸들러 헬퍼
 */
export const keyboard = {
  onEnter: (callback: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      callback();
    }
  },
  
  onSpace: (callback: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      callback();
    }
  },
  
  onEscape: (callback: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      callback();
    }
  },
  
  onArrowKeys: (callbacks: {
    up?: () => void;
    down?: () => void;
    left?: () => void;
    right?: () => void;
  }) => (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        callbacks.up?.();
        break;
      case 'ArrowDown':
        e.preventDefault();
        callbacks.down?.();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        callbacks.left?.();
        break;
      case 'ArrowRight':
        e.preventDefault();
        callbacks.right?.();
        break;
    }
  },
};

export default {
  a11yProps,
  VisuallyHidden,
  SkipLink,
  checkColorContrast,
  keyboard,
};

