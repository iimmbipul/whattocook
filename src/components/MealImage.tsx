'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { photoSrc } from '@/lib/mealPhoto';
import { isBrokenImageUrl, markBrokenImageUrl, peekMealPhoto, useMealPhoto, useMealPhotoCacheVersion, useUsableImageUrl } from '@/lib/mealPhotoCache';
import type { MealPhoto } from '@/lib/mealPhoto';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';

interface MealImageProps {
    /** Meal name used to find a matching photo (use the canonical, untranslated name). */
    mealName: string;
    /**
     * A manually set image URL; takes precedence over the automatic photo.
     * If it fails to load, the automatic photo is used instead.
     */
    imageUrl?: string;
    /** Rendered size in CSS pixels; the image is requested at 1x and 2x of this. */
    size: number;
    /** Shown while there's no image, and if loading fails (e.g. a meal emoji). */
    fallback?: ReactNode;
    alt?: string;
    className?: string;
}

/**
 * Square food photo for a meal. Looks the dish up on Unsplash (via the
 * server, with caching) once it is near the viewport, shows the photo's
 * colour as a placeholder, fades the image in, and falls back to `fallback`
 * when there is no photo or it fails to load — never a broken image icon.
 */
export default function MealImage({ mealName, imageUrl: requestedUrl, size, fallback, alt = '', className }: MealImageProps) {
    const { t } = useLocale();
    // A hand-set URL that already failed in this browser is skipped, so the
    // automatic photo is used instead (many stored meals have dead links).
    const imageUrl = useUsableImageUrl(requestedUrl);
    const boxRef = useRef<HTMLSpanElement>(null);
    const [nearViewport, setNearViewport] = useState(
        () => typeof window !== 'undefined' && !('IntersectionObserver' in window),
    );
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    // Only look the photo up when the box is about to scroll into view.
    useEffect(() => {
        if (imageUrl || nearViewport) return;
        const el = boxRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (items) => {
                if (items.some(i => i.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '300px' },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [imageUrl, nearViewport]);

    const entry = useMealPhoto(imageUrl ? undefined : mealName, { enabled: nearViewport });
    const photo = imageUrl ? null : entry?.photo ?? null;

    const src = imageUrl || (photo ? photoSrc(photo, size, size, 1) : null);
    const srcSet = photo ? `${photoSrc(photo, size, size, 1)} 1x, ${photoSrc(photo, size, size, 2)} 2x` : undefined;
    const usable = !!src && failedSrc !== src;
    const loaded = usable && loadedSrc === src;

    return (
        <span
            ref={boxRef}
            className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-surface-muted', className)}
            style={{ width: size, height: size, backgroundColor: photo?.color && !loaded ? `${photo.color}33` : undefined }}
            title={photo ? `${t('mealImage.photoBy')} ${photo.photographer} ${t('mealImage.on')} Unsplash` : undefined}
        >
            {!loaded && (
                <span className="select-none leading-none" aria-hidden="true">{fallback}</span>
            )}
            {usable && (
                // Hotlinked from Unsplash's CDN (required by their API guidelines),
                // so a plain <img> rather than next/image's optimiser proxy.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={src}
                    src={src}
                    srcSet={srcSet}
                    alt={alt}
                    width={size}
                    height={size}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setLoadedSrc(src)}
                    onError={() => {
                        // A dead hand-set link: remember it and switch to the automatic photo.
                        if (imageUrl && src === imageUrl) markBrokenImageUrl(imageUrl);
                        else setFailedSrc(src);
                    }}
                    className={cn(
                        'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
                        loaded ? 'opacity-100' : 'opacity-0',
                    )}
                />
            )}
        </span>
    );
}

/**
 * "Photo by <name> on Unsplash" — required attribution, with profile links.
 * Shown only while the Unsplash photo is the one displayed (not a working
 * hand-set `imageUrl`).
 */
export function MealPhotoCredit({ mealName, imageUrl, className }: { mealName: string; imageUrl?: string; className?: string }) {
    const { t } = useLocale();
    const manualUrl = useUsableImageUrl(imageUrl);
    const entry = useMealPhoto(mealName, { enabled: false });
    const photo = entry?.photo;
    if (!photo || manualUrl) return null;
    const link = 'font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline';
    return (
        <p className={cn('text-[11px] text-ink-subtle', className)}>
            {t('mealImage.photoBy')}{' '}
            <a href={photo.photographerUrl} target="_blank" rel="noopener noreferrer" className={link}>{photo.photographer}</a>{' '}
            {t('mealImage.on')}{' '}
            <a href={photo.unsplashUrl} target="_blank" rel="noopener noreferrer" className={link}>Unsplash</a>
        </p>
    );
}

/**
 * One attribution line for a list of dishes (e.g. My Plates), crediting each
 * photographer whose photo is currently shown, with links to their profiles.
 */
export function MealPhotoCredits({ meals, className }: { meals: { name: string; imageUrl?: string }[]; className?: string }) {
    const { t } = useLocale();
    useMealPhotoCacheVersion(); // re-render as lookups resolve or links break
    const byPhotographer = new Map<string, MealPhoto>();
    for (const meal of meals) {
        if (meal.imageUrl && !isBrokenImageUrl(meal.imageUrl)) continue; // a working hand-set image is shown
        const photo = peekMealPhoto(meal.name)?.photo;
        if (photo && !byPhotographer.has(photo.photographer)) byPhotographer.set(photo.photographer, photo);
    }
    const photos = Array.from(byPhotographer.values());
    if (photos.length === 0) return null;
    const link = 'font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline';
    return (
        <p className={cn('text-[11px] leading-relaxed text-ink-subtle', className)}>
            {t('mealImage.photosBy')}{' '}
            {photos.map((p, i) => (
                <span key={p.photographer}>
                    {i > 0 && ', '}
                    <a href={p.photographerUrl} target="_blank" rel="noopener noreferrer" className={link}>{p.photographer}</a>
                </span>
            ))}{' '}
            {t('mealImage.on')}{' '}
            <a href={photos[0].unsplashUrl} target="_blank" rel="noopener noreferrer" className={link}>Unsplash</a>
        </p>
    );
}
