import { isUuid } from './uuid.js';

/** Where a page of trips ends: the start time and the id of its last trip. */
export interface TripCursor {
  startedAt: Date;
  id: string;
}

/**
 * The cursor as the text the phone sends back to get the next page. It is base64url of
 * "start|id": opaque to the phone, and checked when it comes back, so a made-up cursor is
 * refused and never reaches a query.
 */
export function encodeCursor(cursor: TripCursor): string {
  return Buffer.from(`${cursor.startedAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

/** The cursor in a text, or null if the text is not one this server made. */
export function decodeCursor(text: string): TripCursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(text)) {
    return null;
  }
  const [isoDate, id, ...extra] = Buffer.from(text, 'base64url').toString('utf8').split('|');
  if (isoDate === undefined || id === undefined || extra.length > 0 || !isUuid(id)) {
    return null;
  }
  const startedAt = new Date(isoDate);
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== isoDate) {
    return null;
  }
  return { startedAt, id };
}
