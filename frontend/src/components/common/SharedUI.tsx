import React, { useState, useEffect, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Search,
  Check,
  CheckCircle2,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  HelpCircle,
  Info
} from 'lucide-react';
import {
  Question,
  ScheduledExam,
  StudentResult,
  StudentQuery,
  ProctoringEventRecord,
  AuditLog
} from '../../types';

// 1. PageHeader
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export const PageMotionShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="animate-fade-in">{children}</div>
);

type ScrollRevealRoot = React.RefObject<Element | null>;
const ScrollRevealRootContext = React.createContext<ScrollRevealRoot | null>(null);

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  root?: ScrollRevealRoot;
}

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  className = '',
  delay = 0,
  root
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const modalRoot = useContext(ScrollRevealRootContext);
  const observerRoot = root || modalRoot;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
      setIsVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        root: observerRoot?.current || null,
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px'
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [observerRoot]);

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${isVisible ? 'is-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => (
  <ScrollReveal className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white leading-tight tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[13.5px] font-normal text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
    {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
  </ScrollReveal>
);

// 2. KpiCard / KsiCard
export interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  metadata?: string;
  subValue?: string | React.ReactNode;
  isLoading?: boolean;
  onClick?: () => void;
  badge?: string;
}

export function getKpiPrimaryValueClass(value: string | number): string {
  const isLongValue = String(value).trim().length > 12;
  const size = isLongValue
    ? 'text-[17px] sm:text-[18px] lg:text-[19px]'
    : 'text-[19px] sm:text-[20px] lg:text-[21px]';
  return `${size} font-semibold leading-[1.15] break-words line-clamp-2`;
}

