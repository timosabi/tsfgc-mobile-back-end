declare namespace Express {
  interface Request {
    auth?: import("./auth").AuthSummary;
  }
}
