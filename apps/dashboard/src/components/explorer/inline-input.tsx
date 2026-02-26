import { useEffect, useRef, useState } from 'react';

interface InlineInputProps {
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InlineInput({ defaultValue, onSubmit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && trimmed !== defaultValue) {
        onSubmit(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      className="w-full bg-surface-secondary border border-primary/50 rounded px-1 py-0 text-[13px] text-text-primary outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
    />
  );
}
