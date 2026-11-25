'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { formatAverage, plural, shortDate } from '@/lib/ratings/client';
import type { TrendPoint } from '@/lib/ratings/logic';

const H = 168;
const PAD = { left: 28, right: 12, top: 12, bottom: 28 };

/**
 * Weekly average rating (1–5) as one line. Weeks without ratings leave a gap
 * rather than dropping to zero. Hover or tap a week for its values; the same
 * numbers are available as a table.
 */
export default function RatingTrendChart({
    points,
    color,
    label,
    ariaLabel,
}: {
    points: TrendPoint[];
    /** A CSS colour, e.g. var(--color-series-dish). */
    color: string;
    /** What is averaged, e.g. "Dishes". */
    label: string;
    ariaLabel: string;
}) {
    const { t, locale } = useLocale();
    const [active, setActive] = useState<number | null>(null);
    // Drawn at the container's real width, so labels stay 11px on phones and desktops alike.
    const frame = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(320);
    useEffect(() => {
        const el = frame.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const n = points.length;
    const step = (W - PAD.left - PAD.right) / Math.max(1, n - 1);
    const x = (i: number) => PAD.left + i * step;
    const y = (v: number) => PAD.top + ((5 - v) / 4) * (H - PAD.top - PAD.bottom);

    /** Line segments that skip weeks with no value. */
    let d = '';
    let open = false;
    points.forEach((p, i) => {
        if (p.average === null) {
            open = false;
            return;
        }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.average).toFixed(1)}`;
        open = true;
    });

    const latest = [...points].reverse().find(p => p.average !== null)?.average ?? null;
    const labelled = n > 0 ? [0, Math.floor((n - 1) / 2), n - 1] : [];
    const tip = active !== null ? points[active] : null;

    return (
        <div>
            {/* Legend, carrying the latest value so identity never rests on colour alone. */}
            <p className="mb-2 inline-flex items-center gap-2 text-sm text-ink">
                <svg width="22" height="10" aria-hidden="true">
                    <line x1="1" x2="21" y1="5" y2="5" stroke={color} strokeWidth={2} strokeLinecap="round" />
                </svg>
                {t('ratings.my.latestWeek', { label })} <span className="font-semibold tabular-nums">{formatAverage(latest)}</span>
            </p>

            <div ref={frame} className="relative" onMouseLeave={() => setActive(null)}>
                <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={ariaLabel}>
                    {[1, 2, 3, 4, 5].map(v => (
                        <g key={v}>
                            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
                            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-subtle)">{v}</text>
                        </g>
                    ))}
                    {labelled.map(i => (
                        <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--color-ink-subtle)">
                            {shortDate(points[i].week, locale)}
                        </text>
                    ))}

                    {tip && active !== null && (
                        <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-line-strong)" strokeWidth={1} />
                    )}

                    <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {points.map((p, i) =>
                        p.average !== null ? <circle key={p.week} cx={x(i)} cy={y(p.average)} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} /> : null,
                    )}

                    {/* Hit targets: a full-height band per week, wider than the marks. */}
                    {points.map((p, i) => (
                        <rect
                            key={`hit-${p.week}`}
                            x={x(i) - step / 2}
                            y={PAD.top}
                            width={step}
                            height={H - PAD.top - PAD.bottom}
                            fill="transparent"
                            onMouseEnter={() => setActive(i)}
                            onClick={() => setActive(i)}
                        />
                    ))}
                </svg>

                {tip && active !== null && (
                    <div
                        className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-raised"
                        style={{
                            left: `${(x(active) / W) * 100}%`,
                            transform: active > n / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
                        }}
                    >
                        <p className="font-semibold text-ink">{t('ratings.my.weekOf', { date: shortDate(tip.week, locale) })}</p>
                        {tip.count === 0 ? (
                            <p className="mt-1 text-ink-muted">{t('ratings.my.noRatingsWeek')}</p>
                        ) : (
                            <>
                                <p className="mt-1 text-ink">{label}: <span className="font-semibold tabular-nums">{formatAverage(tip.average)}</span></p>
                                <p className="mt-1 text-ink-muted">{plural(t, 'ratings.countRatings', tip.count)}</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-semibold text-accent-strong">{t('ratings.my.showTable')}</summary>
                <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-xs text-ink-muted">
                        <tr>
                            <th className="py-1 font-medium">{t('ratings.my.week')}</th>
                            <th className="py-1 font-medium">{t('ratings.my.averageColumn')}</th>
                            <th className="py-1 text-right font-medium">{t('ratings.my.ratingsColumn')}</th>
                        </tr>
                    </thead>
                    <tbody className="tabular-nums text-ink">
                        {points.map(p => (
                            <tr key={p.week} className="border-t border-line">
                                <td className="py-1">{shortDate(p.week, locale)}</td>
                                <td className="py-1">{formatAverage(p.average)}</td>
                                <td className="py-1 text-right">{p.count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </div>
    );
}
