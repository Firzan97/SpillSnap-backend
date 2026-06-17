import { EntitlementService } from './entitlement.service';
import {
  PlanId,
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { DEFAULT_LIMITS } from './plans.config';
import { User } from '../users/entities/user.entity';

/** Build the service with mocked subscription repo + usage counter + limits. */
function makeService(sub: Subscription | null, uploadsThisMonth: number) {
  const subRepo = { findOne: jest.fn().mockResolvedValue(sub) };
  const usage = { monthCount: jest.fn().mockResolvedValue(uploadsThisMonth) };
  const appConfig = { get: jest.fn().mockResolvedValue(DEFAULT_LIMITS) };
  return new EntitlementService(
    subRepo as never,
    usage as never,
    appConfig as never,
  );
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);
const userWithTrial = (end: Date | null) =>
  ({ id: 'u1', trialEndsAt: end } as unknown as User);

describe('EntitlementService.resolve', () => {
  it('during trial → full Pro, unlimited', async () => {
    const ent = await makeService(null, 0).resolve(userWithTrial(daysFromNow(4)));
    expect(ent.isPro).toBe(true);
    expect(ent.plan).toBe(PlanId.PRO);
    expect(ent.status).toBe(SubscriptionStatus.TRIALING);
    expect(ent.monthlyUploadLimit).toBeNull(); // unlimited
    expect(ent.features.unlimitedScans).toBe(true);
    expect(ent.canSnap).toBe(true);
  });

  it('trial expired, no subscription → Free with monthly scan limit', async () => {
    const ent = await makeService(null, 0).resolve(userWithTrial(daysFromNow(-1)));
    expect(ent.isPro).toBe(false);
    expect(ent.plan).toBe(PlanId.FREE);
    expect(ent.monthlyUploadLimit).toBe(DEFAULT_LIMITS.freeMonthlyScans); // 15
    expect(ent.features.unlimitedScans).toBe(false);
    expect(ent.trialDaysLeft).toBe(0);
    expect(ent.canSnap).toBe(true); // 0 used < 15
  });

  it('free user who used the whole monthly quota → cannot snap', async () => {
    const ent = await makeService(
      null,
      DEFAULT_LIMITS.freeMonthlyScans,
    ).resolve(userWithTrial(daysFromNow(-1)));
    expect(ent.isPro).toBe(false);
    expect(ent.canSnap).toBe(false); // 15 used >= 15
  });

  it('active paid subscription (real Stripe sub) → Pro', async () => {
    const sub = {
      status: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: 'sub_123',
      currentPeriodEnd: daysFromNow(20),
    } as unknown as Subscription;
    const ent = await makeService(sub, 5).resolve(userWithTrial(daysFromNow(-30)));
    expect(ent.isPro).toBe(true);
    expect(ent.plan).toBe(PlanId.PRO);
    expect(ent.monthlyUploadLimit).toBeNull();
    expect(ent.canSnap).toBe(true);
  });

  it('started checkout (customer row, no Stripe sub id) → NOT Pro', async () => {
    const sub = {
      status: SubscriptionStatus.TRIALING,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    } as unknown as Subscription;
    const ent = await makeService(sub, 0).resolve(userWithTrial(daysFromNow(-30)));
    expect(ent.isPro).toBe(false); // no real subscription yet
    expect(ent.plan).toBe(PlanId.FREE);
  });
});
