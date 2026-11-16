import { z } from 'zod';

/** The platforms the devices table accepts (chk_devices_platform). */
export const DEVICE_PLATFORMS = ['android', 'ios', 'other'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/**
 * What the phone sends to POST /api/trips when the person starts the camera: which device it
 * is and which version of the model runs on it. Nothing else about the person travels here.
 */
export const startTripSchema = z
  .object({
    device: z
      .object({
        platform: z.enum(DEVICE_PLATFORMS),
        /** For example "Chrome 142". */
        browser: text(100).optional(),
        /** A name the person gave the phone, for example "Mi Android". */
        label: text(100).optional(),
      })
      .strict(),
    /** The version of the model that runs on the phone, as model_info.json tells it. */
    modelVersion: text(30),
    /** When the camera started, if the phone's clock should be trusted. Default: now. */
    startedAt: isoDate.optional(),
  })
  .strict();

export type StartTripInput = z.infer<typeof startTripSchema>;
