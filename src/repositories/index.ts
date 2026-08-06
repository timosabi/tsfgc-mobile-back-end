import type { RepositoryClient } from "./base.js";
import FixturesRepository from "./FixturesRepository.js";
import FootballCompetitionsRepository from "./FootballCompetitionsRepository.js";
import FootballSeasonsRepository from "./FootballSeasonsRepository.js";
import FriendsGroupJoinRequestsRepository from "./FriendsGroupJoinRequestsRepository.js";
import FriendsGroupSubscriptionsRepository from "./FriendsGroupSubscriptionsRepository.js";
import FriendsGroupUsersRepository from "./FriendsGroupUsersRepository.js";
import FriendsGroupsRepository from "./FriendsGroupsRepository.js";
import LiveFeedEventsRepository from "./LiveFeedEventsRepository.js";
import MatchEventsRepository from "./MatchEventsRepository.js";
import NotificationSubscriptionsRepository from "./NotificationSubscriptionsRepository.js";
import PredictionsRepository from "./PredictionsRepository.js";
import ProfilesRepository from "./ProfilesRepository.js";
import RedCardPredictionsRepository from "./RedCardPredictionsRepository.js";
import UserSubmissionsRepository from "./UserSubmissionsRepository.js";
import WeeklyScoresRepository from "./WeeklyScoresRepository.js";

export type Repositories = ReturnType<typeof createRepositories>;

export function createRepositories(client: RepositoryClient) {
  return {
    fixtures: new FixturesRepository(client),
    footballCompetitions: new FootballCompetitionsRepository(client),
    footballSeasons: new FootballSeasonsRepository(client),
    friendsGroupJoinRequests: new FriendsGroupJoinRequestsRepository(client),
    friendsGroupSubscriptions: new FriendsGroupSubscriptionsRepository(client),
    friendsGroupUsers: new FriendsGroupUsersRepository(client),
    friendsGroups: new FriendsGroupsRepository(client),
    liveFeedEvents: new LiveFeedEventsRepository(client),
    matchEvents: new MatchEventsRepository(client),
    notificationSubscriptions: new NotificationSubscriptionsRepository(client),
    predictions: new PredictionsRepository(client),
    profiles: new ProfilesRepository(client),
    redCardPredictions: new RedCardPredictionsRepository(client),
    userSubmissions: new UserSubmissionsRepository(client),
    weeklyScores: new WeeklyScoresRepository(client),
  };
}

export * from "./base.js";
export { default as FixturesRepository } from "./FixturesRepository.js";
export { default as FootballCompetitionsRepository } from "./FootballCompetitionsRepository.js";
export { default as FootballSeasonsRepository } from "./FootballSeasonsRepository.js";
export { default as FriendsGroupJoinRequestsRepository } from "./FriendsGroupJoinRequestsRepository.js";
export { default as FriendsGroupSubscriptionsRepository } from "./FriendsGroupSubscriptionsRepository.js";
export { default as FriendsGroupUsersRepository } from "./FriendsGroupUsersRepository.js";
export { default as FriendsGroupsRepository } from "./FriendsGroupsRepository.js";
export { default as LiveFeedEventsRepository } from "./LiveFeedEventsRepository.js";
export { default as MatchEventsRepository } from "./MatchEventsRepository.js";
export { default as NotificationSubscriptionsRepository } from "./NotificationSubscriptionsRepository.js";
export { default as PredictionsRepository } from "./PredictionsRepository.js";
export { default as ProfilesRepository } from "./ProfilesRepository.js";
export { default as RedCardPredictionsRepository } from "./RedCardPredictionsRepository.js";
export { default as UserSubmissionsRepository } from "./UserSubmissionsRepository.js";
export { default as WeeklyScoresRepository } from "./WeeklyScoresRepository.js";
