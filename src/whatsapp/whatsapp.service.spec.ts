import { WhatsappService } from './whatsapp.service';

/** Webhook body carrying one inbound image from a sender. */
const imageFrom = (from: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, type: 'image', image: { id: 'media1' } }] } }] }],
});

function setup(isPro: boolean) {
  const sender = {
    enabled: true,
    sendText: jest.fn().mockResolvedValue(undefined),
    downloadMedia: jest.fn().mockResolvedValue({ buffer: Buffer.from(''), mimetype: 'image/jpeg' }),
  };
  const users = {
    findByPhoneDigits: jest.fn().mockResolvedValue({ id: 'u1', name: 'Ali' }),
    findById: jest.fn().mockResolvedValue(null),
  };
  const entitlement = { resolve: jest.fn().mockResolvedValue({ isPro }) };
  const receipts = { captureAndSave: jest.fn() };
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
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('free user → upgrade nudge with trial + pricing link, no processing', async () => {
    const { svc, sender, receipts } = setup(false);
    await svc.handleWebhook(imageFrom('60123456789'));

    expect(sender.sendText).toHaveBeenCalledTimes(1);
    const msg = sender.sendText.mock.calls[0][1] as string;
    expect(msg).toMatch(/free trial/i);
    expect(msg).toContain('spillsnap.com/pricing');
    expect(sender.downloadMedia).not.toHaveBeenCalled();
    expect(receipts.captureAndSave).not.toHaveBeenCalled();
  });

  it('Pro user → image is downloaded + batched (not blocked)', async () => {
    const { svc, sender } = setup(true);
    await svc.handleWebhook(imageFrom('60123456789'));

    expect(sender.downloadMedia).toHaveBeenCalledTimes(1);
    const msg = sender.sendText.mock.calls[0][1] as string;
    expect(msg).not.toMatch(/free trial/i);
  });
});
