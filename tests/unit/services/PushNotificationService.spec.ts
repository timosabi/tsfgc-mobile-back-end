import { createRepositoryMock } from "../helpers/mockRepositories.js";
import type { Repositories } from "../../../src/repositories/index.js";
import type PushNotificationServiceType from "../../../src/services/PushNotificationService.js";

const sendEachForMulticastMock = jest.fn();
const getMessagingMock = jest.fn(() => ({
  sendEachForMulticast: sendEachForMulticastMock,
}));
const initializeAppMock = jest.fn(() => ({}));
const certMock = jest.fn((options: unknown) => options);
const getAppsMock = jest.fn(() => [] as unknown[]);

jest.mock("firebase-admin/app", () => ({
  __esModule: true,
  cert: certMock,
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

jest.mock("firebase-admin/messaging", () => ({
  __esModule: true,
  getMessaging: getMessagingMock,
}));

function createRepositories() {
  return {
    notificationSubscriptions: createRepositoryMock<
      Pick<
        Repositories["notificationSubscriptions"],
        "findActiveByUserIds" | "deactivateByEndpoints"
      >
    >(["findActiveByUserIds", "deactivateByEndpoints"]),
  };
}

function newService(
  PushNotificationService: typeof PushNotificationServiceType,
  repositories: ReturnType<typeof createRepositories>
) {
  return new PushNotificationService(
    repositories as unknown as ConstructorParameters<typeof PushNotificationService>[0]
  );
}

// PushNotificationService caches its Firebase Admin init in module-level state
// (deliberately, so it only ever attempts init once) -- resetModules + a fresh
// dynamic import per test is how we get an unpolluted singleton each time,
// since env vars/mocks need to be in place *before* first use.
async function loadService() {
  jest.resetModules();
  const { default: PushNotificationService } = await import(
    "../../../src/services/PushNotificationService.js"
  );
  return PushNotificationService as typeof PushNotificationServiceType;
}

const ORIGINAL_ENV = { ...process.env };

describe("PushNotificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("skips without querying anything when PUSH_ENABLED is not true", async () => {
    delete process.env.PUSH_ENABLED;
    const PushNotificationService = await loadService();
    const repositories = createRepositories();
    const service = newService(PushNotificationService, repositories);

    const result = await service.sendToUsers(["user-1"], {
      title: "Goal!",
      body: "Arsenal 1-0 Chelsea",
    });

    expect(result).toEqual({ sent: 0, skipped: true });
    expect(repositories.notificationSubscriptions.findActiveByUserIds).not.toHaveBeenCalled();
    expect(getMessagingMock).not.toHaveBeenCalled();
  });

  it("skips when PUSH_ENABLED is true but Firebase credentials are absent", async () => {
    process.env.PUSH_ENABLED = "true";
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    const PushNotificationService = await loadService();
    const repositories = createRepositories();
    const service = newService(PushNotificationService, repositories);

    const result = await service.sendToUsers(["user-1"], {
      title: "Goal!",
      body: "Arsenal 1-0 Chelsea",
    });

    expect(result).toEqual({ sent: 0, skipped: true });
    expect(repositories.notificationSubscriptions.findActiveByUserIds).not.toHaveBeenCalled();
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it("sends via FCM and deactivates tokens that come back invalid", async () => {
    process.env.PUSH_ENABLED = "true";
    process.env.FIREBASE_PROJECT_ID = "tsfgc-88f95";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk@tsfgc-88f95.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";

    const PushNotificationService = await loadService();
    const repositories = createRepositories();
    repositories.notificationSubscriptions.findActiveByUserIds.mockResolvedValue([
      { id: "sub-1", user_id: "user-1", endpoint: "token-good" },
      { id: "sub-2", user_id: "user-2", endpoint: "token-stale" },
    ] as never);
    sendEachForMulticastMock.mockResolvedValue({
      successCount: 1,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: "messaging/registration-token-not-registered" },
        },
      ],
    });

    const service = newService(PushNotificationService, repositories);
    const result = await service.sendToUsers(["user-1", "user-2"], {
      title: "Goal!",
      body: "Arsenal 1-0 Chelsea",
      data: { type: "goal" },
    });

    expect(result).toEqual({ sent: 1, skipped: false });
    expect(certMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "tsfgc-88f95",
        clientEmail: "firebase-adminsdk@tsfgc-88f95.iam.gserviceaccount.com",
        privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      })
    );
    expect(sendEachForMulticastMock).toHaveBeenCalledWith({
      tokens: ["token-good", "token-stale"],
      notification: { title: "Goal!", body: "Arsenal 1-0 Chelsea" },
      data: { type: "goal" },
    });
    expect(repositories.notificationSubscriptions.deactivateByEndpoints).toHaveBeenCalledWith([
      "token-stale",
    ]);
  });

  it("does not deactivate anything when all tokens succeed", async () => {
    process.env.PUSH_ENABLED = "true";
    process.env.FIREBASE_PROJECT_ID = "tsfgc-88f95";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk@tsfgc-88f95.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";

    const PushNotificationService = await loadService();
    const repositories = createRepositories();
    repositories.notificationSubscriptions.findActiveByUserIds.mockResolvedValue([
      { id: "sub-1", user_id: "user-1", endpoint: "token-good" },
    ] as never);
    sendEachForMulticastMock.mockResolvedValue({
      successCount: 1,
      responses: [{ success: true }],
    });

    const service = newService(PushNotificationService, repositories);
    const result = await service.sendToUsers(["user-1"], {
      title: "Deadline reminder",
      body: "Predictions lock in 2 hours",
    });

    expect(result).toEqual({ sent: 1, skipped: false });
    expect(repositories.notificationSubscriptions.deactivateByEndpoints).not.toHaveBeenCalled();
  });

  it("returns early without calling Firebase when there are no target users", async () => {
    process.env.PUSH_ENABLED = "true";
    const PushNotificationService = await loadService();
    const repositories = createRepositories();
    const service = newService(PushNotificationService, repositories);

    const result = await service.sendToUsers([], { title: "x", body: "y" });

    expect(result).toEqual({ sent: 0, skipped: true });
    expect(repositories.notificationSubscriptions.findActiveByUserIds).not.toHaveBeenCalled();
  });
});