export const AnimatedNumber: React.FC<{ value: string | number; className?: string }> = ({ value, className }) => {
  const numericValue = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[^0-9.-]+/g, ''));
  const suffix = typeof value === 'string' ? String(value).replace(/[0-9.\-]+/g, '') : '';
  const [displayValue, setDisplayValue] = useState(numericValue);
  const previousValueRef = useRef(numericValue);

  useEffect(() => {
    if (!Number.isFinite(numericValue)) {
      setDisplayValue(Number.NaN);
      return;
    }

    const from = previousValueRef.current;
    const to = numericValue;
    const duration = 500;
    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = from + (to - from) * eased;
      setDisplayValue(nextValue);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        previousValueRef.current = to;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [numericValue]);

  if (!Number.isFinite(numericValue)) {
    return <span className={className}>{value}</span>;
  }

  const formattedValue = Number.isInteger(displayValue)
    ? `${Math.round(displayValue)}${suffix}`
    : `${displayValue.toFixed(1).replace(/\.0$/, '')}${suffix}`;

  return <span className={className}>{formattedValue}</span>;
};

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon,
  metadata,
  subValue,
  isLoading,
  onClick,
  badge
}) => {
  const content = (
    <>
      <span className={`flex min-w-0 items-center justify-between gap-2 font-medium text-slate-500 dark:text-slate-400 ${onClick ? 'text-[13px]' : 'text-[12px]'}`}>
        <span>{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {badge && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {badge}
            </span>
          )}
          {icon}
        </span>
      </span>
      {isLoading ? (
        <span className={`block ${onClick ? 'mt-2 space-y-1.5' : 'mt-1'}`}>
          <span className={`block animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${onClick ? 'h-7 w-16' : 'h-4 w-12'}`} />
          {onClick && <span className="block h-3.5 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-700/50" />}
        </span>
      ) : (
        <>
          <span className={`${onClick ? `${getKpiPrimaryValueClass(value)} mt-1` : 'mt-0.5 text-[15px] font-semibold leading-tight'} block min-w-0 text-slate-900 dark:text-white tabular-nums`}>
            <AnimatedNumber value={value} className="inline-block" />
          </span>
          {(subValue || metadata) && (
            <span className={`block break-words font-normal leading-snug text-slate-500 dark:text-slate-400 ${onClick ? 'mt-0.5 text-[13px]' : 'mt-0.5 text-[11px]'}`}>
              {subValue || metadata}
            </span>
          )}
        </>
      )}
    </>
  );

  if (!onClick) {
    return (
      <div className="examx-motion-card min-w-0 border-l border-slate-200 pl-3 [&_svg]:h-4 [&_svg]:w-4 dark:border-slate-700">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${isLoading ? 'Loading' : value}`}
      className="examx-motion-card examx-motion-button w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-500"
    >
      {content}
    </button>
  );
};

export const KsiCard = KpiCard;

// 3. StatusBadge
interface StatusBadgeProps {
  status?: string;
}

export function getStatusBadgeClasses(status?: string): string {
  switch ((status || 'ACTIVE').toUpperCase()) {
    case 'ACTIVE':
    case 'LIVE':
    case 'PUBLISHED':
    case 'RESULT_PUBLISHED':
    case 'APPROVED':
    case 'CLEAN':
    case 'RESOLVED':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'SCHEDULED':
    case 'VERIFIED':
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'PENDING':
    case 'PENDING_REVIEW':
    case 'PARTIALLY_REVIEWED':
    case 'UNDER_REVIEW':
    case 'DRAFT':
    case 'WARNED':
    case 'OPEN':
    case 'UNPUBLISHED':
    case 'MEDIUM':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'BLOCKED':
    case 'SUSPENDED':
    case 'REJECTED':
    case 'DISCARDED':
    case 'TERMINATED':
    case 'CRITICAL':
    case 'HIGH':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <span
    className={`examx-status-badge inline-flex items-center px-2 py-0.5 rounded text-[11.5px] font-medium border leading-none ${getStatusBadgeClasses(
      status
    )}`}
  >
    {status || 'ACTIVE'}
  </span>
);

// 4. EmptyState
interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, actionLabel, onAction }) => (
  <div className="p-12 text-center">
    <p className="text-[15px] font-normal text-slate-500 dark:text-slate-400">{message}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium transition-colors inline-flex items-center justify-center"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

// 5. LoadingState
interface LoadingStateProps {
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading data...' }) => (
  <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
    <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
    <p className="text-[15px] font-normal text-slate-500 dark:text-slate-400">{message}</p>
  </div>
);

// 6. ErrorState
interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'Unable to load data. Try again.',
  onRetry
}) => (
  <div className="p-6 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3 text-[15px] text-red-700 dark:text-red-300">
      <AlertCircle className="w-5 h-5 shrink-0" />
      <span>{message}</span>
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[14px] font-medium shrink-0 inline-flex items-center justify-center"
      >
        Retry
      </button>
    )}
  </div>
);

// 7. Modal
export type ModalSize = 'compact' | 'standard' | 'large' | 'workspace';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: ModalSize;
  maxWidth?: string; // backwards compatibility
  children: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'standard',
  maxWidth,
  children,
  footer,
  actions
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Resolve responsive size classes
  // Normal/simple forms: ~60-70% of viewport width
  // Complex forms & workflows: ~70-80% of viewport width
  // Large workspaces: ~75-85% (up to 80-90% when genuinely required)
  let sizeClass = 'w-full max-w-2xl';
  if (maxWidth) {
    sizeClass = `${maxWidth} w-full`;
  } else {
    switch (size) {
      case 'compact':
        sizeClass = 'w-full max-w-md';
        break;
      case 'standard':
        sizeClass = 'w-full sm:w-[90%] md:w-[65%] max-w-3xl';
        break;
      case 'large':
        sizeClass = 'w-full sm:w-[92%] md:w-[70%] lg:w-[68%] max-w-4xl';
        break;
      case 'workspace':
        sizeClass = 'w-full sm:w-[95%] md:w-[82%] lg:w-[78%] max-w-6xl';
        break;
    }
  }

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-hidden"
      style={{ top: 0, left: 0, right: 0, bottom: 0, margin: 0 }}
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`bg-white dark:bg-slate-800 rounded-xl ${sizeClass} border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col max-h-[90vh] my-auto overflow-hidden animate-slide-up transition-all`}
      >
        {/* Fixed / Sticky Header */}
        <div className="flex justify-between items-start gap-4 p-5 sm:p-6 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-800 z-10">
          <div className="min-w-0 flex-1">
            <h3 className="text-[20px] sm:text-[22px] font-semibold text-slate-900 dark:text-white leading-snug tracking-tight">
              {title}
            </h3>
            {subtitle && (
              <div className="text-[14px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <ScrollRevealRootContext.Provider value={contentRef}>
          <div
            ref={contentRef}
            className="p-5 sm:p-7 overflow-y-auto flex-1 space-y-6 overscroll-contain"
          >
            {children}
          </div>
        </ScrollRevealRootContext.Provider>

        {/* Sticky Footer */}
        {footer && (
          <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm shrink-0 flex items-center justify-end gap-3 sticky bottom-0 z-20">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};

// 8. FormSection
export const FormSection: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, icon, children }) => (
  <div className="space-y-3.5">
    <div className="pb-2 border-b border-slate-200 dark:border-slate-700/80">
      <h4 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
        {icon && <span className="text-blue-600 dark:text-blue-400">{icon}</span>}
        {title}
      </h4>
      {description && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      )}
    </div>
    <div className="pt-1">{children}</div>
  </div>
);

// 9. FormField
interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  error,
  hint,
  children
}) => (
  <div>
    <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {children}
    {hint && !error && <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5">{hint}</p>}
    {error && <p className="text-[13px] text-red-600 dark:text-red-400 mt-1.5">{error}</p>}
  </div>
);

// 9. Select & SearchableSelect
export interface SelectOption {
  value: string;
  label: string;
  subtitle?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyMessage?: string;
  searchable?: boolean;
  isLoading?: boolean;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  emptyMessage = 'No options available.',
  searchable = true,
  isLoading = false,
  error = null,
  disabled = false,
  required = false
}) => {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleOpen = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 280 && rect.top > 260);
    }
    setOpen(prev => !prev);
  };

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);
  const filtered = searchable && query.trim()
    ? options.filter(
        o =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.value.toLowerCase().includes(query.toLowerCase()) ||
          (o.subtitle && o.subtitle.toLowerCase().includes(query.toLowerCase()))
      )
    : options;

  useEffect(() => {
    if (open) {
      const currentIdx = filtered.findIndex(o => o.value === value);
      setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
      if (searchable) {
        setTimeout(() => searchInputRef.current?.focus(), 10);
      }
    } else {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleOpen();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        setHighlightedIndex(prev => (prev + 1) % filtered.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        setHighlightedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0 && filtered[highlightedIndex]) {
        onChange(filtered[highlightedIndex].value);
        setOpen(false);
        setQuery('');
        triggerRef.current?.focus();
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full" onKeyDown={handleKeyDown}>
      {required && (
        <input
          type="text"
          tabIndex={-1}
          required={required}
          value={value}
          onChange={() => {}}
          aria-hidden="true"
          className="sr-only pointer-events-none opacity-0 w-0 h-0 absolute"
        />
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`w-full min-h-[48px] px-3.5 bg-slate-50 dark:bg-slate-900 border rounded-lg text-[15px] text-slate-900 dark:text-white flex items-center justify-between text-left outline-none transition-colors ${
          open
            ? 'border-blue-600 ring-2 ring-blue-500/20'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span className={`truncate mr-2 ${selected ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'}`}>
          {isLoading ? 'Loading...' : selected ? selected.label : placeholder}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {selected && !disabled && !required && (
            <span
              role="button"
              tabIndex={0}
              onClick={e => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
          ) : (
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          )}
        </div>
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-[80] w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {searchable && (
            <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 relative bg-slate-50/50 dark:bg-slate-800/50">
              <Search className="w-4 h-4 text-slate-400 absolute left-5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search options..."
                className="w-full h-10 pl-9 pr-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[14px] text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <div className="p-4 flex items-center justify-center gap-2 text-[14px] text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Loading options...</span>
              </div>
            ) : error ? (
              <div className="p-4 flex items-center gap-2 text-[14px] text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-[14px] text-slate-500 dark:text-slate-400">
                {options.length === 0 ? emptyMessage : 'No matching options.'}
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setQuery('');
                      triggerRef.current?.focus();
                    }}
                    className={`w-full px-3.5 py-3 text-left text-[14.5px] flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-medium'
                        : isHighlighted
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                        : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="min-w-0 pr-2 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.subtitle && (
                        <div className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {opt.subtitle}
                        </div>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 ml-2" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyMessage?: string;
  isLoading?: boolean;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  emptyMessage = 'No options available.',
  isLoading = false,
  error = null,
  disabled = false,
  required = false
}) => (
  <SearchableSelect
    value={value}
    onChange={onChange}
    options={options}
    placeholder={placeholder}
    emptyMessage={emptyMessage}
    searchable={false}
    isLoading={isLoading}
    error={error}
    disabled={disabled}
    required={required}
  />
);

// 10. SearchableMultiSelect
export interface SearchableMultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  maxHeight?: string;
}

export const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  values,
  onChange,
  options,
  searchPlaceholder = 'Search to select...',
  emptyMessage = 'No items found.',
  disabled = false,
  maxHeight = 'max-h-56'
}) => {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? options.filter(
        o =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.value.toLowerCase().includes(query.toLowerCase()) ||
          (o.subtitle && o.subtitle.toLowerCase().includes(query.toLowerCase()))
      )
    : options;

  const toggle = (val: string) => {
    if (disabled) return;
    if (values.includes(val)) {
      onChange(values.filter(v => v !== val));
    } else {
      onChange([...values, val]);
    }
  };

  const selectAll = () => {
    if (disabled) return;
    const filteredVals = filtered.map(o => o.value);
    const combined = Array.from(new Set([...values, ...filteredVals]));
    onChange(combined);
  };

  const clearSelection = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            disabled={disabled}
            className="w-full h-9 pl-9 pr-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[13.5px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 text-[13px]">
          <span className="font-medium text-slate-600 dark:text-slate-300 tabular-nums">
            {values.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={disabled || filtered.length === 0}
              className="text-blue-600 dark:text-blue-400 font-medium hover:underline disabled:opacity-50"
            >
              Select All
            </button>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button
              type="button"
              onClick={clearSelection}
              disabled={disabled || values.length === 0}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium hover:underline disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className={`${maxHeight} overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 p-1`}>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-[14px] text-slate-500 dark:text-slate-400">
            {emptyMessage}
          </div>
        ) : (
          filtered.map(opt => {
            const isChecked = values.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  isChecked
                    ? 'bg-blue-50/60 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(opt.value)}
                  disabled={disabled}
                  className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-slate-900 dark:text-white truncate">
                    {opt.label}
                  </div>
                  {opt.subtitle && (
                    <div className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {opt.subtitle}
                    </div>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
};

// 11. DetailCard
interface DetailCardProps {
  title: string;
  items: { label: string; value: React.ReactNode }[];
}

export const DetailCard: React.FC<DetailCardProps> = ({ title, items }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
    <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white mb-4">{title}</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-[14.5px]">
      {items.map((item, idx) => (
        <div key={idx}>
          <span className="text-[13px] text-slate-500 dark:text-slate-400 block">{item.label}</span>
          <div className="font-medium text-slate-900 dark:text-white mt-0.5">{item.value || '—'}</div>
        </div>
      ))}
    </div>
  </div>
);

// 12. ConfirmDialog & useConfirmAction
export type ConfirmVariant = 'danger' | 'warning' | 'primary' | 'success';

export interface ConfirmDetailItem {
  label: string;
  value: React.ReactNode;
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  message: string | React.ReactNode;
  consequence?: string | React.ReactNode;
  details?: ConfirmDetailItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  isLoading?: boolean;
  errorMessage?: string | null;
  confirmChallengeText?: string;
  confirmChallengePlaceholder?: string;
  icon?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  subtitle,
  message,
  consequence,
  details,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
  variant = 'primary',
  isLoading = false,
  errorMessage = null,
  confirmChallengeText,
  confirmChallengePlaceholder,
  icon
}) => {
  const [challengeInput, setChallengeInput] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setChallengeInput('');
      // Autofocus cancel button on dialog open to guard against accidental Enter presses
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isChallengeRequired = Boolean(confirmChallengeText && confirmChallengeText.trim().length > 0);
  const isChallengeMet =
    !isChallengeRequired ||
    challengeInput.trim().toUpperCase() === confirmChallengeText!.trim().toUpperCase();

  // Variant themes & icons
  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: icon || <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />,
          iconBg: 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400',
          btnBg: 'bg-red-600 hover:bg-red-700 active:bg-red-800 focus:ring-red-500 shadow-sm shadow-red-500/20 text-white',
          consequenceBg: 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300'
        };
      case 'warning':
        return {
          icon: icon || <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
          iconBg: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400',
          btnBg: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 focus:ring-amber-500 shadow-sm shadow-amber-500/20 text-white',
          consequenceBg: 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300'
        };
      case 'success':
        return {
          icon: icon || <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
          iconBg: 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400',
          btnBg: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 focus:ring-emerald-500 shadow-sm shadow-emerald-500/20 text-white',
          consequenceBg: 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
        };
      case 'primary':
      default:
        return {
          icon: icon || <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
          iconBg: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400',
          btnBg: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus:ring-blue-500 shadow-sm shadow-blue-500/20 text-white',
          consequenceBg: 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-800 dark:text-blue-300'
        };
    }
  };

  const style = getVariantStyles();

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isLoading) onCancel();
      }}
      title={
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${style.iconBg}`}>
            {style.icon}
          </div>
          <span className="truncate">{title}</span>
        </div>
      }
      subtitle={subtitle}
      size="compact"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-[14.5px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading || !isChallengeMet}
            className={`h-10 px-5 rounded-lg text-[14.5px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 inline-flex items-center justify-center gap-2 ${style.btnBg}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Processing...</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Main Message */}
        <div className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
          {message}
        </div>

        {/* Structured Entity Details Grid */}
        {details && details.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[13.5px]">
            {details.map((item, idx) => (
              <div key={idx} className="min-w-0">
                <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400 block truncate">
                  {item.label}
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate mt-0.5">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Consequence / High-Stakes Impact Notice */}
        {consequence && (
          <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-[13.5px] leading-relaxed ${style.consequenceBg}`}>
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold block mb-0.5">Important Notice</span>
              {consequence}
            </div>
          </div>
        )}

        {/* Type-to-Confirm Challenge */}
        {isChallengeRequired && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
            <label className="text-[13px] font-medium text-slate-700 dark:text-slate-300 block">
              To confirm this action, please type{' '}
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-red-600 dark:text-red-400">
                {confirmChallengeText}
              </span>{' '}
              below:
            </label>
            <input
              type="text"
              value={challengeInput}
              onChange={e => setChallengeInput(e.target.value)}
              placeholder={confirmChallengePlaceholder || `Type "${confirmChallengeText}" to proceed`}
              disabled={isLoading}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[14px] outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
            />
          </div>
        )}

        {/* Async Execution Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300 text-[13.5px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export interface ConfirmActionOptions {
  title: string;
  message: string | React.ReactNode;
  subtitle?: string;
  consequence?: string | React.ReactNode;
  details?: ConfirmDetailItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  confirmChallengeText?: string;
  confirmChallengePlaceholder?: string;
  icon?: React.ReactNode;
  action: () => Promise<void> | void;
}

export function useConfirmAction() {
  const [dialogState, setDialogState] = useState<ConfirmActionOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const confirmAction = (options: ConfirmActionOptions) => {
    setErrorMessage(null);
    setDialogState(options);
  };

  const closeDialog = () => {
    if (!isLoading) {
      setDialogState(null);
      setErrorMessage(null);
    }
  };

  const handleConfirm = async () => {
    if (!dialogState || isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await dialogState.action();
      setDialogState(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'The requested action could not be completed.');
    } finally {
      setIsLoading(false);
    }
  };

  const ConfirmModal: React.FC = () => {
    if (!dialogState) return null;
    return (
      <ConfirmDialog
        isOpen={!!dialogState}
        title={dialogState.title}
        subtitle={dialogState.subtitle}
        message={dialogState.message}
        consequence={dialogState.consequence}
        details={dialogState.details}
        confirmLabel={dialogState.confirmLabel || 'Yes'}
        cancelLabel={dialogState.cancelLabel || 'No'}
        variant={dialogState.variant || 'primary'}
        confirmChallengeText={dialogState.confirmChallengeText}
        confirmChallengePlaceholder={dialogState.confirmChallengePlaceholder}
        icon={dialogState.icon}
        errorMessage={errorMessage}
        isLoading={isLoading}
        onCancel={closeDialog}
        onConfirm={handleConfirm}
      />
    );
  };

  return {
    confirmAction,
    closeDialog,
    ConfirmModal,
    isConfirming: isLoading
  };
}

// ============================================================
// SHARED DETAIL MODALS FOR EXAMS, QUESTIONS, RESULTS, QUERIES
// ============================================================

export const QuestionDetailModal: React.FC<{
  question: Question | null;
  onClose: () => void;
}> = ({ question, onClose }) => {
  if (!question) return null;
  return (
    <Modal
      isOpen={!!question}
      onClose={onClose}
      title="Question Details"
      subtitle={`Question ID: ${question.questionId || question.id}`}
      size="standard"
    >
      <div className="space-y-5">
        <ScrollReveal className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Subject</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {question.subject || question.topic}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Topic / Unit</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {question.topic || 'General'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Difficulty</span>
            <StatusBadge status={question.difficulty} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Marks / Negative</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {question.marks ?? 1} / -{question.negativeMarks ?? 0}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Question Type</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {question.questionType || 'MCQ'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Source</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {question.source || 'MANUAL'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Status</span>
            <StatusBadge status={question.status || 'APPROVED'} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Created By</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {question.createdByName || question.createdBy || 'Faculty'}
            </span>
          </div>
        </ScrollReveal>

        <ScrollReveal>
          <h4 className="text-[14px] font-medium text-slate-500 mb-2">
            Question Statement
          </h4>
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[15px] font-medium text-slate-900 dark:text-white leading-relaxed">
            {question.text}
          </div>
        </ScrollReveal>

        <ScrollReveal>
          <h4 className="text-[14px] font-medium text-slate-500 mb-2">
            Options & Correct Answer
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {question.options.map((opt, idx) => {
              const isCorrect = idx === question.correctAnswer;
              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-lg border text-[14.5px] flex items-center justify-between ${
                    isCorrect
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-medium'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>
                    {String.fromCharCode(65 + idx)}. {opt}
                  </span>
                  {isCorrect && (
                    <span className="text-[12.5px] font-medium px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                      Correct
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollReveal>

        {question.explanation && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">
              Explanation
            </h4>
            <p className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[14.5px] text-slate-700 dark:text-slate-300 leading-relaxed">
              {question.explanation}
            </p>
          </ScrollReveal>
        )}
      </div>
    </Modal>
  );
};

export const ExamDetailModal: React.FC<{
  exam: ScheduledExam | null;
  onClose: () => void;
}> = ({ exam, onClose }) => {
  if (!exam) return null;
  return (
    <Modal
      isOpen={!!exam}
      onClose={onClose}
      title={exam.title}
      subtitle={`Exam ID: ${exam.examId || exam.id}`}
      size="workspace"
    >
      <div className="space-y-5">
        <ScrollReveal className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Subject</span>
            <span className="font-medium text-slate-900 dark:text-white">{exam.subject}</span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Course / Department</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {exam.course} · {exam.department}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Semester</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {exam.semester || exam.academicYear || '—'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Start Time</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {exam.startTime ? new Date(exam.startTime).toLocaleString() : `${exam.scheduledDate} ${exam.startWindow}`}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">End Time</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {exam.endTime ? new Date(exam.endTime).toLocaleString() : `${exam.scheduledDate} ${exam.endWindow}`}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Duration</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {exam.durationMinutes} mins
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Marks (Total / Passing)</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {exam.totalMarks} / {exam.passingMarks}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Assigned Students</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {exam.assignedStudentIds?.length ?? 0}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Status</span>
            <StatusBadge status={exam.status} />
          </div>
        </ScrollReveal>

        {exam.instructions && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">
              Examination Instructions
            </h4>
            <p className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[14.5px] text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
              {exam.instructions}
            </p>
          </ScrollReveal>
        )}
      </div>
    </Modal>
  );
};

export const ResultDetailModal: React.FC<{
  result: StudentResult | null;
  onClose: () => void;
  onPublish?: (resultId: string) => void;
  canPublish?: boolean;
}> = ({ result, onClose, onPublish, canPublish }) => {
  if (!result) return null;
  const rId = result.resultId || result.id;
  const isPublished = result.status === 'PUBLISHED' || result.isPublished;

  const breakdown = result.questionBreakdown || (result as any).answerBreakdown || [];
  const correctCount =
    result.correctCount !== undefined
      ? result.correctCount
      : breakdown.length > 0
      ? breakdown.filter((q: any) => q.isCorrect).length
      : undefined;
  const wrongCount =
    result.wrongCount !== undefined
      ? result.wrongCount
      : breakdown.length > 0
      ? breakdown.filter((q: any) => !q.isCorrect && q.selectedOption).length
      : undefined;
  const unansweredCount =
    result.unansweredCount !== undefined
      ? result.unansweredCount
      : breakdown.length > 0
      ? breakdown.filter((q: any) => !q.selectedOption).length
      : undefined;

  return (
    <Modal
      isOpen={!!result}
      onClose={onClose}
      title="Examination Result Details"
      subtitle={`Result ID: ${rId}`}
      size="workspace"
    >
      <div className="space-y-5">
        {/* Numerical Summary KSI Cards */}
        <ScrollReveal className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Obtained Marks"
            value={result.score}
            subValue="Marks earned"
          />
          <KpiCard
            label="Total Marks"
            value={result.totalMarks || result.totalQuestions}
            subValue="Max possible"
          />
          <KpiCard
            label="Percentage"
            value={`${result.percentage ?? result.accuracy ?? 0}%`}
            subValue={result.grade ? `Grade: ${result.grade}` : result.passed !== false ? 'Qualified' : 'Failed'}
          />
          <KpiCard
            label="Correct"
            value={correctCount !== undefined ? correctCount : '—'}
            subValue="Right answers"
          />
          <KpiCard
            label="Incorrect"
            value={wrongCount !== undefined ? wrongCount : '—'}
            subValue="Wrong answers"
          />
          <KpiCard
            label="Unanswered"
            value={unansweredCount !== undefined ? unansweredCount : '—'}
            subValue="Skipped questions"
          />
        </ScrollReveal>

        <ScrollReveal className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Student</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {result.studentName}
            </span>
            <span className="text-[13px] font-mono text-slate-500 block tabular-nums">
              {result.studentId}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Exam</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {result.examTitle || result.subject || result.topic}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Integrity Score</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {result.integrityScore ?? 100}% ({result.violations ?? 0} alerts)
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Status</span>
            <StatusBadge status={isPublished ? 'PUBLISHED' : 'PENDING'} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Evaluated Date</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {result.date}
            </span>
          </div>
          {result.attemptId && (
            <div>
              <span className="text-[13px] text-slate-500 block">Attempt ID</span>
              <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 block tabular-nums">
                {result.attemptId}
              </span>
            </div>
          )}
        </ScrollReveal>

        {result.questionBreakdown && result.questionBreakdown.length > 0 && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">
              Question Breakdown ({result.questionBreakdown.length})
            </h4>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3 px-4 text-[13.5px] font-semibold">Question</th>
                    <th className="py-3 px-4 text-[13.5px] font-semibold">Outcome</th>
                    <th className="py-3 px-4 text-[13.5px] font-semibold text-right">Marks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {result.questionBreakdown.map((qb, i) => (
                    <tr key={i}>
                      <td className="py-3 px-4 text-[14px] text-slate-800 dark:text-slate-200">
                        {qb.questionText}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={qb.isCorrect ? 'APPROVED' : 'REJECTED'} />
                      </td>
                      <td className="py-3 px-4 text-[14px] text-right font-medium tabular-nums">
                        {qb.marksAwarded} / {qb.marksPossible}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollReveal>
        )}

        {canPublish && !isPublished && onPublish && (
          <ScrollReveal className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                onPublish(rId);
                onClose();
              }}
              className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center"
            >
              Publish Result
            </button>
          </ScrollReveal>
        )}
      </div>
    </Modal>
  );
};

