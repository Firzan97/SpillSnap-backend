// Test stub for expo-server-sdk (ESM-only, breaks jest's CJS transform).
// Push delivery isn't exercised by the unit specs; this keeps the import chain
// loadable. Mapped via jest.moduleNameMapper in package.json.

export type ExpoPushMessage = Record<string, unknown>;
export type ExpoPushTicket = Record<string, unknown>;

export class Expo {
  static isExpoPushToken(_token: string): boolean {
    return true;
  }

  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return messages.length ? [messages] : [];
  }

  async sendPushNotificationsAsync(
    _messages: ExpoPushMessage[],
  ): Promise<ExpoPushTicket[]> {
    return [];
  }
}
