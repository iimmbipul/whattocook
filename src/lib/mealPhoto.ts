/**
 * Shared (client + server) shape of a meal photo resolved from Unsplash,
 * plus helpers to build sized image URLs.
 *
 * Unsplash requires hotlinking: images are always loaded from the URLs the
 * API returns (images.unsplash.com), never downloaded or re-hosted. Sizing is
 * done with Unsplash's own imgix parameters on the `raw` URL.
 */
export interface MealPhoto {
    id: string;
    /** `urls.raw` from the API; append imgix params to size it. */
    raw: string;
    /** Dominant colour, used as the placeholder background while loading. */
    color: string | null;
    alt: string | null;
    photographer: string;
    /** Photographer profile, with Unsplash's required UTM parameters. */
    photographerUrl: string;
    /** unsplash.com link, with UTM parameters, for the "on Unsplash" credit. */
    unsplashUrl: string;
}

/** Normalised lookup key for a meal name ("  Paneer  Tikka " → "paneer tikka"). */
export function mealNameKey(name: string): string {
    return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

/** Cropped, format-negotiated Unsplash image URL for a square-ish box. */
export function photoSrc(photo: MealPhoto, width: number, height: number, dpr: 1 | 2 = 1): string {
    const params = new URLSearchParams({
        w: String(width),
        h: String(height),
        fit: 'crop',
        crop: 'entropy',
        auto: 'format',
        q: '70',
        dpr: String(dpr),
    });
    return `${photo.raw}${photo.raw.includes('?') ? '&' : '?'}${params.toString()}`;
}
