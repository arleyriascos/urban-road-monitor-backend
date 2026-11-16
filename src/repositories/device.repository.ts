import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { DevicePlatform } from '../trips/trip-input.js';

/** How many phones one person can have on record. Past that, the one unused for longest is reused. */
export const MAX_DEVICES_PER_USER = 20;

export interface DeviceDescription {
  platform: DevicePlatform;
  browser?: string | undefined;
  label?: string | undefined;
}

export interface DeviceRecord {
  id: string;
  /** True if the device did not exist before this call. */
  created: boolean;
}

/** Reads and writes the devices table. Every time comes from the caller, never from NOW(). */
export class DeviceRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * The device of a person that matches the description (same platform, browser and label),
   * or a new one. Either way its last_seen_at becomes `now`.
   *
   * A person has at most MAX_DEVICES_PER_USER devices: when that many exist and none matches,
   * the one seen longest ago takes the new description, so a client that sends a different
   * label every time cannot fill the table.
   */
  async findOrCreate(
    userId: string,
    description: DeviceDescription,
    now: Date,
  ): Promise<DeviceRecord> {
    const browser = description.browser ?? null;
    const label = description.label ?? null;

    return this.db.$transaction(async (tx) => {
      // One request at a time per person, so two trips that start together agree.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

      const [match] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM devices
        WHERE user_id = ${userId}::uuid
          AND platform = ${description.platform}
          AND browser IS NOT DISTINCT FROM ${browser}
          AND label IS NOT DISTINCT FROM ${label}
        ORDER BY last_seen_at DESC, id
        LIMIT 1`;
      if (match) {
        await tx.devices.update({ where: { id: match.id }, data: { last_seen_at: now } });
        return { id: match.id, created: false };
      }

      const count = await tx.devices.count({ where: { user_id: userId } });
      if (count >= MAX_DEVICES_PER_USER) {
        const oldest = await tx.devices.findFirstOrThrow({
          where: { user_id: userId },
          orderBy: [{ last_seen_at: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        await tx.devices.update({
          where: { id: oldest.id },
          data: { platform: description.platform, browser, label, last_seen_at: now },
        });
        return { id: oldest.id, created: false };
      }

      const created = await tx.devices.create({
        data: {
          user_id: userId,
          platform: description.platform,
          browser,
          label,
          created_at: now,
          last_seen_at: now,
        },
        select: { id: true },
      });
      return { id: created.id, created: true };
    });
  }
}

export const deviceRepository = new DeviceRepository();
