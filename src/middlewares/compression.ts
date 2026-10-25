import compression from 'compression';

/**
 * Compresses responses larger than 1 KB. The road segments collection is several
 * megabytes of JSON text, and compressed it is a fraction of that size.
 */
export const compressionMiddleware = compression({ threshold: 1024 });
