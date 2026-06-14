import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { ReceiptsService } from './receipts.service';
import {
  LhdnRelief,
  Receipt,
  ReceiptCategory,
  ReceiptStatus,
} from './entities/receipt.entity';
import { StorageService } from './services/storage.service';
import { ReceiptExtractionService } from './services/receipt-extraction.service';
import { UsageService } from '../billing/usage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrencyService } from '../currency/currency.service';

const user = (over: Partial<User> = {}): User =>
  ({
    id: 'u1',
    streakCount: 0,
    longestStreak: 0,
    lastSnapAt: null,
    ...over,
  }) as User;

const file = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' };

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
  };
  let storage: {
    uploadReceiptImage: jest.Mock;
    getSignedUrl: jest.Mock;
    remove: jest.Mock;
    removeMany: jest.Mock;
  };
  let extraction: { extract: jest.Mock };
  let users: { update: jest.Mock };
  let usage: { refund: jest.Mock };
  let notifications: { notify: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((d) => d),
      save: jest.fn(async (e) => ({
        id: 'r1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...e,
      })),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    storage = {
      uploadReceiptImage: jest.fn(async () => 'u1/abc.jpg'),
      getSignedUrl: jest.fn(async () => 'signed://abc'),
      remove: jest.fn(),
      removeMany: jest.fn(),
    };
    extraction = {
      extract: jest.fn(async () => ({
        isReceipt: true,
        rejectReason: null,
        merchant: 'Decathlon',
        receiptDate: '2026-05-16T17:30:00Z',
        currency: 'MYR',
        subtotal: 426,
        sstAmount: 34.08,
        total: 460.08,
        paymentMethod: 'card',
        location: 'PJ',
        items: [{ name: 'Tent', qty: 1, unitPrice: 169, total: 169 }],
        suggestedCategory: ReceiptCategory.SPORTS,
        suggestedRelief: LhdnRelief.SPORTS,
        taxEligible: true,
        confidence: 97,
      })),
    };
    users = { update: jest.fn() };
    usage = { refund: jest.fn() };
    notifications = { notify: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: getRepositoryToken(Receipt), useValue: repo },
        { provide: StorageService, useValue: storage },
        { provide: ReceiptExtractionService, useValue: extraction },
        { provide: UsersService, useValue: users },
        { provide: UsageService, useValue: usage },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: CurrencyService,
          useValue: {
            convert: jest.fn(async (amount: number) => ({
              baseAmount: amount,
              fxRate: 1,
            })),
          },
        },
      ],
    }).compile();

    service = mod.get(ReceiptsService);
  });

  describe('capture', () => {
    it('uploads + extracts and returns an unsaved draft', async () => {
      const draft = await service.capture(user(), [file]);

      expect(storage.uploadReceiptImage).toHaveBeenCalledWith('u1', file);
      expect(extraction.extract).toHaveBeenCalledWith([file], {
        userId: 'u1',
        channel: 'app',
      });
      expect(repo.save).not.toHaveBeenCalled(); // draft is not persisted
      expect(draft).toMatchObject({
        imagePath: 'u1/abc.jpg',
        imageUrl: 'signed://abc',
        merchant: 'Decathlon',
        amount: 460.08,
        category: ReceiptCategory.SPORTS,
        confidence: 97,
      });
    });

    it('rejects non-receipts, refunds the quota slot, and never stores the image', async () => {
      extraction.extract.mockResolvedValueOnce({
        isReceipt: false,
        rejectReason: 'This looks like a selfie, not a receipt',
      });

      await expect(service.capture(user(), [file])).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      expect(usage.refund).toHaveBeenCalledWith('u1');
      expect(storage.uploadReceiptImage).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('persists a confirmed receipt and bumps the streak', async () => {
      const res = await service.create(user(), {
        merchant: 'Decathlon',
        amount: 460.08,
        category: ReceiptCategory.SPORTS,
        receiptDate: '2026-05-16T17:30:00Z',
        imagePath: 'u1/abc.jpg',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          status: ReceiptStatus.CONFIRMED,
          imageUrl: 'u1/abc.jpg',
        }),
      );
      expect(users.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ streakCount: 1, longestStreak: 1 }),
      );
      expect(res).toMatchObject({
        id: 'r1',
        amount: 460.08,
        imageUrl: 'signed://abc',
      });
    });

    it('continues the streak on a consecutive day', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await service.create(user({ streakCount: 4, lastSnapAt: yesterday }), {
        merchant: 'X',
        amount: 1,
        category: ReceiptCategory.OTHER,
        receiptDate: new Date().toISOString(),
      });
      expect(users.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ streakCount: 5 }),
      );
    });

    it('does not change the streak when already snapped today', async () => {
      await service.create(user({ streakCount: 3, lastSnapAt: new Date() }), {
        merchant: 'X',
        amount: 1,
        category: ReceiptCategory.OTHER,
        receiptDate: new Date().toISOString(),
      });
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws when the receipt is missing or not owned', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne(user(), 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the stored image then the row', async () => {
      const row = { id: 'r1', userId: 'u1', imageUrl: 'u1/abc.jpg' } as Receipt;
      repo.findOne.mockResolvedValue(row);
      await service.remove(user(), 'r1');
      expect(storage.removeMany).toHaveBeenCalledWith(['u1/abc.jpg']);
      expect(repo.remove).toHaveBeenCalledWith(row);
    });

    it('deletes every section image of a long receipt', async () => {
      const row = {
        id: 'r1',
        userId: 'u1',
        imageUrl: 'u1/a.jpg',
        imagePaths: ['u1/a.jpg', 'u1/b.jpg'],
      } as Receipt;
      repo.findOne.mockResolvedValue(row);
      await service.remove(user(), 'r1');
      expect(storage.removeMany).toHaveBeenCalledWith(['u1/a.jpg', 'u1/b.jpg']);
      expect(repo.remove).toHaveBeenCalledWith(row);
    });
  });
});
