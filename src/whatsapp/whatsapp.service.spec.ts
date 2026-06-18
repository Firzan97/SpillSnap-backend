import { WhatsappService } from './whatsapp.service';

/** Webhook body carrying one inbound image from a sender. */
const imageFrom = (from: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [{ from, type: 'image', image: { id: 'media1' } }],
          },
        },
      ],
    },
  ],
});

function setup(isPro: boolean) {
  const sender = {
    enabled: true,
    sendText: jest.fn().mockResolvedValue(undefined),
    downloadMedia: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from(''), mimetype: 'image/jpeg' }),
  };
  const users = {
    findByPhoneDigits: jest.fn().mockResolvedValue({ id: 'u1', name: 'Ali' }),
    findById: jest.fn().mockResolvedValue({ id: 'u1', name: 'Ali' }),
  };
  const entitlement = { resolve: jest.fn().mockResolvedValue({ isPro }) };
  // First image is analyzed eagerly; a complete receipt is saved right away.
  const receipts = {
    analyze: jest.fn().mockResolvedValue({ isReceipt: true, complete: true }),
    saveExtracted: jest.fn().mockResolvedValue({
      merchant: 'Kedai',
      amount: '10.00',
      currency: 'MYR',
    }),
  };
  const config = { get: jest.fn() };
  const svc = new WhatsappService(
    config as never,
    users as never,
    entitlement as never,
    receipts as never,
    sender as never,
  );
  return { svc, sender, receipts, entitlement };
}

describe('WhatsappService — free-user gate', () => {
  beforeEach(() => jest.useFakeTimers()); // the Pro path arms a 90s idle timer
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('free user → upgrade nudge with trial + pricing link, no processing', async () => {
    const { svc, sender, receipts } = setup(false);
    await svc.handleWebhook(imageFrom('60123456789'));

    expect(sender.sendText).toHaveBeenCalledTimes(1);
    const msg = sender.sendText.mock.calls[0][1] as string;
    expect(msg).toMatch(/free trial/i);
    expect(msg).toContain('spillsnap.com/pricing');
    expect(sender.downloadMedia).not.toHaveBeenCalled();
    expect(receipts.analyze).not.toHaveBeenCalled();
  });

  it('Pro user → first image is downloaded + processed (not blocked)', async () => {
    const { svc, sender, receipts } = setup(true);
    await svc.handleWebhook(imageFrom('60123456789'));

    expect(sender.downloadMedia).toHaveBeenCalledTimes(1);
    // Eager analysis on the first image; complete → saved without a DONE.
    expect(receipts.analyze).toHaveBeenCalledTimes(1);
    expect(receipts.saveExtracted).toHaveBeenCalledTimes(1);
    const msgs = sender.sendText.mock.calls
      .map((c) => c[1] as string)
      .join('\n');
    expect(msgs).not.toMatch(/free trial/i);
    expect(msgs).toMatch(/saved/i);
  });
});