export const QueryDetailModal: React.FC<{
  query: StudentQuery | null;
  onClose: () => void;
  onResolve?: (
    queryId: string,
    payload: {
      resolutionType: NonNullable<StudentQuery['resolutionType']>;
      resolutionNotes: string;
      scoreAdjustment?: number;
      correctedAnswer?: string;
    }
  ) => Promise<void> | void;
}> = ({ query, onClose, onResolve }) => {
  const [resolutionType, setResolutionType] =
    useState<NonNullable<StudentQuery['resolutionType']>>('VALID_QUESTION');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [correctedAnswer, setCorrectedAnswer] = useState('');
  const [graceMarks, setGraceMarks] = useState('1');
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  useEffect(() => {
    setResolutionType('VALID_QUESTION');
    setResolutionNotes('');
    setCorrectedAnswer('');
    setGraceMarks('1');
    setResolutionError(null);
  }, [query?.queryId]);

  if (!query) return null;
  const qId = query.queryId || query.id;
  const unresolved = query.status === 'PENDING' || query.status === 'UNDER_REVIEW' || query.status === 'OPEN';
  return (
    <Modal
      isOpen={!!query}
      onClose={onClose}
      title="Academic Query Details"
      subtitle={`Query ID: ${qId}`}
      size="standard"
    >
      <div className="space-y-5">
        <ScrollReveal className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Student</span>
            <span className="font-medium text-slate-900 dark:text-white">{query.studentName}</span>
            <span className="text-[13px] font-mono text-slate-500 block tabular-nums">
              {query.studentId}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Subject / Exam</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {query.examTitle || query.subject || query.topic}
            </span>
            <span className="block font-mono text-[12px] text-slate-500">{query.examId}</span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Status</span>
            <StatusBadge status={query.status} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Submitted</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {query.createdAt || query.timestamp}
            </span>
          </div>
          {query.attemptId && (
            <div>
              <span className="text-[13px] text-slate-500 block">Attempt Reference</span>
              <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 block tabular-nums">
                {query.attemptId}
              </span>
            </div>
          )}
          {query.questionId && (
            <div>
              <span className="text-[13px] text-slate-500 block">Question ID</span>
              <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 block tabular-nums">
                {query.questionId}
              </span>
            </div>
          )}
          {query.questionNumber ? (
            <div>
              <span className="text-[13px] text-slate-500 block">Question Number</span>
              <span className="font-medium text-slate-900 dark:text-white">Question {query.questionNumber}</span>
            </div>
          ) : null}
          <div>
            <span className="text-[13px] text-slate-500 block">Issue Category</span>
            <span className="font-medium text-slate-900 dark:text-white">{query.reasonType.replaceAll('_', ' ')}</span>
          </div>
        </ScrollReveal>

        {query.questionText && query.questionText !== (query.description || query.question || query.message) && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">
              Question Context
            </h4>
            <p className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed">
              {query.questionText}
            </p>
          </ScrollReveal>
        )}

        {query.options && query.options.length > 0 && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">Question Options</h4>
            <ol className="space-y-2">
              {query.options.map(option => (
                <li key={option.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[14px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <span className="mr-2 font-semibold">{option.id}.</span>{option.text}
                  {query.studentAnswer === option.id && (
                    <span className="ml-2 text-[12px] font-semibold text-blue-600 dark:text-blue-400">Student selected</span>
                  )}
                </li>
              ))}
            </ol>
          </ScrollReveal>
        )}

        {query.studentAnswer && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">Student's Selected Answer</h4>
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-[14px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
              {query.options?.find(option => option.id === query.studentAnswer)?.text || query.studentAnswer}
            </p>
          </ScrollReveal>
        )}

        <ScrollReveal>
          <h4 className="text-[14px] font-medium text-slate-500 mb-2">
            Student Query
          </h4>
          <p className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[15px] text-slate-800 dark:text-slate-200 leading-relaxed">
            {query.description || query.question || query.message}
          </p>
        </ScrollReveal>

        {(query.response || query.reply) && (
          <ScrollReveal>
            <h4 className="text-[14px] font-medium text-slate-500 mb-2">
              Faculty / Admin Response
            </h4>
            <p className="p-4 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-[15px] text-slate-800 dark:text-slate-200 leading-relaxed">
              {query.response || query.reply}
            </p>
          </ScrollReveal>
        )}

        {onResolve && unresolved && (
          <ScrollReveal className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white">Faculty Resolution</h4>
            <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
              Resolution
              <select
                value={resolutionType}
                onChange={event => setResolutionType(event.target.value as NonNullable<StudentQuery['resolutionType']>)}
                className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="VALID_QUESTION">Valid Question</option>
                <option value="OUT_OF_SYLLABUS">Out of Syllabus</option>
                <option value="INVALID_QUESTION">Invalid Question</option>
                <option value="CORRECT_ANSWER_CHANGED">Correct Answer Changed</option>
                <option value="GRACE_MARKS">Grace Marks</option>
                <option value="EXCLUDE_QUESTION">Exclude Question</option>
              </select>
            </label>
            {resolutionType === 'CORRECT_ANSWER_CHANGED' && (
              <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
                Correct answer option
                <select
                  value={correctedAnswer}
                  onChange={event => setCorrectedAnswer(event.target.value)}
                  className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">Select the correct option</option>
                  {(query.options || []).map(option => (
                    <option key={option.id} value={option.id}>{option.id}. {option.text}</option>
                  ))}
                </select>
              </label>
            )}
            {resolutionType === 'GRACE_MARKS' && (
              <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
                Grace marks
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={graceMarks}
                  onChange={event => setGraceMarks(event.target.value)}
                  className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </label>
            )}
            <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
              Resolution notes
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={event => setResolutionNotes(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-3 text-[14px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </label>
            {resolutionError && <p role="alert" className="text-[13px] text-rose-600">{resolutionError}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={isResolving || (resolutionType === 'CORRECT_ANSWER_CHANGED' && !correctedAnswer) || (resolutionType === 'GRACE_MARKS' && !Number.isFinite(Number(graceMarks)))}
                onClick={async () => {
                  setIsResolving(true);
                  setResolutionError(null);
                  try {
                    await onResolve(qId, {
                      resolutionType,
                      resolutionNotes,
                      correctedAnswer: resolutionType === 'CORRECT_ANSWER_CHANGED' ? correctedAnswer : undefined,
                      scoreAdjustment: resolutionType === 'GRACE_MARKS' ? Number(graceMarks) : undefined
                    });
                    onClose();
                  } catch (error: any) {
                    setResolutionError(error?.message || 'Unable to save the faculty resolution.');
                  } finally {
                    setIsResolving(false);
                  }
                }}
                className="h-10 rounded-lg bg-blue-600 px-4 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isResolving ? 'Saving...' : 'Save Resolution'}
              </button>
            </div>
          </ScrollReveal>
        )}
      </div>
    </Modal>
  );
};

export const ProctoringDetailModal: React.FC<{
  event: ProctoringEventRecord | null;
  onClose: () => void;
  onTerminateAttempt?: (attemptId: string, studentName?: string) => void;
}> = ({ event, onClose, onTerminateAttempt }) => {
  if (!event) return null;
  return (
    <Modal
      isOpen={!!event}
      onClose={onClose}
      title="Proctoring Incident Details"
      subtitle={`Incident Event ID: ${event.eventId}`}
      size="standard"
      footer={
        <div className="flex items-center justify-between w-full">
          {onTerminateAttempt && event.attemptId ? (
            <button
              type="button"
              onClick={() => onTerminateAttempt(event.attemptId!, event.studentName || event.studentId)}
              className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-[14px] font-medium inline-flex items-center gap-2 shadow-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Terminate Attempt</span>
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Student</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {event.studentName || event.studentId}
            </span>
            <span className="text-[13px] font-mono text-slate-500 block tabular-nums">
              {event.studentId}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Examination</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {event.examTitle || event.examId}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Incident Type</span>
            <span className="font-medium text-slate-900 dark:text-white">{event.eventType}</span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Severity</span>
            <StatusBadge status={event.severity} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Recorded At</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {new Date(event.timestamp).toLocaleString()}
            </span>
          </div>
          {event.attemptId && (
            <div>
              <span className="text-[13px] text-slate-500 block">Attempt Reference</span>
              <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 block tabular-nums">
                {event.attemptId}
              </span>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-[14px] font-medium text-slate-500 mb-1.5">Telemetry & Details</h4>
          <p className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[14.5px] text-slate-800 dark:text-slate-200 leading-relaxed">
            {event.details}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export const AuditDetailModal: React.FC<{
  log: AuditLog | null;
  onClose: () => void;
}> = ({ log, onClose }) => {
  if (!log) return null;
  return (
    <Modal
      isOpen={!!log}
      onClose={onClose}
      title="Audit Trail Log Details"
      subtitle={`Log ID: ${log.logId || log.id}`}
      size="standard"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[14px]">
          <div>
            <span className="text-[13px] text-slate-500 block">Action</span>
            <span className="font-semibold text-slate-900 dark:text-white">{log.action}</span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Target Resource</span>
            <span className="font-medium text-slate-900 dark:text-white">{log.targetResource}</span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Actor ID</span>
            <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 tabular-nums">
              {log.actorId || 'SYSTEM'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Actor Role</span>
            <StatusBadge status={log.actorRole || 'SYSTEM'} />
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">IP Address</span>
            <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300 tabular-nums">
              {log.ipAddress || '—'}
            </span>
          </div>
          <div>
            <span className="text-[13px] text-slate-500 block">Timestamp</span>
            <span className="font-medium text-slate-900 dark:text-white tabular-nums">
              {new Date(log.timestamp).toLocaleString()}
            </span>
          </div>
        </div>

        {log.details && (
          <div>
            <h4 className="text-[14px] font-medium text-slate-500 mb-1.5">Action Details & Metadata</h4>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[13.5px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap max-h-60 overflow-y-auto">
              {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
