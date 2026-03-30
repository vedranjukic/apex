import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useTourStore, type TourStepId } from '../../stores/tour-store';

type Position = 'top' | 'bottom' | 'left' | 'right';

interface TourTooltipProps {
  targetRef: RefObject<HTMLElement | null>;
  position?: Position;
  title: string;
  description: string;
  stepId: TourStepId;
  onDismiss?: () => void;
}

const GAP = 12;
const ARROW_SIZE = 8;

export function TourTooltip({
  targetRef,
  position = 'bottom',
  title,
  description,
  stepId,
  onDismiss,
}: TourTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [doNotShow, setDoNotShow] = useState(false);
  const dismissStep = useTourStore((s) => s.dismissStep);

  const updatePosition = useCallback(() => {
    const target = targetRef.current;
    const tooltip = tooltipRef.current;
    if (!target || !tooltip) return;

    const tRect = target.getBoundingClientRect();
    setTargetRect(tRect);
    const ttRect = tooltip.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (position) {
      case 'bottom':
        top = tRect.bottom + GAP;
        left = tRect.left + tRect.width / 2 - ttRect.width / 2;
        break;
      case 'top':
        top = tRect.top - ttRect.height - GAP;
        left = tRect.left + tRect.width / 2 - ttRect.width / 2;
        break;
      case 'left':
        top = tRect.top + tRect.height / 2 - ttRect.height / 2;
        left = tRect.left - ttRect.width - GAP;
        break;
      case 'right':
        top = tRect.top + tRect.height / 2 - ttRect.height / 2;
        left = tRect.right + GAP;
        break;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - ttRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - ttRect.height - 8));

    setCoords({ top, left });
  }, [targetRef, position]);

  useEffect(() => {
    updatePosition();

    const frame = { id: 0 };
    const schedule = () => {
      cancelAnimationFrame(frame.id);
      frame.id = requestAnimationFrame(updatePosition);
    };

    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);

    const observer = new ResizeObserver(schedule);
    if (targetRef.current) observer.observe(targetRef.current);

    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer.disconnect();
      cancelAnimationFrame(frame.id);
    };
  }, [updatePosition, targetRef]);

  const handleDismiss = () => {
    if (doNotShow) dismissStep(stepId);
    onDismiss?.();
  };

  const arrowStyle = (): React.CSSProperties => {
    if (!targetRect) return {};
    const s = ARROW_SIZE;
    const base: React.CSSProperties = { position: 'absolute', width: 0, height: 0 };

    switch (position) {
      case 'bottom':
        return {
          ...base,
          top: -s,
          left: '50%',
          transform: 'translateX(-50%)',
          borderLeft: `${s}px solid transparent`,
          borderRight: `${s}px solid transparent`,
          borderBottom: `${s}px solid var(--t-primary)`,
        };
      case 'top':
        return {
          ...base,
          bottom: -s,
          left: '50%',
          transform: 'translateX(-50%)',
          borderLeft: `${s}px solid transparent`,
          borderRight: `${s}px solid transparent`,
          borderTop: `${s}px solid var(--t-primary)`,
        };
      case 'left':
        return {
          ...base,
          top: '50%',
          right: -s,
          transform: 'translateY(-50%)',
          borderTop: `${s}px solid transparent`,
          borderBottom: `${s}px solid transparent`,
          borderLeft: `${s}px solid var(--t-primary)`,
        };
      case 'right':
        return {
          ...base,
          top: '50%',
          left: -s,
          transform: 'translateY(-50%)',
          borderTop: `${s}px solid transparent`,
          borderBottom: `${s}px solid transparent`,
          borderRight: `${s}px solid var(--t-primary)`,
        };
    }
  };

  const highlightStyle = (): React.CSSProperties | null => {
    if (!targetRect) return null;
    const pad = 4;
    return {
      position: 'fixed',
      top: targetRect.top - pad,
      left: targetRect.left - pad,
      width: targetRect.width + pad * 2,
      height: targetRect.height + pad * 2,
      borderRadius: 8,
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
      pointerEvents: 'none' as const,
      zIndex: 9998,
    };
  };

  const hl = highlightStyle();

  return createPortal(
    <>
      {hl && <div style={hl} />}
      <div
        ref={tooltipRef}
        style={coords ? { position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 } : { position: 'fixed', top: -9999, left: -9999, zIndex: 9999 }}
        className={cn(
          'w-72 rounded-xl border-2 border-primary bg-surface p-4 shadow-2xl',
          'animate-in fade-in slide-in-from-bottom-2 duration-200',
        )}
      >
        <div style={arrowStyle()} />

        <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
        <p className="text-xs text-text-secondary leading-relaxed">{description}</p>

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={doNotShow}
              onChange={(e) => setDoNotShow(e.target.checked)}
              className="w-3 h-3 rounded accent-primary"
            />
            <span className="text-[11px] text-text-muted">Do not show again</span>
          </label>

          <button
            onClick={handleDismiss}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
