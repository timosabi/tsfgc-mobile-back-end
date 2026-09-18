import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import AuthController from "./controller/AuthController.js";
import FriendsGroupUsersController from "./controller/FriendsGroupUsersController.js";
import FriendsGroupController from "./controller/FriendsGroupController.js";
import ProfileController from "./controller/ProfileController.js";
import MatchEventController from "./controller/MatchEventController.js";
import FriendsGroupJoinRequestController from "./controller/FriendsGroupJoinRequestController.js";
import WeeklyScoreController from "./controller/WeeklyScoreController.js";
import { errorHandler } from "./middleware/errorHandler.js";
import AdminHydrationController from "./controller/AdminHydrationController.js";
import LiveController from "./controller/LiveController.js";
import MatchweekPredictionController from "./controller/MatchweekPredictionController.js";
import MembershipRequestController from "./controller/MembershipRequestController.js";
import NotificationSubscriptionController from "./controller/NotificationSubscriptionController.js";
import ModerationController from "./controller/ModerationController.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Exactly one reverse proxy (nginx) sits in front of this process in
  // production, adding X-Forwarded-For -- trust just that one hop so
  // express-rate-limit can read the real client IP instead of throwing
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every rate-limited request.
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: [
        process.env.CORS_ORIGIN ?? "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8083",
        "http://127.0.0.1:8081",
      ],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use(express.json());
  app.use(cookieParser());
  app.get("/health", async (_, res) => res.status(200).send("I'm alive!"));

  const authController = new AuthController();
  const profileController = new ProfileController();
  const friendsGroupController = new FriendsGroupController();
  const matchEventController = new MatchEventController();
  const friendsGroupJoinRequestController =
    new FriendsGroupJoinRequestController();
  const weeklyScoreController = new WeeklyScoreController();
  const friendsGroupUsersController = new FriendsGroupUsersController();
  const adminHydrationController = new AdminHydrationController();
  const liveController = new LiveController();
  const matchweekPredictionController = new MatchweekPredictionController();
  const membershipRequestController = new MembershipRequestController();
  const notificationSubscriptionController = new NotificationSubscriptionController();
  const moderationController = new ModerationController();

  app.use("/admin", adminHydrationController.router);
  app.use("/admin", membershipRequestController.router);
  app.use("/", liveController.router);
  app.use("/", notificationSubscriptionController.router);
  app.use("/", moderationController.router);
  app.use("/auth", authController.router);
  app.use("/profiles", profileController.router);
  app.use("/friends-groups", matchweekPredictionController.router);
  app.use("/friends-groups", friendsGroupController.router);
  app.use("/friends-groups", friendsGroupJoinRequestController.router);
  app.use("/friends-groups", friendsGroupUsersController.router);
  app.use("/match-event", matchEventController.router);
  app.use("/weekly-score", weeklyScoreController.router);

  app.use(errorHandler);

  return app;
}

export const app = createApp();
