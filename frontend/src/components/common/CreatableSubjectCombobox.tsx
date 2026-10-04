import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Plus, Search } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface CreatableSubjectComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onError?: (message: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export const CreatableSubjectCombobox: React.FC<CreatableSubjectComboboxProps> = ({
  value,
  onChange,
  onError,
  placeholder = 'Search or create a subject',
  required = false,
  disabled = false
}) => {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    dbService.getSubjects()
      .then((items) => { if (active) setSubjects(items); })
      .catch((error: Error) => {
        if (!active) return;
        setLoadError(error.message || 'Unable to load subjects.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const closeWhenOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener('mousedown', closeWhenOutside);
    return () => document.removeEventListener('mousedown', closeWhenOutside);
  }, [value]);

  const normalizedQuery = normalizeDisplayName(query);
  const matches = useMemo(() => {
    const search = normalizedQuery.toLocaleLowerCase();
    return subjects
      .filter((subject) => !search || subject.toLocaleLowerCase().includes(search))
      .slice(0, 8);
  }, [subjects, normalizedQuery]);
  const exactSubject = subjects.find(
    (subject) => normalizeDisplayName(subject).toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase()
  );

  const chooseSubject = (subject: string) => {
    onChange(subject);
    setQuery(subject);
    setIsOpen(false);
    setLoadError(null);
  };

  const createSubject = async () => {
    if (!normalizedQuery || isSaving) return;
    if (exactSubject) {
      chooseSubject(exactSubject);
      return;
    }
    setIsSaving(true);
    try {
      const subject = await dbService.createSubject(normalizedQuery);
      setSubjects((current) => current.some((item) => item.toLocaleLowerCase() === subject.toLocaleLowerCase())
        ? current.map((item) => item.toLocaleLowerCase() === subject.toLocaleLowerCase() ? subject : item)
        : [...current, subject].sort((left, right) => left.localeCompare(right)));
      chooseSubject(subject);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save subject.';
      setLoadError(message);
      onError?.(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className={`flex h-12 items-center rounded-lg border bg-slate-50 dark:bg-slate-900 ${
        isOpen ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 dark:border-slate-700'
      }`}>
        <Search className="ml-3.5 h-4 w-4 shrink-0 text-slate-400" />
        <input
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          title={query}
          value={query}
          required={required}
          disabled={disabled || isSaving}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsOpen(false);
            if (event.key === 'Enter' && isOpen && normalizedQuery) {
              event.preventDefault();
              void createSubject();
            }
          }}
          className="h-full min-w-[8rem] flex-1 bg-transparent px-3 text-[15px] text-slate-900 outline-none dark:text-white"
        />
        {isSaving ? <Loader2 className="mr-3 h-4 w-4 animate-spin text-slate-400" /> : (
          <ChevronDown className={`mr-3 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </div>
      {isOpen && (
        <div role="listbox" className="absolute z-[90] mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {matches.map((subject) => (
            <button
              key={subject}
              type="button"
              role="option"
              aria-selected={subject === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSubject(subject)}
              className="flex w-full items-start justify-between gap-2 px-3.5 py-2.5 text-left text-[14px] leading-5 text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="min-w-0 whitespace-normal break-words" title={subject}>{subject}</span>
              {subject === value && <Check className="ml-2 h-4 w-4 shrink-0 text-blue-600" />}
            </button>
          ))}
          {normalizedQuery && !exactSubject && (
            <button
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void createSubject()}
              disabled={isSaving}
              className="flex w-full items-start gap-2 border-t border-slate-100 px-3.5 py-2.5 text-left text-[14px] font-medium leading-5 text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 whitespace-normal break-words">Create “{normalizedQuery}”</span>
            </button>
          )}
          {matches.length === 0 && !normalizedQuery && (
            <p className="px-3.5 py-3 text-[13px] text-slate-500">Type a subject to search or create one.</p>
          )}
          {loadError && <p role="alert" className="px-3.5 py-2 text-[12px] text-red-600 dark:text-red-400">{loadError}</p>}
        </div>
      )}
    </div>
  );
};
