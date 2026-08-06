import { SportMonksConfig } from "../../services/dto/types.js";

export class SportMonksConfigBuilder {
  private config: Partial<SportMonksConfig> = {};

  constructor() {
    this.config = {
      apiUrl: "https://api.sportmonks.com/v3/football",
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      rateLimit: {
        requests: 3000, // Default SportMonks rate limit
        window: 3600, // 1 hour window
      },
    };
  }

  withToken(token: string): SportMonksConfigBuilder {
    this.config.token = token;
    return this;
  }

  withApiUrl(apiUrl: string): SportMonksConfigBuilder {
    this.config.apiUrl = apiUrl;
    return this;
  }

  withTimeout(timeout: number): SportMonksConfigBuilder {
    this.config.timeout = timeout;
    return this;
  }

  withRetries(retries: number, retryDelay?: number): SportMonksConfigBuilder {
    this.config.retries = retries;
    if (retryDelay !== undefined) {
      this.config.retryDelay = retryDelay;
    }
    return this;
  }

  withRateLimit(
    requests: number,
    windowInSeconds: number
  ): SportMonksConfigBuilder {
    this.config.rateLimit = {
      requests,
      window: windowInSeconds,
    };
    return this;
  }

  build(): SportMonksConfig {
    if (!this.config.token) {
      throw new Error("SportMonks API token is required");
    }

    return this.config as SportMonksConfig;
  }

  static fromEnvironment(): SportMonksConfig {
    const token =
      process.env.SPORTMONKS_TOKEN || process.env.SPORTMONKS_API_TOKEN;

    if (!token) {
      throw new Error(
        "SportMonks API token not found. Please set SPORTMONKS_TOKEN or SPORTMONKS_API_TOKEN environment variable."
      );
    }

    return new SportMonksConfigBuilder()
      .withToken(token)
      .withApiUrl(
        process.env.SPORTMONKS_API_URL ||
          "https://api.sportmonks.com/v3/football"
      )
      .withTimeout(parseInt(process.env.SPORTMONKS_TIMEOUT || "30000"))
      .withRetries(
        parseInt(process.env.SPORTMONKS_RETRIES || "3"),
        parseInt(process.env.SPORTMONKS_RETRY_DELAY || "1000")
      )
      .withRateLimit(
        parseInt(process.env.SPORTMONKS_RATE_LIMIT_REQUESTS || "3000"),
        parseInt(process.env.SPORTMONKS_RATE_LIMIT_WINDOW || "3600")
      )
      .build();
  }

  static forDevelopment(token: string): SportMonksConfig {
    return new SportMonksConfigBuilder()
      .withToken(token)
      .withTimeout(10000)
      .withRetries(2, 500)
      .withRateLimit(100, 3600) // Lower rate limit for development
      .build();
  }

  static forProduction(token: string): SportMonksConfig {
    return new SportMonksConfigBuilder()
      .withToken(token)
      .withTimeout(30000)
      .withRetries(3, 1000)
      .withRateLimit(3000, 3600)
      .build();
  }

  static validate(config: SportMonksConfig): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!config.token || config.token.trim().length === 0) {
      errors.push("API token is required");
    }

    if (!config.apiUrl || !config.apiUrl.startsWith("http")) {
      errors.push("Valid API URL is required");
    }

    if (config.timeout && config.timeout < 1000) {
      errors.push("Timeout should be at least 1000ms");
    }

    if (config.retries && config.retries < 0) {
      errors.push("Retries cannot be negative");
    }

    if (config.rateLimit) {
      if (config.rateLimit.requests <= 0) {
        errors.push("Rate limit requests must be positive");
      }
      if (config.rateLimit.window <= 0) {
        errors.push("Rate limit window must be positive");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

export const SportMonksConfigs = {
  development: (token: string) => SportMonksConfigBuilder.forDevelopment(token),

  production: (token: string) => SportMonksConfigBuilder.forProduction(token),

  fromEnv: () => SportMonksConfigBuilder.fromEnvironment(),

  custom: () => new SportMonksConfigBuilder(),
};

export default SportMonksConfigBuilder;
