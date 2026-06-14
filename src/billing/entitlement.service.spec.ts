import { EntitlementService } from './entitlement.service';
import {
  PlanId,
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { FREE_DAILY_UPLOAD_LIMIT } from './plans.config';
import { User } from '../users/entities/user.entity';

/** Build the service with mocked subscription repo + usage counter. */
function makeService(sub: Subscription | null, uploadsToday: number) {
  const subRepo = { findOne: jest.fn().mockResolvedValue(sub) };
  const usage = { todayCount: jest.fn().mockResolvedValue(uploadsToday) };
  return new EntitlementService(subRepo as never, usage as never);
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);
const userWithTrial = (end: Date | null) =>
  ({ id: 'u1', trialEndsAt: end } as unknown as User);

describe('EntitlementService.resolve', () => {
  it('day 3 of trial → full Pro', async () => {
    const ent = await makeService(null, 0).resolve(userWithTrial(daysFromNow(4)));
    expect(ent.isPro).toBe(true);
    expect(ent.plan).toBe(PlanId.PRO);
    expect(ent.status).toBe(SubscriptionStatus.TRIALING);
    expect(ent.dailyUploadLimit).toBeNull(); // unlimited
    expect(ent.features.unlimitedScans).toBe(true);
    expect(ent.canSnap).toBe(true);
  });

  it('day 8 (trial expired, no subscription) → Free, EXPIRED, 1 scan/day', async () => {
    const ent = await makeService(null, 0).resolve(userWithTrial(daysFromNow(-1)));
    expect(ent.isPro).toBe(false);
    expect(ent.plan).toBe(PlanId.FREE);
    expect(ent.status).toBe(SubscriptionStatus.EXPIRED);
    expect(ent.dailyUploadLimit).toBe(FREE_DAILY_UPLOAD_LIMIT); // 1
    expect(ent.features.unlimitedScans).toBe(false);
    expect(ent.features.lhdnTagging).toBe(false);
    expect(ent.trialDaysLeft).toBe(0);
    expect(ent.canSnap).toBe(true); // 0 used today < 1
  });

  it('day 8 free user who already used today’s scan → cannot snap', async () => {
    const ent = await makeService(null, 1).resolve(userWithTrial(daysFromNow(-1)));
    expect(ent.isPro).toBe(false);
    expect(ent.canSnap).toBe(false); // 1 used >= limit 1
  });

  it('expired trial but active paid subscription → Pro', async () => {
    const sub = {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: daysFromNow(20),
    } as unknown as Subscription;
    const ent = await makeService(sub, 5).resolve(userWithTrial(daysFromNow(-30)));
    expect(ent.isPro).toBe(true);
    expect(ent.plan).toBe(PlanId.PRO);
    expect(ent.dailyUploadLimit).toBeNull();
    expect(ent.canSnap).toBe(true); // unlimited despite 5 used
  });
});
