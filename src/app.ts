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

export function createApp() {
  const app = express();

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

  app.use("/admin", adminHydrationController.router);
  app.use("/", liveController.router);
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
